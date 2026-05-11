import t from '@babel/types'
import { NodeTypes } from '@vue/compiler-core'
import type {
  VMSAttrOrDirectiveNode,
  VMSCounter,
  VForInfo,
  VMSTransformContext,
} from '@/types/node'
import { collectBindingVarsWithAST, addProperty, getVForVariables, getVForInfoList } from '../tools'
import { getVForItemName, getVForIndexName } from '@/utils/tools'
import {
  getFunctionIndexChar,
  getASTWithVForItemFromProxyRefs,
  getASTWithoutVForItemFromProxyRefs,
  shouldCreateLocalReference,
  buildProxyRefsItemAccess,
  EVENT_PARAM_NAME,
  type CallExpressionInfo,
} from './eventHelpers'
import { fallbackParseExpression } from '../expression'
import { GLOBAL_WHITELIST } from '@/utils/globalWhitelist'
import {
  isPropsVariable,
  isMacroVariable,
  isImportVariable,
  isGlobalVariableInScope,
} from '@/script/scopeAnalyzer'
import { createCompileError } from '@/utils/errorHandler'

// 需要导入generate函数
import { generate } from '@babel/generator'

import { traverse } from '@/utils/babelTraverse'
import { parse as babelParse } from '@babel/parser'
import type { VForItemUsage } from './eventHelpers'

/**
 * 将 BlockStatement "重生"为完整 AST（File 节点）。
 *
 * 因为 traverse 需要一个顶层 Program/File 才能提供 scope 信息，
 * 而 BlockStatement 本身缺少顶层作用域，所以需要：
 * 1. generate(code) — 序列化为字符串
 * 2. babelParse(code) — 重新解析为完整 AST
 *
 * 注意：isAsync 必须正确传递，否则 babel 无法解析 await 关键字。
 * 注意：不能使用 compact: true，否则多语句的 { } 会被移除导致解析错误
 */
function reparseBodyAsAST(body: t.BlockStatement, isAsync: boolean): t.File {
  const arrowFunction = t.arrowFunctionExpression([], body, isAsync)
  // 不能使用 compact: true，否则多语句 BlockStatement 的 { } 会被移除
  const code = generate(arrowFunction).code
  return babelParse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
  })
}

/**
 * 检查变量是否应该被跳过（不收集到 internalVars）
 * 统一封装 scriptScope 变量来源分析，避免散布在多处的四连判断
 */
function shouldSkipVariable(name: string, scriptScope: any): boolean {
  if (!scriptScope) return false
  return (
    isPropsVariable(name, scriptScope) ||
    isMacroVariable(name, scriptScope) ||
    isImportVariable(name, scriptScope) ||
    isGlobalVariableInScope(name, scriptScope)
  )
}

/**
 * 扫描调用参数中的外部变量（非 v-for item、非字面量、非 $event），
 * 注册到 returnValue 和 ctx.internalVars，确保 __vmsProxyRefs 能访问到
 * 现在使用 scriptScope 进行更精确的变量来源分析
 */
function collectExternalVarsFromArgs(
  args: t.CallExpression['arguments'],
  vForItemNames: Set<string>,
  vForInfoList: VForInfo[] | undefined,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
  arrowFunctionArgumentNames?: Set<string>,
): void {
  const vForIndices = new Set(
    vForInfoList ? vForInfoList.map((info) => getVForIndexName(info) || 'index') : [],
  )

  function scanNode(node: t.Node): void {
    if (t.isIdentifier(node)) {
      const name = node.name
      if (
        name === EVENT_PARAM_NAME ||
        name === '$event' ||
        vForItemNames.has(name) ||
        vForIndices.has(name) ||
        GLOBAL_WHITELIST.has(name) ||
        (arrowFunctionArgumentNames && arrowFunctionArgumentNames.has(name))
      ) {
        return
      }

      // 使用封装的函数检查变量是否应该被收集
      if (shouldSkipVariable(name, ctx.scriptScope)) {
        return
      }

      addProperty(returnValue, name)
      ctx.internalVars.add(name)
    } else if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      // 只扫描 object 部分（根标识符）
      scanNode(node.object)
    } else if (t.isObjectExpression(node)) {
      node.properties.forEach((prop) => {
        if (t.isObjectProperty(prop)) {
          scanNode(prop.value as t.Node)
        }
      })
    } else if (t.isArrayExpression(node)) {
      node.elements.forEach((el) => el && scanNode(el))
    } else if (t.isSpreadElement(node)) {
      scanNode(node.argument)
    }
  }

  args.forEach((arg) => scanNode(arg as t.Node))
}

/**
 * 处理事件属性
 */
export function processEventProperty(
  prop: VMSAttrOrDirectiveNode,
  node: any,
  counter: VMSCounter,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
): { name: string; content: string } | null {
  if (prop.type !== 7 || prop.name !== 'on') {
    return null
  }

  const exp = prop.exp
  if (!exp) {
    return null
  }

  let content: string = ''
  const excludeBindingVars: string[] = []
  // Build vForItemName set from ctx instead of node.vForInfoList
  const vForInfoList = getVForInfoList(ctx, node)
  const vForItemName = new Set<string>()
  if (vForInfoList) {
    for (const info of vForInfoList) {
      const name = getVForItemName(info)
      if (name) vForItemName.add(name)
    }
  }

  const expContent = exp.type === NodeTypes.SIMPLE_EXPRESSION ? exp.content : ''
  // 对于简单表达式，Vue compiler 可能不提供 AST (返回 undefined/null)
  // 或者提供的是无效的 AST，这时需要用 babel 重新解析
  let ast = fallbackParseExpression(exp.ast, expContent)
  if (!ast) {
    // 最终解析失败，当作简单标识符处理
    if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
      content = exp.content
      collectBindingVarsWithAST(t.identifier(content), node, returnValue, ctx)
    }
  } else {
    if (t.isProgram(ast) && ast.body.length > 0) {
      const firstStatement = ast.body[0]
      if (t.isExpressionStatement(firstStatement)) {
        ast = firstStatement.expression
      }
    }

    content = processASTExpression(
      ast,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      node,
      returnValue,
      ctx,
    )

    // 排除已注册为 internalVars 的变量，避免它们被重复收集进 renderVars
    const allExcluded = [...excludeBindingVars, ...ctx.internalVars]
    collectBindingVarsWithAST(ast, node, returnValue, ctx, allExcluded)
    // 记录被桥接的函数名，供 script 阶段过滤 __vmsRenderState
    excludeBindingVars.forEach((name) => ctx.bridgedFunctions.add(name))
  }

  return processEventName(prop, content)
}

/**
 * 处理AST表达式
 */
function processASTExpression(
  ast: any,
  counter: VMSCounter,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  excludeBindingVars: string[],
  vForItemName: Set<string>,
  node: any,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
): string {
  const vForInfoList = getVForInfoList(ctx, node)
  if (t.isCallExpression(ast)) {
    return processCallableExpression(
      ast.callee as t.Expression,
      ast.arguments,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      vForInfoList,
      ctx,
      returnValue,
    )
  } else if (t.isMemberExpression(ast)) {
    return processCallableExpression(
      ast,
      null,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      vForInfoList,
      ctx,
      returnValue,
    )
  } else if (t.isArrowFunctionExpression(ast)) {
    return processArrowFunctionExpression(
      ast,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      node,
      returnValue,
      ctx,
    )
  } else if (t.isAssignmentExpression(ast)) {
    // 处理直接赋值表达式：@tap="visibleRef = true"
    // 将赋值表达式包装为 BlockStatement 处理
    const wrappedBody = t.blockStatement([t.expressionStatement(ast)])
    return processInlineArrowFunction(
      wrappedBody,
      [], // 直接赋值没有箭头函数参数
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      node,
      returnValue,
      ctx,
      false,
    )
  } else if (t.isSequenceExpression(ast)) {
    // 处理序列表达式（多个语句用分号分隔）
    // @tap="item.selected = true; console.log(item.name)"
    const statements = ast.expressions.map((expr) => t.expressionStatement(expr))
    const wrappedBody = t.blockStatement(statements)
    return processInlineArrowFunction(
      wrappedBody,
      [], // 直接表达式没有箭头函数参数
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      node,
      returnValue,
      ctx,
      false,
    )
  } else if (t.isLogicalExpression(ast) || t.isConditionalExpression(ast)) {
    // 处理逻辑表达式和条件表达式：@tap="canSubmit && isEnabled && submitRef = true"
    // 或 @tap="isLoading ? errorMsg = '加载中' : successMsg = '完成'"
    return createShortExprHandler(
      ast,
      [], // 直接表达式没有箭头函数参数
      callExpressionWithArgs,
      vForInfoList,
      getVForVariables(ctx, node),
      ctx,
      counter,
      returnValue,
      false,
    )
  }

  return ''
}

/**
 * 统一处理所有可调用表达式的事件绑定：
 * - onClick(args)          → callee=Identifier, argumentsAst=args
 * - card.onClick(args)     → callee=MemberExpression, argumentsAst=args
 * - card.onClick           → callee=MemberExpression, argumentsAst=null
 * - (e) => onClick(args)   → 同上，加 arrowFunctionArgumentNames
 */
function processCallableExpression(
  callee: t.Expression,
  argumentsAst: t.CallExpression['arguments'] | null,
  counter: VMSCounter,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  excludeBindingVars: string[],
  vForItemName: Set<string>,
  vForInfoList: VForInfo[] | undefined,
  ctx: VMSTransformContext,
  returnValue: t.ObjectExpression,
  arrowFunctionArgumentNames?: Set<string>,
): string {
  const content = counter.generateFunctionPropertyName()
  const dataKey = getFunctionIndexChar(counter.nodeDataKeyIndex++)
  const args = argumentsAst ?? []

  if (t.isIdentifier(callee)) {
    handleIdentifierCallee(
      callee,
      args as t.Expression[],
      content,
      dataKey,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      vForInfoList,
      ctx,
      returnValue,
      arrowFunctionArgumentNames,
    )
  } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
    handleMemberExpressionCallee(
      callee as t.MemberExpression & { object: t.Identifier },
      argumentsAst,
      args as t.Expression[],
      content,
      dataKey,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      vForInfoList,
      ctx,
      returnValue,
      arrowFunctionArgumentNames,
    )
  }

  ctx.needsProxyRefs = true
  return content
}

/** Identifier callee：onClick(args) */
function handleIdentifierCallee(
  callee: t.Identifier,
  args: t.Expression[],
  content: string,
  dataKey: string,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  excludeBindingVars: string[],
  vForItemName: Set<string>,
  vForInfoList: VForInfo[] | undefined,
  ctx: VMSTransformContext,
  returnValue: t.ObjectExpression,
  arrowFunctionArgumentNames?: Set<string>,
): void {
  const effectiveVForItemName = vForItemName || new Set<string>()
  collectExternalVarsFromArgs(
    args,
    effectiveVForItemName,
    vForInfoList,
    returnValue,
    ctx,
    arrowFunctionArgumentNames,
  )

  const indices = vForInfoList ? vForInfoList.map((info) => getVForIndexName(info) || 'index') : []
  const shouldPassIndices = vForInfoList && vForInfoList.length > 0

  callExpressionWithArgs.set(content, {
    dataKey,
    dataArgsAst: shouldPassIndices ? indices.map((idx) => t.identifier(idx)) : null,
    returnValueBodyAst: getASTWithoutVForItemFromProxyRefs(
      callee,
      args,
      arrowFunctionArgumentNames,
      vForInfoList,
      effectiveVForItemName,
      dataKey,
      shouldPassIndices,
      ctx.scriptScope,
    ),
    isAsync: false,
  })
  excludeBindingVars.push(callee.name)
}

/** MemberExpression callee：card.onClick(args) 或 obj.method(args) */
function handleMemberExpressionCallee(
  callee: t.MemberExpression & { object: t.Identifier },
  argumentsAst: t.CallExpression['arguments'] | null,
  args: t.Expression[],
  content: string,
  dataKey: string,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  excludeBindingVars: string[],
  vForItemName: Set<string>,
  vForInfoList: VForInfo[] | undefined,
  ctx: VMSTransformContext,
  returnValue: t.ObjectExpression,
  arrowFunctionArgumentNames?: Set<string>,
): void {
  const calleeName = callee.object.name
  collectExternalVarsFromArgs(
    args,
    vForItemName,
    vForInfoList,
    returnValue,
    ctx,
    arrowFunctionArgumentNames,
  )

  if (vForItemName.has(calleeName) && vForInfoList && vForInfoList.length > 0) {
    // v-for item 方法：card.onClick(args) → data-a 只传索引
    const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
    callExpressionWithArgs.set(content, {
      dataKey,
      dataArgsAst: indices.map((idx) => t.identifier(idx)),
      returnValueBodyAst: getASTWithVForItemFromProxyRefs(
        dataKey,
        callee,
        argumentsAst,
        vForInfoList,
        arrowFunctionArgumentNames,
        ctx.scriptScope,
      ),
      isAsync: false,
    })
  } else {
    // 非 v-for item 的成员表达式：obj.method(args)
    // callee object 本身也是外部变量，需要注册（但需过滤全局变量和导入变量）
    if (!GLOBAL_WHITELIST.has(calleeName) && !shouldSkipVariable(calleeName, ctx.scriptScope)) {
      addProperty(returnValue, calleeName)
      ctx.internalVars.add(calleeName)
    }
    callExpressionWithArgs.set(content, {
      dataKey,
      dataArgsAst: null,
      returnValueBodyAst: getASTWithoutVForItemFromProxyRefs(
        callee,
        argumentsAst,
        arrowFunctionArgumentNames,
        vForInfoList,
        vForItemName,
        undefined,
        false,
        ctx.scriptScope,
      ),
      isAsync: false,
    })
  }
  excludeBindingVars.push(calleeName)
}

/**
 * 处理箭头函数表达式
 */
function processArrowFunctionExpression(
  ast: t.ArrowFunctionExpression,
  counter: VMSCounter,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  excludeBindingVars: string[],
  vForItemName: Set<string>,
  node: any,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
): string {
  const arrowFunctionArguments = ast.params
  const body = ast.body
  const isAsync = ast.async || false
  const vForInfoList = getVForInfoList(ctx, node)
  const arrowFunctionArgumentNames =
    arrowFunctionArguments.length > 0
      ? new Set(
          arrowFunctionArguments.map((p: any) => (t.isIdentifier(p) ? p.name : '')).filter(Boolean),
        )
      : undefined

  if (t.isBlockStatement(body)) {
    return processInlineArrowFunction(
      body,
      arrowFunctionArguments,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      node,
      returnValue,
      ctx,
      isAsync,
    )
  } else if (t.isCallExpression(body)) {
    return processCallableExpression(
      body.callee as t.Expression,
      body.arguments,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      vForItemName,
      vForInfoList,
      ctx,
      returnValue,
      arrowFunctionArgumentNames,
    )
  } else if (t.isAssignmentExpression(body)) {
    // 处理赋值表达式：(value) => (innerValue = value)
    // 将赋值表达式包装为 BlockStatement 处理
    const wrappedBody = t.blockStatement([t.expressionStatement(body)])
    return processInlineArrowFunction(
      wrappedBody,
      arrowFunctionArguments,
      counter,
      callExpressionWithArgs,
      excludeBindingVars,
      node,
      returnValue,
      ctx,
      isAsync,
    )
  } else if (t.isConditionalExpression(body) || t.isLogicalExpression(body)) {
    // 处理三元表达式：(e) => flag ? a() : b()
    // 处理逻辑表达式：(e) => flag && onClick(e)
    const vForInfoList = getVForInfoList(ctx, node)
    const vForVars = getVForVariables(ctx, node)
    return createShortExprHandler(
      body,
      arrowFunctionArguments,
      callExpressionWithArgs,
      vForInfoList,
      vForVars,
      ctx,
      counter,
      returnValue,
      isAsync,
    )
  }

  return ''
}

function collectExternalVarsFromExpression(
  body: t.ConditionalExpression | t.LogicalExpression,
  arrowFunctionArgumentNames: Set<string> | undefined,
  vForVars: Set<string>,
): Set<string> {
  const varsToCollect = new Set<string>()

  const collectVarsFromNode = (node: t.Node): void => {
    if (t.isIdentifier(node)) {
      const name = node.name
      if (
        name !== EVENT_PARAM_NAME &&
        name !== '$event' &&
        !GLOBAL_WHITELIST.has(name) &&
        !(arrowFunctionArgumentNames && arrowFunctionArgumentNames.has(name)) &&
        !vForVars.has(name)
      ) {
        varsToCollect.add(name)
      }
    } else if (t.isMemberExpression(node)) {
      collectVarsFromNode(node.object)
    } else if (t.isCallExpression(node)) {
      collectVarsFromNode(node.callee)
      node.arguments.forEach((arg) => collectVarsFromNode(arg as t.Node))
    } else if (t.isConditionalExpression(node)) {
      collectVarsFromNode(node.test)
      collectVarsFromNode(node.consequent)
      collectVarsFromNode(node.alternate)
    } else if (t.isLogicalExpression(node) || t.isBinaryExpression(node)) {
      collectVarsFromNode(node.left)
      collectVarsFromNode(node.right)
    } else if (t.isUnaryExpression(node)) {
      collectVarsFromNode(node.argument)
    } else if (t.isAssignmentExpression(node)) {
      collectVarsFromNode(node.left)
      collectVarsFromNode(node.right)
    }
  }

  // 收集对应表达式类型的节点
  if (t.isConditionalExpression(body)) {
    collectVarsFromNode(body.test)
    collectVarsFromNode(body.consequent)
    collectVarsFromNode(body.alternate)
  } else {
    // LogicalExpression
    collectVarsFromNode(body.left)
    collectVarsFromNode(body.right)
  }

  return varsToCollect
}

/**
 * 重写表达式中的变量引用
 * 将外部变量、props、箭头函数参数替换为正确的访问路径
 */
function rewriteExpressionVars(
  expr: t.Expression,
  varsToCollect: Set<string>,
  arrowFunctionArgumentNames: Set<string> | undefined,
  ctx: VMSTransformContext,
): t.Expression {
  const processExpr = (node: t.Expression): t.Expression => {
    if (t.isIdentifier(node)) {
      const name = node.name
      if (arrowFunctionArgumentNames && arrowFunctionArgumentNames.has(name)) {
        return t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail'))
      }
      if (ctx.scriptScope?.props.has(name)) {
        const propsVarName = ctx.scriptScope.propsVarName || '__vmsProps'
        return t.memberExpression(t.identifier(propsVarName), t.identifier(name))
      }
      if (varsToCollect.has(name)) {
        return t.memberExpression(t.identifier('__vmsProxyRefs'), t.identifier(name))
      }
      return node
    } else if (t.isMemberExpression(node)) {
      return t.memberExpression(
        processExpr(node.object as t.Expression),
        node.property,
        node.computed,
      )
    } else if (t.isCallExpression(node)) {
      return t.callExpression(
        processExpr(node.callee as t.Expression),
        node.arguments.map((arg) => processExpr(arg as t.Expression)),
      )
    } else if (t.isConditionalExpression(node)) {
      return t.conditionalExpression(
        processExpr(node.test),
        processExpr(node.consequent),
        processExpr(node.alternate),
      )
    } else if (t.isLogicalExpression(node)) {
      return t.logicalExpression(node.operator, processExpr(node.left), processExpr(node.right))
    } else if (t.isBinaryExpression(node)) {
      return t.binaryExpression(
        node.operator,
        processExpr(node.left as t.Expression),
        processExpr(node.right as t.Expression),
      )
    } else if (t.isUnaryExpression(node)) {
      return t.unaryExpression(node.operator, processExpr(node.argument))
    } else if (t.isAssignmentExpression(node)) {
      // 仅对 Identifier / MemberExpression 两种左值做重写，
      // 其它（ArrayPattern / ObjectPattern 等解构左值）保持原样
      const left = node.left
      if (t.isIdentifier(left) || t.isMemberExpression(left)) {
        const rewritten = processExpr(left as t.Expression)
        // 重写后必须仍是合法左值（Identifier 或 MemberExpression）
        if (t.isIdentifier(rewritten) || t.isMemberExpression(rewritten)) {
          return t.assignmentExpression(node.operator, rewritten, processExpr(node.right))
        }
      }
      return t.assignmentExpression(node.operator, left as t.LVal, processExpr(node.right))
    }
    return node
  }

  return processExpr(expr)
}

/**
 * 创建简短表达式（条件/逻辑表达式）的箭头函数处理器
 * 供 processArrowFunctionExpression 中条件表达式和逻辑表达式分支复用
 */
function createShortExprHandler(
  body: t.ConditionalExpression | t.LogicalExpression,
  arrowFunctionArguments: any[],
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  vForInfoList: VForInfo[] | undefined,
  vForVars: Set<string>,
  ctx: VMSTransformContext,
  counter: VMSCounter,
  returnValue: t.ObjectExpression,
  isAsync: boolean,
): string {
  const arrowFunctionArgumentNames =
    arrowFunctionArguments.length > 0
      ? new Set(
          arrowFunctionArguments.map((p: any) => (t.isIdentifier(p) ? p.name : '')).filter(Boolean),
        )
      : undefined

  // 收集外部变量
  const varsToCollect = collectExternalVarsFromExpression(
    body,
    arrowFunctionArgumentNames,
    vForVars,
  )

  // 将收集的变量添加到 returnValue
  varsToCollect.forEach((varName) => {
    if (!shouldSkipVariable(varName, ctx.scriptScope)) {
      addProperty(returnValue, varName)
      ctx.internalVars.add(varName)
    }
  })

  // 标记需要 __vmsProxyRefs
  if (varsToCollect.size > 0) {
    ctx.needsProxyRefs = true
  }

  // 生成桥接函数
  const functionName = counter.generateFunctionPropertyName()
  const dataKey =
    vForInfoList && vForInfoList.length > 0 ? getFunctionIndexChar(counter.nodeDataKeyIndex++) : ''

  // 处理参数
  const statements: t.Statement[] = []
  if (arrowFunctionArguments.length > 0) {
    const param = arrowFunctionArguments[0]
    if (t.isIdentifier(param) && param.name !== '$event' && param.name !== EVENT_PARAM_NAME) {
      statements.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            param,
            t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail')),
          ),
        ]),
      )
    }
  }

  // 处理 v-for dataset 获取
  if (vForInfoList && vForInfoList.length > 0) {
    const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
    const indexVars = indices.map((idx) => t.identifier(idx))
    statements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.objectPattern([
            t.objectProperty(t.identifier(dataKey), t.arrayPattern(indexVars), false, false),
          ]),
          t.memberExpression(
            t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('currentTarget')),
            t.identifier('dataset'),
          ),
        ),
      ]),
    )
  }

  // 重写表达式中的变量引用
  const processedBody = rewriteExpressionVars(body, varsToCollect, arrowFunctionArgumentNames, ctx)
  statements.push(t.returnStatement(processedBody))

  const functionBody = t.blockStatement(statements)
  const dataArgsAst =
    vForInfoList && vForInfoList.length > 0
      ? vForInfoList.map((info: VForInfo) => t.identifier(getVForIndexName(info) || 'index'))
      : null

  callExpressionWithArgs.set(functionName, {
    dataKey,
    dataArgsAst,
    returnValueBodyAst: functionBody,
    isAsync,
  })

  return functionName
}

/**
 * 处理事件名转换
 * 规则：
 * 1. 事件名原样保留，不做 click -> tap 转换
 * 2. .stop 转为 catch:
 * 3. .mut 转为 mut-bind:
 * 4. .capture 转为 capture-bind:
 * 5. .capture-stop 转为 capture-catch:
 */
function processEventName(
  prop: VMSAttrOrDirectiveNode,
  content: string,
): { name: string; content: string } | null {
  if (prop.type !== NodeTypes.DIRECTIVE) {
    return null
  }

  const arg = prop.arg
  if (!arg) {
    return null
  }

  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
    const eventName = arg.content
    const modifiers = prop.modifiers || []

    // 检查修饰符
    const hasMutModifier = modifiers.some((item: any) => item.content === 'mut')
    const hasCaptureModifier = modifiers.some((item: any) => item.content === 'capture')
    const hasCaptureStopModifier = modifiers.some((item: any) => item.content === 'capture-stop')
    const hasStopModifier = modifiers.some((item: any) => item.content === 'stop')

    // 确定绑定类型（优先级：capture-stop > capture > mut > stop > bind）
    let bindType: string
    if (hasCaptureStopModifier) {
      bindType = 'capture-catch'
    } else if (hasCaptureModifier) {
      bindType = 'capture-bind'
    } else if (hasMutModifier) {
      bindType = 'mut-bind'
    } else if (hasStopModifier) {
      bindType = 'catch'
    } else {
      bindType = 'bind'
    }

    return {
      name: `${bindType}:${eventName}`,
      content,
    }
  } else {
    throw createCompileError('事件名必须是简单表达式：' + prop.arg, prop.loc)
  }
}

/**
 * 添加生成的函数到returnValue
 * 返回生成的 data- 属性列表
 */
export function addGeneratedFunctions(
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  _props: VMSAttrOrDirectiveNode[],
  returnValue: t.ObjectExpression,
): Array<{ name: string; content: string }> {
  const dataProps: Array<{ name: string; content: string }> = []

  callExpressionWithArgs.forEach(
    ({ dataKey, dataArgsAst, returnValueBodyAst, isAsync }, funName) => {
      const propName = `data-${dataKey}`

      if (Array.isArray(dataArgsAst) && dataArgsAst.length > 0) {
        const content = `{{[${dataArgsAst.map((arg) => generate(arg, { compact: true }).code).join(',')}]}}`
        dataProps.push({ name: propName, content })
      }

      if (returnValueBodyAst) {
        let functionExpression: t.FunctionExpression | t.ArrowFunctionExpression

        const body: t.BlockStatement = t.isBlockStatement(returnValueBodyAst)
          ? returnValueBodyAst
          : t.blockStatement([t.returnStatement(returnValueBodyAst)])

        if (isAsync) {
          functionExpression = t.functionExpression(
            null,
            [t.identifier(EVENT_PARAM_NAME)],
            body,
            false,
            true,
          )
        } else {
          functionExpression = t.arrowFunctionExpression([t.identifier(EVENT_PARAM_NAME)], body)
        }

        returnValue.properties.push(t.objectProperty(t.identifier(funName), functionExpression))
      }
    },
  )

  return dataProps
}

/**
 * 处理内联箭头函数
 */
function processInlineArrowFunction(
  body: t.BlockStatement,
  arrowFunctionArguments: any[],
  counter: VMSCounter,
  callExpressionWithArgs: Map<string, CallExpressionInfo>,
  excludeBindingVars: string[],
  node: any,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
  isAsync: boolean = false,
): string {
  const functionName = counter.generateFunctionPropertyName()

  // 1. 收集外部变量
  const vForInfoList = getVForInfoList(ctx, node)
  const usedVars = collectUsedVariables(body, arrowFunctionArguments, vForInfoList, isAsync)

  // 将收集的外部变量添加到returnValue中
  const vForVars = getVForVariables(ctx, node)
  usedVars.forEach((varName) => {
    // 过滤 v-for 变量和全局变量
    if (
      !vForVars.has(varName) &&
      !GLOBAL_WHITELIST.has(varName) &&
      !shouldSkipVariable(varName, ctx.scriptScope)
    ) {
      addProperty(returnValue, varName)
      ctx.internalVars.add(varName)
    }
  })

  // 2. 分析 v-for item 使用情况
  let vForItemUsage: VForItemUsage | null = null
  if (vForInfoList && vForInfoList.length > 0) {
    vForItemUsage = analyzeVForItemUsage(body, vForInfoList, isAsync)
    const lastVForInfo = vForInfoList[vForInfoList.length - 1]
    const itemName = getVForItemName(lastVForInfo)
    if (itemName) {
      excludeBindingVars.push(itemName)
    }
  }

  // 如果有外部变量或 v-for item 引用，标记需要 __vmsProxyRefs
  if (usedVars.size > 0 || vForItemUsage?.shouldCreateReference) {
    ctx.needsProxyRefs = true
  }

  // 3. 生成函数体
  // dataKey 需要在 generateFunctionPropertyName 之后、存储之前计算
  const functionIndex = counter.functionPropertyCounter - 1
  const dataKey = vForInfoList && vForInfoList.length > 0 ? getFunctionIndexChar(functionIndex) : ''

  const functionBody = createInlineHandlerBody(
    body,
    arrowFunctionArguments,
    usedVars,
    vForInfoList,
    vForItemUsage,
    isAsync,
    dataKey,
  )

  // 4. 存储函数信息
  const dataArgsAst =
    vForInfoList && vForInfoList.length > 0
      ? vForInfoList.map((info: VForInfo) => {
          const indexName = getVForIndexName(info) || 'index'
          return t.identifier(indexName)
        })
      : null

  callExpressionWithArgs.set(functionName, {
    dataKey,
    dataArgsAst,
    returnValueBodyAst: functionBody,
    isAsync,
  })

  return functionName
}

/**
 * 创建局部变量声明收集 visitor
 * 将 AST 遍历中重复的变量声明收集逻辑（VariableDeclarator、FunctionDeclaration、
 * CatchClause、ForStatement）提取为可复用的 visitor 工厂
 */
function createLocalVarCollector(localVars: Set<string>) {
  return {
    VariableDeclarator(path: any) {
      const id = path.node.id
      if (t.isIdentifier(id)) {
        localVars.add(id.name)
      } else if (t.isObjectPattern(id)) {
        id.properties.forEach((prop: any) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
            localVars.add(prop.value.name)
          } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
            localVars.add(prop.argument.name)
          }
        })
      } else if (t.isArrayPattern(id)) {
        id.elements.forEach((elem: any) => {
          if (elem && t.isIdentifier(elem)) {
            localVars.add(elem.name)
          }
        })
      }
    },
    FunctionDeclaration(path: any) {
      if (path.node.id) {
        localVars.add(path.node.id.name)
      }
      path.node.params.forEach((param: any) => {
        if (t.isIdentifier(param)) {
          localVars.add(param.name)
        }
      })
    },
    CatchClause(path: any) {
      if (path.node.param && t.isIdentifier(path.node.param)) {
        localVars.add(path.node.param.name)
      }
    },
    ForStatement(path: any) {
      const init = path.node.init
      if (t.isVariableDeclaration(init)) {
        init.declarations.forEach((decl: any) => {
          if (t.isIdentifier(decl.id)) {
            localVars.add(decl.id.name)
          }
        })
      }
    },
  }
}

/**
 * 收集函数体中使用的外部变量
 */
function collectUsedVariables(
  body: t.BlockStatement,
  arrowFunctionArguments: any[],
  vForInfoList?: VForInfo[],
  isAsync: boolean = false,
): Set<string> {
  const usedVars = new Set<string>()
  const localVars = new Set<string>()

  // 添加箭头函数参数到局部变量
  arrowFunctionArguments.forEach((param) => {
    if (t.isIdentifier(param)) {
      localVars.add(param.name)
    } else if (t.isObjectPattern(param)) {
      param.properties.forEach((prop) => {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
          localVars.add(prop.value.name)
        }
      })
    } else if (t.isAssignmentPattern(param)) {
      // 默认参数：(e = {}) => {}
      if (t.isIdentifier(param.left)) {
        localVars.add(param.left.name)
      }
    } else if (t.isRestElement(param)) {
      // 剩余参数：(...args) => {}
      if (t.isIdentifier(param.argument)) {
        localVars.add(param.argument.name)
      }
    }
  })

  // 添加 v-for 变量到局部变量
  if (vForInfoList && vForInfoList.length > 0) {
    vForInfoList.forEach((info) => {
      const itemName = getVForItemName(info)
      const indexName = getVForIndexName(info) || 'index'
      if (itemName) localVars.add(itemName)
      localVars.add(indexName)
    })
  }

  // 将 BlockStatement 转换为代码字符串，然后解析为完整的 AST
  // 注意：需要传递async标志，否则babel无法解析await关键字
  const ast = reparseBodyAsAST(body, isAsync)

  traverse(ast, {
    ...createLocalVarCollector(localVars),
    Identifier(path) {
      const name = path.node.name
      if (
        !localVars.has(name) &&
        !GLOBAL_WHITELIST.has(name) &&
        !path.scope.hasBinding(name, true)
      ) {
        // 检查是否是对象属性的 key
        const parent = path.parent
        if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
          return
        }
        // 检查是否是成员表达式的属性
        if (t.isMemberExpression(parent) && parent.property === path.node && !parent.computed) {
          return
        }
        // 检查是否是可选链成员表达式的属性
        if (
          t.isOptionalMemberExpression(parent) &&
          parent.property === path.node &&
          !parent.computed
        ) {
          return
        }
        usedVars.add(name)
      }
    },
  })

  return usedVars
}

/**
 * 分析 v-for item 的使用情况
 */
function analyzeVForItemUsage(
  body: t.BlockStatement,
  vForInfoList: VForInfo[],
  isAsync: boolean = false,
): VForItemUsage {
  const lastVForInfo = vForInfoList[vForInfoList.length - 1]
  const itemName = getVForItemName(lastVForInfo)
  const usages: VForItemUsage['usages'] = []

  // 将 BlockStatement 转换为代码字符串，然后解析为完整的 AST
  // 注意：需要传递async标志，否则babel无法解析await关键字
  const ast = reparseBodyAsAST(body, isAsync)

  // 单次遍历：收集局部变量和 item 使用情况
  const localVars = new Set<string>()
  let hasLocalItemVar = false

  traverse(ast, {
    ...createLocalVarCollector(localVars),
    VariableDeclarator(path) {
      // createLocalVarCollector 已收集到 localVars，此处只检查 hasLocalItemVar
      const id = path.node.id
      if (t.isIdentifier(id) && id.name === itemName) {
        hasLocalItemVar = true
      }
    },
    FunctionDeclaration(path) {
      if (path.node.id && path.node.id.name === itemName) {
        hasLocalItemVar = true
      }
      path.node.params.forEach((param: any) => {
        if (t.isIdentifier(param) && param.name === itemName) {
          hasLocalItemVar = true
        }
      })
    },
    Identifier(path) {
      if (path.node.name !== itemName) return

      const parent = path.parent

      // 跳过局部变量声明
      if (t.isVariableDeclarator(parent) && parent.id === path.node) {
        return
      }

      const usage = {
        type: parent.type,
        isMemberExpression: t.isMemberExpression(parent) && parent.object === path.node,
        isReassignment:
          t.isAssignmentExpression(parent) && parent.left === path.node && parent.operator === '=',
        isUpdate: t.isUpdateExpression(parent) && parent.argument === path.node,
      }

      usages.push(usage)
    },
  })

  // 如果函数内声明了同名局部变量，不创建引用
  if (hasLocalItemVar) {
    return {
      itemName,
      usageCount: 0,
      usages: [],
      shouldCreateReference: false,
    }
  }

  // 判断是否应该创建引用
  // 注意：Identifier visitor 已经跳过了局部变量声明，所以 usages 中不会包含局部变量声明
  const shouldCreate = shouldCreateLocalReference(usages)

  return {
    itemName,
    usageCount: usages.length,
    usages,
    shouldCreateReference: shouldCreate,
  }
}

/**
 * 创建内联处理函数的函数体
 */
function createInlineHandlerBody(
  body: t.BlockStatement,
  arrowFunctionArguments: any[],
  externalVars: Set<string>,
  vForInfoList?: VForInfo[],
  vForItemUsage?: VForItemUsage | null,
  isAsync: boolean = false,
  dataKey: string = 'a',
): t.BlockStatement {
  const statements: t.Statement[] = []
  const paramNameMapping = new Map<string, string>() // 参数名映射

  // 1. 处理箭头函数参数
  if (arrowFunctionArguments.length > 0) {
    const param = arrowFunctionArguments[0]

    if (t.isIdentifier(param)) {
      // 普通参数
      if (param.name !== '$event' && param.name !== EVENT_PARAM_NAME) {
        // 不是 $event 或 __vms_event，添加 .detail
        statements.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              param,
              t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail')),
            ),
          ]),
        )
      } else if (param.name === '$event') {
        // $event 需要映射到 __vms_event
        paramNameMapping.set('$event', EVENT_PARAM_NAME)
      }
      // 如果是 __vms_event���不需要处理，直接使用
    } else if (t.isObjectPattern(param)) {
      // 解构参数：({ name }) => {}
      statements.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            param,
            t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail')),
          ),
        ]),
      )
    }
  }

  // 2. 处理 v-for dataset 获取
  if (vForInfoList && vForInfoList.length > 0) {
    // 提取所有 index 名称
    const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')

    // const {dataKey: [index, childIndex, ...]} = __vms_event.currentTarget.dataset
    const indexVars = indices.map((idx) => t.identifier(idx))
    statements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.objectPattern([
            t.objectProperty(t.identifier(dataKey), t.arrayPattern(indexVars), false, false),
          ]),
          t.memberExpression(
            t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('currentTarget')),
            t.identifier('dataset'),
          ),
        ),
      ]),
    )

    // 3. 创建局部引用（如果需要）
    if (vForItemUsage?.shouldCreateReference) {
      statements.push(createLocalReference(vForInfoList, vForItemUsage))
    }
  }

  // 4. 替换变量访问并添加函数体语句
  const transformedBody = replaceVariableAccess(
    t.cloneNode(body, true),
    externalVars,
    vForInfoList,
    vForItemUsage,
    paramNameMapping,
    isAsync,
  )

  statements.push(...transformedBody.body)

  return t.blockStatement(statements)
}

/**
 * 创建局部引用语句
 * 注意：这里需要从 __vmsProxyRefs 而不是外层 item 标识符开始构建路径，
 * 因为 createInlineHandlerBody 中外层 item 会被 replaceVariableAccess 替换，
 * 而不会先声明为局部变量
 */
function createLocalReference(
  vForInfoList: VForInfo[],
  vForItemUsage: VForItemUsage,
): t.VariableDeclaration {
  const itemName = vForItemUsage.itemName
  const targetItemIndex = vForInfoList.findIndex((info) => getVForItemName(info) === itemName)
  // useProxyRefsBase=true：强制从 __vmsProxyRefs 开始，不引用外层 item 标识符
  const accessExpression = buildProxyRefsItemAccess(vForInfoList, targetItemIndex, undefined, true)

  return t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier(itemName), accessExpression),
  ])
}

/**
 * 替换变量访问
 */
function replaceVariableAccess(
  body: t.BlockStatement,
  externalVars: Set<string>,
  vForInfoList?: VForInfo[],
  vForItemUsage?: VForItemUsage | null,
  paramNameMapping?: Map<string, string>,
  isAsync: boolean = false,
): t.BlockStatement {
  const localVars = new Set<string>()

  // 将 BlockStatement 转换为代码字符串，然后解析为完整的 AST
  // 注意：需要传递async标志，否则babel无法解析await关键字
  const ast = reparseBodyAsAST(body, isAsync)

  // 第一阶段：收集局部变量
  traverse(ast, {
    ...createLocalVarCollector(localVars),
  })

  // 第二阶段：替换外部变量访问（需要等局部变量收集完成后才能执行）
  traverse(ast, {
    Identifier(path) {
      const name = path.node.name

      // 处理参数名映射（如 $event -> __vms_event）
      if (paramNameMapping && paramNameMapping.has(name)) {
        const mappedName = paramNameMapping.get(name)!
        path.replaceWith(t.identifier(mappedName))
        return
      }

      // 跳过局部变量
      if (localVars.has(name)) {
        return
      }

      // 跳过对象属性的 key
      const parent = path.parent
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return
      }

      // 跳过成员表达式的属性
      if (t.isMemberExpression(parent) && parent.property === path.node && !parent.computed) {
        return
      }

      // 跳过可选链成员表达式的属性
      if (
        t.isOptionalMemberExpression(parent) &&
        parent.property === path.node &&
        !parent.computed
      ) {
        return
      }

      // 处理 v-for item
      if (vForInfoList && vForInfoList.length > 0) {
        // 检查是否是任何 v-for item（包括嵌套的）
        let isVForItem = false
        let itemIndex = -1

        // 遍历所有 v-for 信息，检查是否是 v-for item
        for (let i = 0; i < vForInfoList.length; i++) {
          const vForInfo = vForInfoList[i]
          const itemName = getVForItemName(vForInfo)
          if (name === itemName) {
            isVForItem = true
            itemIndex = i
            break
          }
        }

        if (isVForItem) {
          // 如果是 innermost v-for item，检查是否需要创建引用
          if (itemIndex === vForInfoList.length - 1 && vForItemUsage?.shouldCreateReference) {
            // 已创建局部引用，不需要替换
            return
          } else {
            // 未创建引用或不是 innermost item，需要替换为正确的访问路径
            const accessExpression = buildProxyRefsItemAccess(vForInfoList, itemIndex)

            path.replaceWith(accessExpression)
            return
          }
        }

        // 处理 v-for index
        const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
        if (indices.includes(name)) {
          // index 不需要替换，保持原样
          return
        }
      }

      // 处理外部变量
      if (externalVars.has(name)) {
        path.replaceWith(t.memberExpression(t.identifier('__vmsProxyRefs'), t.identifier(name)))
      }
    },
  })

  // 从修改后的 AST 中提取 body
  const arrowFunc = (ast.program.body[0] as t.ExpressionStatement)
    .expression as t.ArrowFunctionExpression
  return arrowFunc.body as t.BlockStatement
}
