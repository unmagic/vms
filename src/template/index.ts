import { createTransformContext, traverseNode } from '@vue/compiler-dom'
import * as t from '@babel/types'
import { generateWxml } from '@/template/generator'
import {
  collectThirdComponents,
  createVMSTransformContext,
  setCodegenNode,
  getCodegenNode,
  assignVForInfoListMinimal,
} from '@/template/tools'
import { transformSlotsAndTemplate } from '@/template/nodeProps/slot'
import { transformEventHandlers } from '@/template/nodeProps/event'
import { transformTemplateClass } from '@/template/nodeProps/clazz'
import { transformTemplateStyle } from '@/template/nodeProps/style'
import { getTemplateNodeProp } from '@/template/expression'
import type {
  VMSCodegenNode,
  VMSCounter,
  VMSTransformResult,
  PropTransformResult,
  VMSTransformContext,
} from '@/types/node'
import type { VMSTemplateChildNode } from '@/types/node'
import type { ScriptScope } from '@/types/scope'
import {
  NodeTypes,
  type NodeTransform,
  type RootNode,
  type TemplateChildNode,
  type InterpolationNode,
  type TextNode,
  type CommentNode,
  type ElementNode,
} from '@vue/compiler-core'
import { generate } from '@babel/generator'
import { getComponentMatcher, WXS_NAMESPACE } from '@/utils/constants'
import { getPolyfillFileRelativePath } from '@/utils/tools'
import { propTransformers, mergePropResults, type TransformerContext } from './propTransformers'
import { createCompileError } from '@/utils/errorHandler'

/**
 * Vue 内置组件：小程序没有对应实现，必须编译报错。
 *
 * 若放行，它们会作为**未注册的自定义组件**出现在产物中
 * （`usingComponents` 里没有对应条目），小程序运行时不渲染任何内容。
 * 这属于"文档说不支持、编译期却不拦截"的静默失效。
 *
 * 注意：只拦截 Vue 的内置组件名。同名的小写标签（如 `<transition>`）
 * 或用户自己注册的同名组件不在拦截范围——后者由 usingComponents 正常处理。
 */
const BUILT_IN_COMPONENTS: Record<string, string> = {
  Teleport: '小程序无传送门机制，请把内容直接写在目标位置',
  teleport: '小程序无传送门机制，请把内容直接写在目标位置',
  Transition: '小程序过渡动画请使用 CSS transition/animation 或 wx.createAnimation',
  TransitionGroup: '小程序过渡动画请使用 CSS transition/animation',
  transition: '小程序过渡动画请使用 CSS transition/animation',
  'transition-group': '小程序过渡动画请使用 CSS transition/animation',
  BaseTransition: '小程序过渡动画请使用 CSS transition/animation',
  'base-transition': '小程序过渡动画请使用 CSS transition/animation',
  KeepAlive: '小程序页面天然缓存，组件级缓存请用 wx:if 配合状态保持',
  'keep-alive': '小程序页面天然缓存，组件级缓存请用 wx:if 配合状态保持',
  Suspense: 'VMS 为同步编译，无异步组件加载概念，可直接移除',
  suspense: 'VMS 为同步编译，无异步组件加载概念，可直接移除',
  // 仅小写 `component` 是 Vue 的动态组件（与 Vue 的 isComponent 判定一致）
  component:
    '小程序无动态组件机制（无 <component :is>）。请改用 wx:if / wx:elif 按条件渲染各候选组件',
}

function assertNoBuiltInComponent(node: any): void {
  if (node.type !== NodeTypes.ELEMENT) return
  const tag = (node as ElementNode).tag
  // 仅拦截 PascalCase 的 Vue 内置组件名（模板中用户组件通常也是 PascalCase，
  // 但内置名是保留的，不存在合法用户组件与之同名）
  const advice = BUILT_IN_COMPONENTS[tag]
  if (!advice) return
  throw createCompileError(`<${tag}> 是 Vue 内置组件，小程序不支持：${advice}`, node.loc ?? null)
}

function parseTemplate(
  templateAST: RootNode,
  filePath: string,
  isPage: boolean = false,
  scriptScope?: ScriptScope,
): VMSTransformResult {
  // Create a fresh context per compile — never reuse across compiles
  // 传入 scriptScope 用于变量来源分析
  const ctx = createVMSTransformContext(scriptScope)

  const counter: VMSCounter = {
    wxsFunctionCounter: 0,
    functionPropertyCounter: 0,
    nodeDataKeyIndex: 0,
    vForIndexCounter: 0,
    computedCounter: 0,
    generateWxsFunctionName() {
      return `__wxs_${this.wxsFunctionCounter++}`
    },
    generateFunctionPropertyName() {
      return `__fun_${this.functionPropertyCounter++}`
    },
    generateVForIndexName(forItem: string) {
      return `_${forItem}_${this.vForIndexCounter++}_index`
    },
    generateComputedName() {
      return `__vmsComputed_${this.computedCounter++}`
    },
  }

  const wxsExpressionStatements: t.ExpressionStatement[] = []
  const returnValue = t.objectExpression([])
  const thirdPartyComponents = new Map<string, string>()

  // ⚠️  必须在 createTransformContext/traverseNode 之前调用！
  // 预填充所有节点的祖先 v-for 上下文信息到 ctx.vForInfoMap。
  // 详见 tools.ts::assignVForInfoListMinimal 的 JSDoc 说明。
  assignVForInfoListMinimal(templateAST, ctx)

  // 创建统一节点转换器 - 单次遍历完成所有处理
  const unifiedTransform = createUnifiedNodeTransform(
    returnValue,
    counter,
    wxsExpressionStatements,
    ctx,
  )

  const nodeTransforms: NodeTransform[] = [
    // 0. Vue 内置组件：小程序无对应实现，必须报错
    (node) => assertNoBuiltInComponent(node),

    // 1. 收集第三方组件
    ...(getComponentMatcher.hasConfig()
      ? [(node: any) => collectThirdComponents(node, thirdPartyComponents)]
      : []),

    // 2. 处理 slot 和 template（保持兼容）
    (node) => transformSlotsAndTemplate(node, ctx),

    // 3. class 和 style 转换（包括根节点注入逻辑）
    (node) =>
      transformTemplateClass(node, returnValue, counter, wxsExpressionStatements, ctx, isPage),
    (node) =>
      transformTemplateStyle(node, returnValue, counter, wxsExpressionStatements, ctx, isPage),

    // 4. 统一节点转换器（核心：属性转换 + codegenNode 构建）
    unifiedTransform,

    // 5. 事件处理器（保持兼容，但需要在统一转换器之后）
    (node) => transformEventHandlers(node, returnValue, counter, ctx),

    // 6. 根节点处理器 - 在遍历结束时构建根节点的 codegenNode
    createRootNodeTransform(),
  ]

  // 单次遍历：在 exit 钩子中统一构建 codegenNode
  const context = createTransformContext(templateAST, { nodeTransforms })
  traverseNode(templateAST, context)

  // 无需第二次遍历！

  const wxsScripts = generateWxsScripts(wxsExpressionStatements, filePath)
  const wxmlContent = generateWxml(wxsScripts, templateAST)

  return {
    wxmlContent,
    returnValue,
    thirdPartyComponents,
    bridgedFunctions: ctx.bridgedFunctions,
    internalVars: ctx.internalVars,
    renderVars: ctx.renderVars,
    needsProxyRefs: ctx.needsProxyRefs,
    hasDynamicSlots: ctx.hasDynamicSlots,
  }
}

/**
 * 创建统一节点转换器
 * 在单次遍历中完成属性转换和 codegenNode 构建
 */
function createUnifiedNodeTransform(
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  wxsExpressionStatements: t.ExpressionStatement[],
  ctx: VMSTransformContext,
): NodeTransform {
  // 存储每个节点的属性转换结果
  const propResultsMap = new WeakMap<object, PropTransformResult[]>()

  return (node) => {
    // 处理 INTERPOLATION 节点（如 {{ selectedStoreName }}）
    if (node.type === NodeTypes.INTERPOLATION) {
      const interpolationNode = node as InterpolationNode
      if (interpolationNode.content?.type === NodeTypes.SIMPLE_EXPRESSION) {
        // 使用 getTemplateNodeProp 处理表达式，收集变量到 returnValue
        const { content } = getTemplateNodeProp(
          node as VMSTemplateChildNode,
          { exp: interpolationNode.content, loc: node.loc },
          returnValue,
          counter,
          wxsExpressionStatements,
          ctx,
        )
        setCodegenNode(node, {
          type: NodeTypes.INTERPOLATION,
          content,
          loc: node.loc,
        })
      }
      return
    }

    // 处理 TEXT 和 COMMENT 节点
    if (node.type === NodeTypes.TEXT || node.type === NodeTypes.COMMENT) {
      const codegenNode = createSimpleCodegenNode(node)
      if (codegenNode) {
        setCodegenNode(node, codegenNode)
      }
      return
    }

    // 只处理元素节点
    if (node.type !== NodeTypes.ELEMENT) {
      return
    }

    const elementNode = node as ElementNode
    const transformCtx: TransformerContext = {
      returnValue,
      counter,
      wxsExpressionStatements,
      ctx,
      node: elementNode,
    }

    // 收集属性转换结果
    const propResults: PropTransformResult[] = []

    // 运行所有属性转换器
    for (const prop of elementNode.props || []) {
      for (const transformer of propTransformers) {
        const result = transformer(prop, transformCtx)
        if (result) {
          if (Array.isArray(result)) {
            propResults.push(...result)
          } else {
            propResults.push(result)
          }
          break // 一个属性只被一个转换器处理
        }
      }
    }

    // 存储结果供 exit 使用
    propResultsMap.set(node, propResults)

    // 返回 exit 钩子 - 在离开节点时构建 codegenNode
    return () => {
      // 此时所有子节点已处理

      // 收集子节点的 codegenNode
      const children: VMSCodegenNode[] = []
      for (const child of elementNode.children || []) {
        const childCodegen = getCodegenNode(child)
        if (childCodegen) {
          children.push(childCodegen)
        }
      }

      // 按优先级合并属性
      const results = propResultsMap.get(node) || []
      const finalProps = mergePropResults(results)

      // 检查是否已有 codegenNode（由 transformTemplateClass/transformTemplateStyle 等创建）
      const existingCodegen = getCodegenNode(node)
      if (existingCodegen?.props) {
        // 合并已有属性，已有属性优先级更高（用于根节点 class/style 注入）
        for (const [key, value] of existingCodegen.props) {
          finalProps.set(key, value)
        }
      }

      // 统一构建 codegenNode
      setCodegenNode(node, {
        type: NodeTypes.ELEMENT,
        tag: elementNode.tag,
        props: finalProps,
        children,
        loc: elementNode.loc,
      })
    }
  }
}

/**
 * 为非元素节点创建 codegenNode
 */
function createSimpleCodegenNode(node: TemplateChildNode): VMSCodegenNode | null {
  switch (node.type) {
    case NodeTypes.TEXT:
      return {
        type: NodeTypes.TEXT,
        content: (node as TextNode).content,
        loc: node.loc,
      }

    case NodeTypes.INTERPOLATION: {
      const content =
        node.content?.type === NodeTypes.SIMPLE_EXPRESSION
          ? `{{${node.content.content}}}`
          : `无法转译`
      return {
        type: NodeTypes.INTERPOLATION,
        content,
        loc: node.loc,
      }
    }

    case NodeTypes.COMMENT:
      return {
        type: NodeTypes.COMMENT,
        content: (node as CommentNode).content,
        loc: node.loc,
      }

    default:
      return null
  }
}

/**
 * 创建根节点转换器
 * 在遍历结束时构建根节点的 codegenNode
 */
function createRootNodeTransform(): NodeTransform {
  return (node) => {
    if (node.type !== NodeTypes.ROOT) return

    // 返回 exit 钩子，在离开根节点时收集所有子节点的 codegenNode
    return () => {
      const rootNode = node as RootNode
      const children: VMSCodegenNode[] = []

      for (const child of rootNode.children || []) {
        const childCodegen = getCodegenNode(child)
        if (childCodegen) {
          children.push(childCodegen)
        }
      }

      setCodegenNode(node, {
        type: NodeTypes.ROOT,
        children,
        loc: node.loc,
      })
    }
  }
}

function generateWxsScripts(
  wxsFunctions: t.ExpressionStatement[],
  filePath: string,
): string | undefined {
  if (wxsFunctions.length > 0) {
    let hasArrayUtils = false
    const functionsCode = wxsFunctions.map((stmt) => {
      const code = generate(stmt, { jsescOption: { quotes: 'single' } }).code
      if (!hasArrayUtils) {
        code.includes('__vmsWXSUtils.') && (hasArrayUtils = true)
      }
      return code
    })

    if (hasArrayUtils) {
      functionsCode.unshift(
        `var __vmsWXSUtils = require("${getPolyfillFileRelativePath('wxsUtils.wxs', filePath)}");`,
      )
    }
    return `<wxs module="${WXS_NAMESPACE}">\n${functionsCode.join('\n')}</wxs>\n`
  }
  return undefined
}

export { parseTemplate }
