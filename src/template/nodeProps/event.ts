import t from '@babel/types'
import type {
  VMSCounter,
  VMSRootNode,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import { NodeTypes } from '@vue/compiler-core'
import { processEventProperty, addGeneratedFunctions } from './eventProcessor'
import type { CallExpressionInfo } from './eventHelpers'
import { getCodegenNodeProps, setCodegenNode } from '../tools'

export function transformEventHandlers(
  node: VMSRootNode | VMSTemplateChildNode,
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  ctx: VMSTransformContext,
): void {
  if (node.type !== NodeTypes.ELEMENT) return

  // 每个节点重置 dataKey 计数器，从 'a' 开始
  counter.nodeDataKeyIndex = 0

  const callExpressionWithArgs = new Map<string, CallExpressionInfo>()
  const props = node.props || []

  // 收集事件属性
  const eventProps: Array<{ name: string; content: string }> = []

  for (const prop of props) {
    const result = processEventProperty(
      prop,
      node as VMSTemplateChildNode,
      counter,
      callExpressionWithArgs,
      returnValue,
      ctx,
    )
    if (result) {
      eventProps.push(result)
    }
  }

  // 收集 data- 属性
  const dataProps = addGeneratedFunctions(callExpressionWithArgs, props, returnValue)

  // 如果有事件或 data 属性，更新 codegenNode
  if (eventProps.length > 0 || dataProps.length > 0) {
    const existingCodegenProps = getCodegenNodeProps(node)
    // 添加事件属性和 data 属性
    const tempProps = [...eventProps, ...dataProps]
    tempProps.forEach((prop) => {
      existingCodegenProps.set(prop.name, { content: prop.content })
    })

    setCodegenNode(node, {
      type: node.type,
      tag: node.tag,
      props: existingCodegenProps,
      // children 由 buildCodegenNodesForTree 统一处理
      loc: node.loc,
    })
  }
}
