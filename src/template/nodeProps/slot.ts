// 转换插槽和非插槽的template
import type { VMSCodegenNode, VMSRootNode, VMSTemplateChildNode } from '@/types/node'
import { type DirectiveNode, ElementNode, NodeTypes, type TemplateNode } from '@vue/compiler-core'
import { isNotMergeProps, isVForNode, setCodegenNode } from '../tools'
import { createCompileError } from '@/utils/errorHandler'

export function transformSlotsAndTemplate(node: VMSRootNode | VMSTemplateChildNode): void {
  // 只处理元素节点且标签为template的情况
  if (node.type !== NodeTypes.ELEMENT || (node as any).tag !== 'template' || !(node as any).props) {
    return
  }
  const templateNode = node as TemplateNode
  const slotProp = templateNode.props.find(
    (p: any) => p.type === NodeTypes.DIRECTIVE && p.name === 'slot',
  ) as DirectiveNode | undefined

  if (slotProp) {
    // 检查是否为作用域插槽（不支持）
    if (slotProp.exp) {
      throw createCompileError(
        '暂不支持作用域插槽(v-slot)编译为小程序，请改为在父组件中直接使用数据渲染列表 / 条件。',
        slotProp.loc,
      )
    }

    // 处理具名插槽
    if (slotProp.arg?.type === NodeTypes.SIMPLE_EXPRESSION) {
      const slotName = slotProp.arg.content
      processNamedSlot(templateNode, slotName, slotProp)
    }
  } else {
    // 处理非插槽的template节点 - 转换为block
    transformToBlock(templateNode)
  }
}

// 处理具名插槽的转换
function processNamedSlot(node: TemplateNode, slotName: string, slotProp: DirectiveNode): void {
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
      createChildWithMergedProps(child, slotName)
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
function createChildWithMergedProps(childNode: ElementNode, slotName: string): void {
  const mergedProps: NonNullable<VMSCodegenNode['props']> = childNode.props
    ? new Map(
        childNode.props
          ?.filter((p: any) => p.type === NodeTypes.ATTRIBUTE && isNotMergeProps(p))
          .map((p: any) => [p.name, p.value]),
      )
    : new Map()

  if (slotName !== 'default') {
    mergedProps.set('slot', {
      content: slotName,
    })
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
