import t from '@babel/types'
import { NodeTypes } from '@vue/compiler-core'
import type {
  VMSAttrOrDirectiveNode,
  VMSCounter,
  VForInfo,
  VMSTransformContext,
} from '@/types/node'
import {
  collectBindingVarsWithAST,
  addProperty,
  getVForVariables,
  getVForInfoList,
  resolveDestructuredVar,
} from '../tools'
import { getVForItemName, getVForIndexName } from '@/utils/tools'
import {
  getFunctionIndexChar,
  getASTWithVForItemFromProxyRefs,
  getASTWithoutVForItemFromProxyRefs,
  resolveItemsToDeclare,
  declareVForItems,
  EVENT_PARAM_NAME,
  type CallExpressionInfo,
  type VForItemUsage,
} from './eventHelpers'
import { fallbackParseExpression } from '../expression'
import { GLOBAL_WHITELIST } from '@/utils/globalWhitelist'
import { createCompileError } from '@/utils/errorHandler'
import { generate } from '@babel/generator'
// 从拆分模块导入
import {
  shouldSkipVariable,
  collectExternalVarsFromArgs,
  collectExternalVarsFromExpression,
} from './variableCollector'
import {
  reparseBodyAsAST,
  collectUsedVariables,
  analyzeVForItemUsage,
  createInlineHandlerBody,
  rewriteExpressionVars,
} from './inlineHandler'

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
  } else if (t.isUpdateExpression(ast)) {
    // 处理自增/自减表达式：@tap="count++" / @tap="count--"
    // 将更新表达式包装为 BlockStatement 处理
    const wrappedBody = t.blockStatement([t.expressionStatement(ast)])
    return processInlineArrowFunction(
      wrappedBody,
      [], // 更新表达式没有箭头函数参数
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

  // 未识别的事件表达式形态：显式报错而非生成空事件处理器，
  // 避免运行时事件静默失效
  throw createCompileError(
    `暂不支持的事件处理表达式：${generate(ast, { compact: true }).code}，` +
      `请改用方法引用（onTap）、带参数调用（onTap(args)）、内联箭头函数或赋值表达式`,
    ast.loc ?? null,
  )
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
  // 统一使用节点内 dataKey 计数器，与内联处理器共用编号空间，
  // 避免同一节点上两类处理器分配到相同的 data-a 键
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
  } else {
    // 其他 callee 形式（如 a.b.c()、a?.b()、a[b]() 的多层/可选/计算访问）暂不支持，
    // 显式报错而非生成未注册的空事件处理器，避免运行时静默失效
    throw createCompileError(
      `暂不支持的事件处理表达式：${generate(callee, { compact: true }).code}，` +
        `请改用方法引用（onTap）、单层成员方法（obj.onTap）或内联箭头函数`,
      callee.loc,
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

  // v-for 的 item **与 index** 都是桥接函数内的局部变量：
  // 前者经 data-a 索引还原，后者直接由 dataset 解构得到。
  // 只判断 item 会让 index.go() 落入下面的"外部变量"分支，
  // 被错误注册进组件 data（__vmsInternalState）并在运行时悬空。
  const isVForIndexName =
    vForInfoList?.some((info) => (getVForIndexName(info) || 'index') === calleeName) ?? false

  if (
    (vForItemName.has(calleeName) || isVForIndexName) &&
    vForInfoList &&
    vForInfoList.length > 0
  ) {
    // v-for item/index 方法：card.onClick(args) → data-a 只传索引
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
    // 在 v-for 中：参数里引用了 index（如 logger.log(index)）或外层 item 时，
    // dataKey 需要传索引，否则桥接函数中 index 标识符悬空
    const indices = vForInfoList
      ? vForInfoList.map((info) => getVForIndexName(info) || 'index')
      : []
    const needsIndices =
      vForInfoList &&
      vForInfoList.length > 0 &&
      Array.isArray(argumentsAst) &&
      argumentsAst.length > 0
    callExpressionWithArgs.set(content, {
      dataKey: needsIndices ? dataKey : '',
      dataArgsAst:
        needsIndices && indices.length > 0 ? indices.map((idx) => t.identifier(idx)) : null,
      returnValueBodyAst: getASTWithoutVForItemFromProxyRefs(
        callee,
        argumentsAst,
        arrowFunctionArgumentNames,
        vForInfoList,
        vForItemName,
        needsIndices ? dataKey : undefined,
        needsIndices,
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

  // 未识别的箭头函数体形态：显式报错而非生成空事件处理器
  throw createCompileError(
    `暂不支持的内联事件函数体：${generate(ast, { compact: true }).code}，` +
      `请改用函数调用、赋值或条件表达式`,
    ast.loc ?? null,
  )
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
  // dataKey 统一从节点内计数器分配，与可调用处理器共用编号空间
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

    // 声明表达式中引用的 v-for item 局部变量（如 item.active && log(item.id) 中的 item）。
    // 直接遍历表达式 AST 收集被引用的 item 名，不依赖 varsToCollect
    //（varsToCollect 只含需要 proxyRefs 改写的 setup 变量）
    const referencedItems = new Set<string>()
    const allItemNames = new Set(vForInfoList.map((info) => getVForItemName(info)).filter(Boolean))
    const scanReferencedItems = (node: t.Node | null | undefined): void => {
      if (!node) return
      if (t.isIdentifier(node) && allItemNames.has(node.name)) {
        referencedItems.add(node.name)
        return
      }
      const visitorKeys = t.VISITOR_KEYS[node.type]
      if (!visitorKeys) return
      for (const key of visitorKeys) {
        const value = (node as unknown as Record<string, unknown>)[key]
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child === 'object' && Object.hasOwn(child, 'type')) {
              scanReferencedItems(child as t.Node)
            }
          }
        } else if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) {
          scanReferencedItems(value as t.Node)
        }
      }
    }
    scanReferencedItems(body)
    // 解构式 v-for 变量映射到所属层级的 item
    for (const varName of varsToCollect) {
      const resolved = resolveDestructuredVar(varName, vForInfoList)
      if (resolved) {
        referencedItems.add(getVForItemName(vForInfoList[resolved.level]))
      }
    }
    if (referencedItems.size > 0) {
      const itemsToDeclare = resolveItemsToDeclare(referencedItems, vForInfoList)
      declareVForItems(itemsToDeclare, vForInfoList, statements, ctx.scriptScope)
    }
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
 * 小程序无对应语义、会被静默忽略的事件修饰符。
 *
 * 这些是 Vue 在**浏览器 DOM 事件模型**下提供的修饰符，小程序的事件系统
 * （bind/catch/mut-bind/capture-*）没有等价能力。若静默忽略，产物看起来正常
 * 但行为缺失——例如 `.prevent` 不阻止默认行为、`.once` 会重复触发。
 * 按"产物必须符合小程序规范且不静默失效"的原则，这里编译期报错。
 *
 * 注意：`.stop`（→ catch:）、`.mut`（→ mut-bind:）、`.capture`（→ capture-bind:）、
 * `.capture-stop`（→ capture-catch:）以及 `.raw`（保留事件名）**均有映射**，
 * 不在此列。
 */
const UNSUPPORTED_EVENT_MODIFIERS: Record<string, string> = {
  prevent: '小程序事件无"默认行为"概念，无需且无法阻止；请在业务逻辑中避免副作用',
  self: '小程序事件对象无 target/currentTarget 区分能力，请在处理器内判断来源',
  once: '小程序无一次触发机制，请在处理器内自行保证只执行一次（如加标志位）',
  passive: '小程序无 passive 概念（不影响其滚动性能），可直接移除该修饰符',
  exact: '小程序无键盘修饰符体系，可直接移除该修饰符',
  left: '小程序无鼠标按键概念（移动端触摸事件），可直接移除该修饰符',
  right: '小程序无鼠标按键概念（移动端触摸事件），可直接移除该修饰符',
  middle: '小程序无鼠标按键概念（移动端触摸事件），可直接移除该修饰符',
}

/**
 * 处理事件名转换
 * 规则：
 * 1. 事件名原样保留，不做 click -> tap 转换
 * 2. .stop 转为 catch:
 * 3. .mut 转为 mut-bind:
 * 4. .capture 转为 capture-bind:
 * 5. .capture-stop 转为 capture-catch:
 * 6. 其余无小程序等价语义的修饰符（.prevent/.once/.self 等）编译报错
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

    // 无小程序等价语义的修饰符：报错而非静默忽略
    for (const mod of modifiers) {
      const advice = UNSUPPORTED_EVENT_MODIFIERS[mod.content]
      if (advice) {
        throw createCompileError(`.${mod.content} 修饰符不支持：${advice}`, mod.loc ?? prop.loc)
      }
    }

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
    throw createCompileError('事件名必须是简单表达式：' + prop.loc.source, prop.loc)
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

  // 1. 预解析 AST（只解析一次，供后续三个阶段复用）
  const preParsedAst = reparseBodyAsAST(body, isAsync)

  // 2. 收集外部变量
  const vForInfoList = getVForInfoList(ctx, node)
  const usedVars = collectUsedVariables(
    body,
    arrowFunctionArguments,
    vForInfoList,
    isAsync,
    preParsedAst,
  )

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

  // 3. 分析 v-for item 使用情况
  let vForItemUsage: VForItemUsage | null = null
  if (vForInfoList && vForInfoList.length > 0) {
    vForItemUsage = analyzeVForItemUsage(body, vForInfoList, isAsync, preParsedAst)
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

  // 4. 生成函数体
  // dataKey 统一使用节点内计数器，与可调用处理器共用编号空间，
  // 避免同一节点上两类处理器分配到相同的 data-a 键
  const dataKey =
    vForInfoList && vForInfoList.length > 0 ? getFunctionIndexChar(counter.nodeDataKeyIndex++) : ''

  const functionBody = createInlineHandlerBody(
    body,
    arrowFunctionArguments,
    usedVars,
    vForInfoList,
    vForItemUsage,
    isAsync,
    dataKey,
    ctx.scriptScope,
    preParsedAst,
  )

  // 5. 存储函数信息
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
