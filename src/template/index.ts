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
} from '@vue/compiler-core'
import { generate } from '@babel/generator'
import { getComponentMatcher, WXS_NAMESPACE } from '@/utils/constants'
import { getPolyfillFileRelativePath } from '@/utils/tools'
import {
  propTransformers,
  mergePropResults,
  type TransformerContext,
} from './propTransformers'

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
    generateWxsFunctionName() {
      return `__wxs_${this.wxsFunctionCounter++}`
    },
    generateFunctionPropertyName() {
      return `__fun_${this.functionPropertyCounter++}`
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
    // 1. 收集第三方组件
    ...(getComponentMatcher.hasConfig()
      ? [(node: any) => collectThirdComponents(node, thirdPartyComponents)]
      : []),

    // 2. 处理 slot 和 template（保持兼容）
    (node) => transformSlotsAndTemplate(node),

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
      const interpolationNode = node as any
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

    const elementNode = node as any
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
        content: (node as any).content,
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
        content: (node as any).content,
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
      const rootNode = node as any
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
