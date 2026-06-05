/**
 * 内联事件处理函数生成 - 负责函数体构建、变量替换、v-for item 分析
 * 从 eventProcessor.ts 拆分而来
 */

import t from '@babel/types'
import { generate } from '@babel/generator'
import { parse as babelParse } from '@babel/parser'
import { traverse } from '@/utils/babelTraverse'
import type { VForInfo, VMSTransformContext } from '@/types/node'
import { getVForItemName, getVForIndexName } from '@/utils/tools'
import { GLOBAL_WHITELIST } from '@/utils/globalWhitelist'
import {
  shouldCreateLocalReference,
  buildProxyRefsItemAccess,
  EVENT_PARAM_NAME,
  type VForItemUsage,
} from './eventHelpers'
import { createLocalVarCollector } from './variableCollector'
import type { ScriptScope } from '@/types/scope'

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
export function reparseBodyAsAST(body: t.BlockStatement, isAsync: boolean): t.File {
  const arrowFunction = t.arrowFunctionExpression([], body, isAsync)
  // 不能使用 compact: true，否则多语句 BlockStatement 的 { } 会被移除
  const code = generate(arrowFunction).code
  return babelParse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
  })
}

/**
 * 收集函数体中使用的外部变量
 * @param preParsedAst 可选，预解析的 AST（来自 reparseBodyAsAST），避免重复解析
 */
export function collectUsedVariables(
  body: t.BlockStatement,
  arrowFunctionArguments: any[],
  vForInfoList?: VForInfo[],
  isAsync: boolean = false,
  preParsedAst?: t.File,
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
      if (t.isIdentifier(param.left)) {
        localVars.add(param.left.name)
      }
    } else if (t.isRestElement(param)) {
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

  // 复用预解析的 AST，避免重复 generate→parse 往返
  const ast = preParsedAst ?? reparseBodyAsAST(body, isAsync)

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
 * @param preParsedAst 可选，预解析的 AST（来自 reparseBodyAsAST），避免重复解析
 */
export function analyzeVForItemUsage(
  body: t.BlockStatement,
  vForInfoList: VForInfo[],
  isAsync: boolean = false,
  preParsedAst?: t.File,
): VForItemUsage {
  const lastVForInfo = vForInfoList[vForInfoList.length - 1]
  const itemName = getVForItemName(lastVForInfo)
  const usages: VForItemUsage['usages'] = []

  // 复用预解析的 AST，避免重复 generate→parse 往返
  const ast = preParsedAst ?? reparseBodyAsAST(body, isAsync)
  const localVars = new Set<string>()
  let hasLocalItemVar = false

  traverse(ast, {
    ...createLocalVarCollector(localVars),
    VariableDeclarator(path) {
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

  const shouldCreate = shouldCreateLocalReference(usages)

  return {
    itemName,
    usageCount: usages.length,
    usages,
    shouldCreateReference: shouldCreate,
  }
}

/**
 * 创建局部引用语句
 */
function createLocalReference(
  vForInfoList: VForInfo[],
  vForItemUsage: VForItemUsage,
  scriptScope?: ScriptScope,
): t.VariableDeclaration {
  const itemName = vForItemUsage.itemName
  const targetItemIndex = vForInfoList.findIndex((info) => getVForItemName(info) === itemName)
  const accessExpression = buildProxyRefsItemAccess(
    vForInfoList,
    targetItemIndex,
    scriptScope,
    true,
  )

  return t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier(itemName), accessExpression),
  ])
}

/**
 * 创建内联处理函数的函数体
 * @param preParsedAst 可选，预解析的 AST，避免在 replaceVariableAccess 中重复解析
 */
export function createInlineHandlerBody(
  body: t.BlockStatement,
  arrowFunctionArguments: any[],
  externalVars: Set<string>,
  vForInfoList?: VForInfo[],
  vForItemUsage?: VForItemUsage | null,
  isAsync: boolean = false,
  dataKey: string = 'a',
  scriptScope?: ScriptScope,
  preParsedAst?: t.File,
): t.BlockStatement {
  const statements: t.Statement[] = []
  const paramNameMapping = new Map<string, string>()

  // 1. 处理箭头函数参数
  if (arrowFunctionArguments.length > 0) {
    const param = arrowFunctionArguments[0]

    if (t.isIdentifier(param)) {
      if (param.name !== '$event' && param.name !== EVENT_PARAM_NAME) {
        statements.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              param,
              t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail')),
            ),
          ]),
        )
      } else if (param.name === '$event') {
        paramNameMapping.set('$event', EVENT_PARAM_NAME)
      }
    } else if (t.isObjectPattern(param)) {
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

    // 3. 创建局部引用（如果需要）
    if (vForItemUsage?.shouldCreateReference) {
      statements.push(createLocalReference(vForInfoList, vForItemUsage, scriptScope))
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
    scriptScope,
    preParsedAst,
  )

  statements.push(...transformedBody.body)

  return t.blockStatement(statements)
}

/**
 * 替换变量访问
 * @param preParsedAst 可选，预解析的 AST（来自 reparseBodyAsAST），避免重复解析
 */
export function replaceVariableAccess(
  body: t.BlockStatement,
  externalVars: Set<string>,
  vForInfoList?: VForInfo[],
  vForItemUsage?: VForItemUsage | null,
  paramNameMapping?: Map<string, string>,
  isAsync: boolean = false,
  scriptScope?: ScriptScope,
  preParsedAst?: t.File,
): t.BlockStatement {
  const localVars = new Set<string>()

  // 复用预解析的 AST，避免重复 generate→parse 往返
  const ast = preParsedAst ?? reparseBodyAsAST(body, isAsync)

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
        let isVForItem = false
        let itemIndex = -1

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
          if (itemIndex === vForInfoList.length - 1 && vForItemUsage?.shouldCreateReference) {
            return
          } else {
            const accessExpression = buildProxyRefsItemAccess(vForInfoList, itemIndex, scriptScope)
            path.replaceWith(accessExpression)
            return
          }
        }

        const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
        if (indices.includes(name)) {
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

/**
 * 重写表达式中的变量引用
 * 将外部变量、props、箭头函数参数替换为正确的访问路径
 */
export function rewriteExpressionVars(
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
      const left = node.left
      if (t.isIdentifier(left) || t.isMemberExpression(left)) {
        const rewritten = processExpr(left as t.Expression)
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
