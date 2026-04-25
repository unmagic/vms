import { getComponentMatcher, VMS_FIXED_TAG_PREFIX } from '@/utils/constants'
import * as t from '@babel/types'
import { getExpressionTSAst, getIdentifiersWithoutVForVariables } from '@/utils/ast'
import type {
  VForInfo,
  VMSCodegenNode,
  VMSRootNode,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import type { ScriptScope } from '@/types/scope'
import {
  isPropsVariable,
  isMacroVariable,
  isImportVariable,
  isGlobalVariableInScope,
} from '@/script/scopeAnalyzer'
import {
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  NodeTypes,
  type TemplateChildNode,
} from '@vue/compiler-core'

/**
 * 创建编译期上下文，每次 parseTemplate 调用时新建，不跨编译复用
 * @param scriptScope 可选的 ScriptScope，用于变量来源分析
 */
export function createVMSTransformContext(scriptScope?: ScriptScope): VMSTransformContext {
  return {
    vForInfoMap: new WeakMap(),
    bridgedFunctions: new Set(),
    internalVars: new Set(),
    renderVars: new Set(),
    needsProxyRefs: false,
    scriptScope,
    rootElementNode: null,
  }
}

// ── vForInfoMap helpers ──────────────────────────────────────────────────────

export function setVForInfoList(ctx: VMSTransformContext, node: object, list: VForInfo[]): void {
  ctx.vForInfoMap.set(node, list)
}

export function getVForInfoList(ctx: VMSTransformContext, node: object): VForInfo[] | undefined {
  return ctx.vForInfoMap.get(node)
}

// ── codegenNode helpers（节点自持）───────────────────────────────────────────

/**
 * 获取或创建节点的 codegenNode
 * 节点自身持有 codegenNode，不再通过 ctx 存储
 */
export function getCodegenNode(node: object): VMSCodegenNode | undefined {
  return (node as any).__vmsCodegenNode
}

/**
 * 获取或创建节点的 codegenNode 下的 Props
 * 节点自身持有 codegenNode，不再通过 ctx 存储
 */
export function getCodegenNodeProps(node: object): Required<VMSCodegenNode>['props'] {
  const existingCodegen = getCodegenNode(node)
  return existingCodegen?.props ?? (new Map() as Required<VMSCodegenNode>['props'])
}

/**
 * 设置节点的 codegenNode
 * @param forceUpdate 是否强制更新 codegenNode
 */
export function setCodegenNode(node: object, codegenNode: VMSCodegenNode): void {
  const existingCodegen = getCodegenNode(node)
  if (existingCodegen?.tag?.startsWith(VMS_FIXED_TAG_PREFIX)) {
    ;(node as any).__vmsCodegenNode = codegenNode
    if (codegenNode) {
      ;(node as any).__vmsCodegenNode.tag = existingCodegen.tag
    }
  } else {
    ;(node as any).__vmsCodegenNode = codegenNode
  }
}

/**
 * 判断是否为 v-for 属性
 * @param prop
 */
function isVForProp(prop: AttributeNode | DirectiveNode): boolean {
  return prop.type === NodeTypes.DIRECTIVE && prop.rawName === 'v-for'
}

/**
 * 判断节点是否为 v-for 节点
 * @param node
 */
export function isVForNode(node: VMSTemplateChildNode) {
  return (node as ElementNode).props?.find(isVForProp)
}

/**
 * 收集第三方组件及小程序原生的自定义组件库
 * @param node
 * @param thirdPartyComponents
 */
export function collectThirdComponents(
  node: VMSRootNode | VMSTemplateChildNode,
  thirdPartyComponents: Map<string, string>,
): void {
  const tag = (node as any).tag
  if (node.type === 1) {
    if (tag) {
      const path = getComponentMatcher.match(tag)
      if (path) {
        thirdPartyComponents.set(tag, path)
      }
    }
  }
}

/**
 * 添加返回值变量（内部路径，不标记为渲染变量）
 * @param {ObjectExpression} returnValue
 * @param {string} key
 */
export function addProperty(returnValue: t.ObjectExpression, key: string): void {
  if (!returnValue.properties.some((p) => (p as any).key.name === key)) {
    const bindingVarId = t.identifier(key)
    returnValue.properties.push(t.objectProperty(bindingVarId, bindingVarId, false, true))
  }
}

/**
 * 添加返回值变量，并标记为模板直接绑定的渲染变量
 * @param {ObjectExpression} returnValue
 * @param {string} key
 * @param {VMSTransformContext} ctx
 */
/**
 * 检查变量是否应该被收集到 render state
 * 使用 scriptScope 进行变量来源分析
 * @returns 'render' | 'import' | 'skip' - 分别表示：收集到 renderVars、是导入变量、跳过
 */
function shouldCollectVariable(
  varName: string,
  scriptScope: ScriptScope | undefined,
): 'render' | 'import' | 'skip' {
  if (!scriptScope) return 'render'

  // 排除 props、宏、全局变量
  if (isPropsVariable(varName, scriptScope)) return 'skip'
  if (isMacroVariable(varName, scriptScope)) return 'skip'
  if (isGlobalVariableInScope(varName, scriptScope)) return 'skip'

  // 导入的变量需要特殊处理：收集到 returnValue，但不放入 renderVars
  if (isImportVariable(varName, scriptScope)) return 'import'

  return 'render'
}

export function addRenderProperty(
  returnValue: t.ObjectExpression,
  key: string,
  ctx: VMSTransformContext,
): void {
  // 如果传入了 scriptScope，检查变量应该如何被收集
  const collectType = shouldCollectVariable(key, ctx.scriptScope)

  if (collectType === 'skip') {
    return
  }

  addProperty(returnValue, key)

  // 只有非导入变量才添加到 renderVars
  if (collectType === 'render') {
    ctx.renderVars.add(key)
  }
  // 导入变量不添加到 renderVars，它们会直接从模块作用域访问
}

/**
 * 根据表达式，收集setup的返回值变量，并排除掉指定的变量名称
 */
export function collectBindingVarsWithExpression(
  expression: string,
  node: TemplateChildNode,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
  excludedBindingVars: string[] = [],
): void {
  const extraBindingVars = getIdentifiersWithoutVForVariables(
    getExpressionTSAst(expression),
    getVForVariables(ctx, node),
  )
  excludedBindingVars.forEach((item) => extraBindingVars.delete(item))
  extraBindingVars.forEach((bindingVar) => {
    addRenderProperty(returnValue, bindingVar, ctx)
  })
}

/**
 * 根据AST，收集setup的返回值变量，并排除掉指定的变量名称
 * 现在使用 scriptScope 进行更精确的变量来源分析
 */
export function collectBindingVarsWithAST(
  ast: t.Node,
  node: VMSTemplateChildNode,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
  excludedBindingVars: string[] = [],
): void {
  const extraBindingVars = getIdentifiersWithoutVForVariables(ast, getVForVariables(ctx, node))
  excludedBindingVars.forEach((item) => extraBindingVars.delete(item))

  // 使用 shouldCollectVariable 进行过滤
  extraBindingVars.forEach((varName) => {
    const collectType = shouldCollectVariable(varName, ctx.scriptScope)
    if (collectType === 'skip') return
    addRenderProperty(returnValue, varName, ctx)
  })
}

/**
 * 根据变量名，收集setup的返回值变量
 */
export function collectBindingVarsWithVarName(
  varName: string,
  node: TemplateChildNode,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
): void {
  const vForVars = getVForVariables(ctx, node)
  if (vForVars.has(varName)) {
    return
  }
  addRenderProperty(returnValue, varName, ctx)
}

/**
 * 根据变量名列表，收集setup的返回值变量
 */
export function collectBindingVarsWithVarNameList(
  varNameList: string[],
  node: TemplateChildNode,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
): void {
  const vForVars = getVForVariables(ctx, node)
  varNameList
    .filter((item) => !vForVars.has(item))
    .forEach((varName) => addRenderProperty(returnValue, varName, ctx))
}

/**
 * 检查表达式是否包含v-for变量
 * @param ast
 * @param vForVariables
 * @returns {boolean}
 */
export function containsVForVariable(ast: t.Node, vForVariables: Set<string>): boolean {
  if (!ast) return false

  switch (ast.type) {
    case 'Identifier':
      return vForVariables.has(ast.name)
    case 'MemberExpression':
      return (
        containsVForVariable(ast.object, vForVariables) ||
        containsVForVariable(ast.property, vForVariables)
      )
    case 'BinaryExpression':
    case 'LogicalExpression':
      return (
        containsVForVariable(ast.left, vForVariables) ||
        containsVForVariable(ast.right, vForVariables)
      )
    case 'ConditionalExpression':
      return (
        containsVForVariable(ast.test, vForVariables) ||
        containsVForVariable(ast.consequent, vForVariables) ||
        containsVForVariable(ast.alternate, vForVariables)
      )
    case 'CallExpression':
      // 检查callee
      if (containsVForVariable(ast.callee, vForVariables)) {
        return true
      }
      // 检查参数
      for (const arg of ast.arguments) {
        if (containsVForVariable(arg, vForVariables)) {
          return true
        }
      }
      return false
    default:
      return false
  }
}

/**
 * WXS 环境中可安全调用的全局标识符白名单
 */
export const WXS_SAFE_GLOBALS = new Set([
  'String',
  'Number',
  'Boolean',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Math',
  'Date',
  'JSON',
])

/**
 * 检查调用表达式是否包含外部函数调用
 * @param node
 * @returns {boolean}
 */
export function containsExternalFunctionCall(node: any): boolean {
  // 检查调用表达式的callee是否为简单标识符（可能为外部导入的函数）
  if (node.callee?.type === 'Identifier') {
    // 如果标识符在 Safe_Global 白名单中，则不视为外部函数
    if (WXS_SAFE_GLOBALS.has(node.callee.name)) {
      return false
    }
    return true
  }

  // 对于其他情况，暂时返回false，可以后续扩展
  return false
}

/**
 * 检查表达式AST中是否包含外部函数调用
 * @param ast
 * @returns {boolean}
 */
export function containsExternalFunctionInExpression(ast: any): boolean {
  if (!ast) return false

  let hasExternalFunction = false

  // 遍历AST节点
  function traverse(node: any): void {
    if (!node || hasExternalFunction) return

    if (node.type === 'CallExpression') {
      if (containsExternalFunctionCall(node)) {
        hasExternalFunction = true
        return
      }
    }

    // 递归遍历子节点
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const child = node[key]
        if (typeof child === 'object' && child !== null) {
          if (Array.isArray(child)) {
            child.forEach(traverse)
          } else {
            traverse(child)
          }
        }
      }
    }
  }

  traverse(ast)
  return hasExternalFunction
}

/**
 * 检查表达式是否为复杂表达式
 * @param ast
 * @returns {boolean}
 */
export function isComplexExpression(ast: t.Node): boolean {
  // 如果节点为空，返回false
  if (!ast) return false

  // 检查节点类型
  switch (ast.type) {
    // 简单的字面量和标识符不是复杂表达式
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'Identifier':
    case 'NullLiteral':
      return false

    // 条件（三元）表达式是复杂表达式
    case 'ConditionalExpression':
      return true

    // 一元表达式递归检查操作数
    case 'UnaryExpression':
      // typeof 运算符需要走 WXS 函数生成路径
      if (ast.operator === 'typeof') return true
      return isComplexExpression(ast.argument)

    // 二元表达式：递归检查左右操作数
    case 'BinaryExpression':
      return isComplexExpression(ast.left) || isComplexExpression(ast.right)

    // 成员表达式递归检查对象和属性
    case 'MemberExpression':
      return isComplexExpression(ast.object) || isComplexExpression(ast.property)

    // 可选链成员表达式：需要转换为 WXS
    case 'OptionalMemberExpression':
      return true

    // 调用表达式（函数调用）是复杂表达式
    case 'CallExpression':
      return true

    // 其他类型默认为复杂表达式
    default:
      return true
  }
}

/**
 * 表达式缓存条目接口
 */
export interface ExpressionCacheEntry {
  content: string
  wxsStatement?: import('@babel/types').ExpressionStatement
}

/**
 * 获取v-for变量集合（从 WeakMap context 读取）
 */
export function getVForVariables(ctx: VMSTransformContext, node: object): Set<string> {
  const variables = new Set<string>()
  const list = ctx.vForInfoMap.get(node)
  if (!list) return variables

  for (const vForInfo of list) {
    const parseResult = vForInfo.forParseResult
    if (parseResult.value?.type === NodeTypes.SIMPLE_EXPRESSION) {
      variables.add(parseResult.value.content)
    }
    if (parseResult.key?.type === NodeTypes.SIMPLE_EXPRESSION) {
      variables.add(parseResult.key.content)
    }
  }
  return variables
}

/**
 * 检查节点是否在v-for循环内（ctx-based）
 */
export function isInsideVFor(ctx: VMSTransformContext, node: object): boolean {
  const list = ctx.vForInfoMap.get(node)
  return !!(list && list.length > 0)
}

/**
 * 获取最内层的v-for信息（ctx-based）
 */
export function getInnermostVForInfo(ctx: VMSTransformContext, node: object): VForInfo | null {
  const list = ctx.vForInfoMap.get(node)
  if (!list || list.length === 0) return null
  return list[list.length - 1]
}

/**
 * 极简内存优化的v-for信息分配，写入 WeakMap 而非原始 AST 节点
 *
 * ⚠️  **必须在 `traverseNode` 之前调用**（即在 createTransformContext/traverseNode 之前）。
 *
 * 原因：此函数对整棵 AST 树做一次前序遍历，将每个节点的祖先 v-for 上下文信息
 * 预填充到 `ctx.vForInfoMap` 中。后续的 nodeTransforms（如 transformVForProp、
 * transformKeyProp 等）在运行时会通过 `getVForInfoList(ctx, node)` 读取这些信息。
 *
 * 如果在 `traverseNode` 之后调用，或根本未调用，v-for 相关的转换器将读取到空数据，
 * 导致嵌套 v-for 的 item/index 变量名计算错误。
 *
 * 调用示例（正确顺序）：
 * ```ts
 * assignVForInfoListMinimal(templateAST, ctx)  // ← 必须第一步
 * const context = createTransformContext(templateAST, { nodeTransforms })
 * traverseNode(templateAST, context)
 * ```
 */
export function assignVForInfoListMinimal(
  rootNode: VMSRootNode | VMSTemplateChildNode,
  ctx: VMSTransformContext,
): void {
  if (!rootNode) return

  const stack: Array<{
    node: VMSRootNode | VMSTemplateChildNode
    parentVForInfoList?: VForInfo[]
    hasVForInAncestry: boolean
  }> = []

  stack.push({ node: rootNode, parentVForInfoList: undefined, hasVForInAncestry: false })

  while (stack.length > 0) {
    const { node, parentVForInfoList, hasVForInAncestry } = stack.pop()!
    const vFor = isVForNode(node as TemplateChildNode)

    if (vFor && vFor.type === NodeTypes.DIRECTIVE && vFor.forParseResult) {
      const vForInfo: VForInfo = {
        forParseResult: vFor.forParseResult,
        depth: parentVForInfoList ? parentVForInfoList.length : 0,
        parent: parentVForInfoList?.length
          ? parentVForInfoList[parentVForInfoList.length - 1]
          : undefined,
      }
      const newVForInfoList = parentVForInfoList ? [...parentVForInfoList, vForInfo] : [vForInfo]
      setVForInfoList(ctx, node, newVForInfoList)

      const children = (node as any).children
      if (Array.isArray(children)) {
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({
            node: children[i],
            parentVForInfoList: newVForInfoList,
            hasVForInAncestry: true,
          })
        }
      }
    } else {
      if (hasVForInAncestry && parentVForInfoList) {
        setVForInfoList(ctx, node, parentVForInfoList)
      }
      const children = (node as any).children
      if (Array.isArray(children)) {
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ node: children[i], parentVForInfoList, hasVForInAncestry })
        }
      }
    }
  }
}

export function isNotMergeProps(prop: AttributeNode | DirectiveNode): boolean {
  return prop.name !== 'style' && prop.name !== 'class'
}
