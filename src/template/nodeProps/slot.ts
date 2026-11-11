// 转换插槽和非插槽的template
import type {
  VMSCodegenNode,
  VMSRootNode,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import {
  type DirectiveNode,
  type ElementNode,
  NodeTypes,
  type SimpleExpressionNode,
  type TemplateNode,
} from '@vue/compiler-core'
import { isNotMergeProps, isVForNode, setCodegenNode } from '../tools'
import { createCompileError } from '@/utils/errorHandler'

// 作用域插槽参数：slot 数据名 → 本地变量名
interface ScopedSlotParam {
  slotDataName: string
  localName: string
}

export function transformSlotsAndTemplate(
  node: VMSRootNode | VMSTemplateChildNode,
  ctx?: VMSTransformContext,
): void {
  if (node.type !== NodeTypes.ELEMENT) return
  const elementNode = node as ElementNode

  // 处理 <slot> 出口：检测作用域数据（:xxx 绑定），标记 dynamicSlots
  if (elementNode.tag === 'slot') {
    processSlotExit(elementNode, ctx)
    return
  }

  // 只处理标签为 template 的情况
  if (elementNode.tag !== 'template' || !elementNode.props) return

  const templateNode = node as TemplateNode
  const slotProp = templateNode.props.find(
    (p: any) => p.type === NodeTypes.DIRECTIVE && p.name === 'slot',
  ) as DirectiveNode | undefined

  if (slotProp) {
    // 解析作用域插槽参数（如果有）
    const scopedParams = parseScopedSlotParams(slotProp)

    // 作用域插槽的接收变量不属于组件 data，记录到 ctx 供变量收集排除
    if (ctx && scopedParams.length > 0) {
      for (const param of scopedParams) {
        ctx.scopedSlotVars.add(param.localName)
      }
    }

    // 动态插槽名（v-slot:[name]）无法在编译期确定 slot="..." 的取值，
    // arg.content 只是表达式文本，直接使用会静默绑定成 slot="name"。
    // 小程序要求 slot 名在编译期确定，因此明确报错。
    if (
      slotProp.arg &&
      slotProp.arg.type === NodeTypes.SIMPLE_EXPRESSION &&
      !slotProp.arg.isStatic
    ) {
      throw createCompileError(
        `不支持动态插槽名（v-slot:[${slotProp.arg.content}]）：` +
          '小程序的 slot 名必须在编译期确定，请改用静态插槽名。',
        slotProp.loc,
      )
    }

    // 处理具名插槽（作用域插槽也走这里，通过 scopedParams 区分）
    const slotName =
      slotProp.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? slotProp.arg.content : 'default'
    processNamedSlot(templateNode, slotName, slotProp, scopedParams)
  } else {
    // 处理非插槽的template节点 - 转换为block
    transformToBlock(templateNode)
  }
}

// 检测 <slot> 出口上的作用域数据
function processSlotExit(node: ElementNode, ctx?: VMSTransformContext): void {
  const hasScopedData = node.props?.some(
    (p: any) => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.arg,
  )
  if (hasScopedData && ctx) {
    ctx.hasDynamicSlots = true
  }
}

// 解析作用域插槽参数（如 v-slot:item="{ item, index }"）
function parseScopedSlotParams(slotProp: DirectiveNode): ScopedSlotParam[] {
  const exp = slotProp.exp as SimpleExpressionNode | undefined
  if (!exp || exp.type !== NodeTypes.SIMPLE_EXPRESSION) return []
  const ast = exp.ast as any
  if (!ast) return []

  // 解构参数可能是 ObjectPattern，或 ArrowFunctionExpression(params[0] 为 ObjectPattern)
  let pattern = ast
  if (ast.type === 'ArrowFunctionExpression') {
    pattern = ast.params?.[0]
  }
  if (!pattern || pattern.type !== 'ObjectPattern') return []

  const params: ScopedSlotParam[] = []
  for (const prop of pattern.properties) {
    if (prop.type !== 'ObjectProperty') continue
    // 键名可能是标识符（item）或字符串字面量（'list-item'，用于 kebab-case）。
    // 只读 key.name 会静默丢弃字符串键，导致父组件收不到该字段。
    const keyName =
      prop.key?.type === 'Identifier'
        ? prop.key.name
        : prop.key?.type === 'StringLiteral'
          ? prop.key.value
          : undefined
    const valueName = prop.value?.type === 'Identifier' ? prop.value.name : undefined
    if (keyName && valueName) {
      params.push({ slotDataName: keyName, localName: valueName })
    }
  }
  return params
}

// 处理具名插槽的转换
function processNamedSlot(
  node: TemplateNode,
  slotName: string,
  slotProp: DirectiveNode,
  scopedParams: ScopedSlotParam[],
): void {
  const childrenCount = node.children.length

  if (childrenCount === 0) {
    // 空插槽 - 创建注释节点的codegenNode，存入节点自身
    setCodegenNode(node, {
      type: NodeTypes.COMMENT,
      content: `因${slotName}插槽下没有子节点，已被替换为注释节点`,
    })
    return
  }

  // 验证子节点类型，并为每个子节点记录合并后的 codegenNode
  for (const child of node.children) {
    if (child.type === NodeTypes.TEXT) {
      throw createCompileError(`插槽${slotName}下需使用div等标签元素作为子节点！`, slotProp.loc)
    } else if (child.type === NodeTypes.ELEMENT) {
      createChildWithMergedProps(child, slotName, scopedParams)
    }
  }

  transformToBlock(node)
}

// 结果存入节点自身，在生成wxml期间将template转换为block
function transformToBlock(node: TemplateNode): void {
  const forDirective = isVForNode(node)
  // 如果节点不含有 v-for 指令，则进行转换
  if (!forDirective || forDirective.type !== NodeTypes.DIRECTIVE || !forDirective.forParseResult) {
    // 只保留 ATTRIBUTE 类型的属性，过滤掉 DIRECTIVE 指令（如 v-if、v-for 等）
    const filteredProps = new Map(
      node.props
        .filter((item) => item.type === NodeTypes.ATTRIBUTE && item.name !== 'slot')
        .map((p: any) => [p.name, p.value]),
    )

    // 将 template 转换为 block，子节点由后续 createUnifiedNodeTransform 的 exit 钩子补全
    setCodegenNode(node, {
      type: NodeTypes.ELEMENT,
      tag: node.tag,
      props: filteredProps,
      children: [],
      loc: node.loc,
    })
  }
}

// 为子节点创建带合并属性的codegenNode，存入节点自身
function createChildWithMergedProps(
  childNode: ElementNode,
  slotName: string,
  scopedParams: ScopedSlotParam[] = [],
): void {
  const mergedProps: NonNullable<VMSCodegenNode['props']> = childNode.props
    ? new Map(
        childNode.props
          ?.filter((p: any) => p.type === NodeTypes.ATTRIBUTE && isNotMergeProps(p))
          .map((p: any) => [p.name, p.value]),
      )
    : new Map()

  // 具名插槽：子节点需带 slot="<name>" 定向插入（默认插槽不需要）
  // 注意：具名 + 作用域两种属性必须同时存在，例如
  // <template #row="{ item }"> → slot="row" slot:item
  // 缺少 slot="row" 时内容会落到默认插槽。见 glass-easel 官方用例
  // <div slot="abc" slot:some-text>。
  if (slotName !== 'default') {
    mergedProps.set('slot', {
      content: slotName,
    })
  }

  if (scopedParams.length > 0) {
    // 作用域插槽：为每个参数添加 slot:xxx 属性（glass-easel 语法）
    for (const param of scopedParams) {
      const attrName = `slot:${param.slotDataName}`
      // 本地变量名与 slot 数据名一致时省略属性值，否则用别名
      const content = param.localName === param.slotDataName ? undefined : param.localName
      mergedProps.set(attrName, { content })
    }
  }

  // 将子节点转换为 codegenNode，子节点由后续 createUnifiedNodeTransform 的 exit 钩子补全
  setCodegenNode(childNode, {
    type: childNode.type,
    tag: childNode.tag,
    props: mergedProps,
    children: [],
    loc: childNode.loc,
  })
}
