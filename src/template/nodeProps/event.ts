import t from '@babel/types'
import type {
  VMSCounter,
  VMSRootNode,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import { NodeTypes } from '@vue/compiler-core'
import { processEventProperty, addGeneratedFunctions } from './eventProcessor'
import { processVModelProp } from './vmodel'
import { EVENT_PARAM_NAME, type CallExpressionInfo } from './eventHelpers'
import { getCodegenNodeProps, setCodegenNode } from '../tools'

/**
 * 合并同一事件名上的多个处理函数。
 *
 * 场景：`v-model` 会自动生成一个 setter 绑定（如 `bind:input`），
 * 用户同时显式写了同名事件（如 `@input="onIn"`）。若不合并，
 * 后者会覆盖前者，使 v-model 回写失效（Vue 会合并为数组全部调用）。
 *
 * 做法：为冲突事件生成一个桥接函数，按原顺序依次调用各处理函数；
 * 桥接函数体进入 returnValue，并注册到 bridgedFunctions。
 * 处理函数既可能是生成的函数名（`__fun_0`，可从 returnValue 取出复用），
 * 也可能是用户可直接调用的方法名（在 setup 作用域内可见）。
 */
function mergeDuplicateEventHandlers(
  eventProps: Array<{ name: string; content: string }>,
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
): Array<{ name: string; content: string }> {
  const byName = new Map<string, string[]>()
  const order: string[] = []

  for (const prop of eventProps) {
    if (!byName.has(prop.name)) {
      byName.set(prop.name, [])
      order.push(prop.name)
    }
    byName.get(prop.name)!.push(prop.content)
  }

  return order.map((name) => {
    const handlers = byName.get(name)!
    if (handlers.length === 1) {
      return { name, content: handlers[0] }
    }

    // 去重：同一函数被重复绑定无需调用两次
    const uniqueHandlers = [...new Set(handlers)]
    const bridgeName = counter.generateFunctionPropertyName()

    const body = t.blockStatement(
      uniqueHandlers.map((handler) =>
        t.expressionStatement(
          t.callExpression(t.identifier(handler), [t.identifier(EVENT_PARAM_NAME)]),
        ),
      ),
    )
    returnValue.properties.push(
      t.objectProperty(
        t.identifier(bridgeName),
        t.functionExpression(null, [t.identifier(EVENT_PARAM_NAME)], body),
      ),
    )

    return { name, content: bridgeName }
  })
}

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

  // 处理 v-model / v-model:xxx（生成的 setter 桥接函数进入 returnValue，
  // 属性（value/modelValue/xxx + bind:update:xxx）与事件属性同一机制合并）
  for (const prop of props) {
    const vmResult = processVModelProp(
      prop,
      node as VMSTemplateChildNode,
      node.tag,
      counter,
      returnValue,
      ctx,
    )
    if (vmResult) {
      eventProps.push(...vmResult.props)
    }
  }

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

  // 同一事件被 v-model 的 setter 与用户显式绑定同时占用时（如
  // <input v-model="a" @input="onIn" /> 或 <MyComp v-model="a" @update:modelValue="onUp" />），
  // 后写入的绑定会覆盖前一个，导致 v-model 的 setter 变成死代码、数据不再回写。
  // Vue 的做法是把两个处理函数合并为一个数组，这里等价地生成一个顺序调用两者的桥接函数。
  const mergedEventProps = mergeDuplicateEventHandlers(eventProps, returnValue, counter)

  // 收集 data- 属性
  const dataProps = addGeneratedFunctions(callExpressionWithArgs, props, returnValue)

  // 如果有事件或 data 属性，更新 codegenNode
  if (mergedEventProps.length > 0 || dataProps.length > 0) {
    const existingCodegenProps = getCodegenNodeProps(node)
    // 添加事件属性和 data 属性
    const tempProps = [...mergedEventProps, ...dataProps]
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
