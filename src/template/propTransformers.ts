/**
 * 属性转换器 - 将 Vue 模板属性转换为小程序 WXML 属性
 *
 * 每个转换器接收一个属性，返回转换结果或 undefined（表示不处理）
 * 所有转换器在统一节点转换器中被调用，结果按优先级合并
 */

import { NodeTypes, type DirectiveNode, type SimpleExpressionNode } from '@vue/compiler-core'
import type {
  VMSCodegenProp,
  PropTransformResult,
  VMSCounter,
  VMSTransformContext,
} from '@/types/node'
import type { VMSAttrOrDirectiveNode } from '@/types/node'
import { getTemplateNodeProp } from './expression'
import { createCompileError } from '@/utils/errorHandler'
import * as t from '@babel/types'

/**
 * 属性优先级常量
 */
export const PROP_PRIORITIES = {
  // 控制指令（最高优先级）
  'wx:for': 100,
  'wx:for-item': 100,
  'wx:for-index': 100,
  'wx:key': 100,
  'wx:if': 100,
  'wx:elif': 100,
  'wx:else': 100,
  hidden: 90, // v-show 转换

  // 动态绑定（高优先级）
  class: 50,
  style: 50,

  // 静态属性（默认优先级）
  id: 10,
  src: 10,
  href: 10,
  // 其他静态属性默认为 0
  _default: 0,
} as const

type PropPriorityKey = keyof typeof PROP_PRIORITIES

// 转换器上下文
export interface TransformerContext {
  returnValue: t.ObjectExpression
  counter: VMSCounter
  wxsExpressionStatements: t.ExpressionStatement[]
  ctx: VMSTransformContext
  node: any
}

/**
 * 获取属性优先级
 */
function getPriority(key: string): number {
  return Object.hasOwn(PROP_PRIORITIES, key)
    ? PROP_PRIORITIES[key as PropPriorityKey]
    : PROP_PRIORITIES._default
}

/**
 * 创建转换结果辅助函数
 */
function createResult(
  key: string,
  content: string | undefined,
  priority?: number,
): PropTransformResult {
  return {
    key,
    value: { content },
    priority: priority ?? getPriority(key),
  }
}

/**
 * 从 v-for 指令中提取 forItem 和 forIndex
 * 公共逻辑，供 transformVForProp 共用
 */
function parseForVariables(
  prop: VMSAttrOrDirectiveNode,
  counter: VMSCounter,
): { forItem: string; forIndex: string } | undefined {
  const directive = prop as DirectiveNode & { forParseResult: any }
  if (!directive.forParseResult) {
    return undefined
  }

  // 解构式 item（如 { id, name } / [a, b]）在 WXML 中统一用默认的 'item' 名
  const valueAst = directive.forParseResult.value?.ast
  const isDestructured =
    valueAst?.type === 'ArrowFunctionExpression' &&
    (valueAst.params?.[0]?.type === 'ObjectPattern' ||
      valueAst.params?.[0]?.type === 'ArrayPattern')

  const forItem = isDestructured
    ? 'item'
    : directive.forParseResult.value?.type === NodeTypes.SIMPLE_EXPRESSION
      ? directive.forParseResult.value.content
      : 'item'

  const hasExplicitIndex = directive.forParseResult.key?.type === NodeTypes.SIMPLE_EXPRESSION

  const forIndex = hasExplicitIndex
    ? (directive.forParseResult.key as SimpleExpressionNode).content
    : counter.generateVForIndexName(forItem)

  return { forItem, forIndex }
}

/**
 * v-for 转换器
 * v-for="(item, index) in items" → wx:for="{{items}}" wx:for-item="item" wx:for-index="index" wx:key="..."
 */
export function transformVForProp(
  prop: VMSAttrOrDirectiveNode,
  context: TransformerContext,
): PropTransformResult | PropTransformResult[] | undefined {
  if (prop.type !== NodeTypes.DIRECTIVE || prop.name !== 'for') {
    return undefined
  }

  const directive = prop as DirectiveNode & { forParseResult: any }
  if (!directive.forParseResult) {
    return undefined
  }

  // 获取数组表达式
  const { content: arrayName } = getTemplateNodeProp(
    context.node,
    { loc: directive.loc, exp: directive.forParseResult.source },
    context.returnValue,
    context.counter,
    context.wxsExpressionStatements,
    context.ctx,
  )

  const forVars = parseForVariables(prop, context.counter)
  if (!forVars) return undefined

  // 写回 forParseResult 供后续使用
  const hasExplicitIndex = directive.forParseResult.key?.type === NodeTypes.SIMPLE_EXPRESSION
  if (!hasExplicitIndex) {
    directive.forParseResult.key = {
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: forVars.forIndex,
      isStatic: false,
      constType: 0,
      loc: directive.loc,
    }
  }

  // 返回 wx:for 主结果及 wx:for-item、wx:for-index 附加结果
  const results: PropTransformResult[] = [
    createResult('wx:for', arrayName, PROP_PRIORITIES['wx:for']),
  ]
  if (forVars.forItem !== 'item') {
    results.push(createResult('wx:for-item', forVars.forItem, PROP_PRIORITIES['wx:for-item']))
  }
  if (forVars.forIndex !== 'index') {
    results.push(createResult('wx:for-index', forVars.forIndex, PROP_PRIORITIES['wx:for-index']))
  }

  return results
}

/**
 * :key 转换器（配合 v-for 使用）
 * :key="item.id" → wx:key="id"
 *
 * 注意：wx:key 只支持 item 的直接属性名（如 "id"），不支持嵌套路径（如 "subRow.id"）。
 * 对于嵌套路径，输出 *this 作为回退并发出警告。
 *
 * 【已核查，暂不改动】`:key="index"` → `wx:key="index"` 的语义存在歧义：
 *   - 官方文档《列表渲染》称 `wx:key` 是"item 的字段名字符串"，
 *     `wx:key="index"` 会被理解为读 `item.index`
 *   - 但腾讯官方组件库 tdesign-miniprogram 的产物中大量使用
 *     `wx:key="index"`（39 处），说明实践中被当作循环索引使用
 *   证据不足以判定哪种解释正确，故保持现状；如需变更须先确认渲染器实现。
 */
export function transformKeyProp(prop: VMSAttrOrDirectiveNode): PropTransformResult | undefined {
  if (
    prop.type === NodeTypes.DIRECTIVE &&
    prop.name === 'bind' &&
    prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
    prop.arg.content === 'key'
  ) {
    const rawKeyContent =
      prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION ? prop.exp.content : undefined

    if (!rawKeyContent) {
      return createResult('wx:key', undefined, PROP_PRIORITIES['wx:key'])
    }

    // 纯标识符（如 index、idx）：直接用作 wx:key（v-for 的索引或简单变量名）
    if (/^\w+$/.test(rawKeyContent)) {
      return createResult('wx:key', rawKeyContent, PROP_PRIORITIES['wx:key'])
    }

    // "identifier.property" 模式（如 item.id、row.name）→ 取属性名部分
    // 不匹配嵌套路径（如 row.sub.id），因为 wx:key 不支持嵌套属性路径
    const simpleKeyMatch = rawKeyContent.match(/^(\w+)\.(\w+)$/)
    if (simpleKeyMatch) {
      return createResult('wx:key', simpleKeyMatch[2], PROP_PRIORITIES['wx:key'])
    }

    // 复杂表达式回退到 *this，并发出编译警告
    console.warn(
      `[vms] wx:key 不支持复杂表达式 "${rawKeyContent}"，已回退为 "*this"。` +
        `wx:key 仅支持 item 的直接属性名（如 "id"）。`,
    )
    return createResult('wx:key', '*this', PROP_PRIORITIES['wx:key'])
  }
  return undefined
}

/**
 * v-if/v-else-if/v-else 转换器
 */
export function transformVIfProp(
  prop: VMSAttrOrDirectiveNode,
  context: TransformerContext,
): PropTransformResult | undefined {
  if (prop.type !== NodeTypes.DIRECTIVE) {
    return undefined
  }

  if (prop.name === 'if') {
    const { content } = getTemplateNodeProp(
      context.node,
      { loc: prop.loc, exp: prop.exp },
      context.returnValue,
      context.counter,
      context.wxsExpressionStatements,
      context.ctx,
    )
    return createResult('wx:if', content, PROP_PRIORITIES['wx:if'])
  }

  if (prop.name === 'else-if') {
    const { content } = getTemplateNodeProp(
      context.node,
      { loc: prop.loc, exp: prop.exp },
      context.returnValue,
      context.counter,
      context.wxsExpressionStatements,
      context.ctx,
    )
    return createResult('wx:elif', content, PROP_PRIORITIES['wx:elif'])
  }

  if (prop.name === 'else') {
    return createResult('wx:else', undefined, PROP_PRIORITIES['wx:else'])
  }

  return undefined
}

/**
 * v-show 转换器
 * v-show="condition" → hidden="{{!condition}}"
 */
export function transformVShowProp(
  prop: VMSAttrOrDirectiveNode,
  context: TransformerContext,
): PropTransformResult | undefined {
  if (prop.type !== NodeTypes.DIRECTIVE || prop.name !== 'show') {
    return undefined
  }

  const { content } = getTemplateNodeProp(
    context.node,
    { loc: prop.loc, exp: prop.exp },
    context.returnValue,
    context.counter,
    context.wxsExpressionStatements,
    context.ctx,
  )

  // 提取表达式并取反
  const innerExpression = content?.slice(2, -2) || '' // 去掉 {{ 和 }}
  return createResult('hidden', `{{!(${innerExpression})}}`, PROP_PRIORITIES['hidden'])
}

const SPECIAL_ATTRS_BIND = ['class', 'style', 'key']

/**
 * 普通属性绑定转换器
 * :id="dynamicId" → id="{{dynamicId}}"
 * 复杂表达式会生成 WXS 函数
 */
export function transformBindProp(
  prop: VMSAttrOrDirectiveNode,
  context: TransformerContext,
): PropTransformResult | undefined {
  if (
    prop.type === NodeTypes.DIRECTIVE &&
    prop.name === 'bind' &&
    prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
  ) {
    const attrName = prop.arg.content

    // 跳过已处理的特殊属性
    if (SPECIAL_ATTRS_BIND.includes(attrName)) {
      return undefined
    }

    if (prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION) {
      // 使用 getTemplateNodeProp 处理表达式（支持 WXS 转换）
      const { content } = getTemplateNodeProp(
        context.node,
        { exp: prop.exp, loc: prop.loc },
        context.returnValue,
        context.counter,
        context.wxsExpressionStatements,
        context.ctx,
      )
      return createResult(attrName, content, 20)
    }
  }

  return undefined
}
const SPECIAL_ATTRS_STATIC = ['class', 'style']
/**
 * 静态属性转换器
 * id="foo" → id="foo"
 */
export function transformStaticProp(prop: VMSAttrOrDirectiveNode): PropTransformResult | undefined {
  if (prop.type === NodeTypes.ATTRIBUTE) {
    // 跳过已处理的特殊属性
    if (SPECIAL_ATTRS_STATIC.includes(prop.name)) {
      return undefined
    }
    return createResult(prop.name, prop.value?.content, getPriority(prop.name))
  }

  return undefined
}

/**
 * 明确不支持的指令：报错而不是静默丢弃。
 *
 * 这些指令若被静默忽略，产物会"看起来正常"但缺失内容——例如
 * `v-html="html"` 会产出空元素（内容彻底丢失）且不报任何错，
 * 属于最难排查的一类问题。已在 README/SKILL 中列为不支持，
 * 这里让编译期直接失败并说明替代方案。
 */
const UNSUPPORTED_DIRECTIVES: Record<string, string> = {
  html: '小程序的富文本请使用 <rich-text nodes="{{...}}" /> 或 WXS 手动拼接',
  text: '请直接使用插值 <text>{{ value }}</text>',
  pre: '小程序模板无编译期插值概念，请直接书写静态文本',
  once: '小程序天然不会重复渲染静态节点，可直接移除该指令',
  memo: '小程序无 v-memo 等价机制，可直接移除该指令',
  cloak: '小程序无 CSS 加载闪烁问题，可直接移除该指令',
}

function transformUnsupportedDirective(
  prop: VMSAttrOrDirectiveNode,
): PropTransformResult | undefined {
  if (prop.type !== NodeTypes.DIRECTIVE) return undefined

  // `v-bind="obj"`（无参数的整体绑定）：WXML 没有"展开对象为多个属性"的机制，
  // 无法转换。旧实现静默丢弃**全部**属性——写了 v-bind="attrs" 的元素
  // 最终一个属性都没有，且不报错，属于最难排查的一类问题。
  // 注意：`:title="x"`（有参数）是正常用法，不受影响。
  if (prop.name === 'bind' && !prop.arg) {
    throw createCompileError(
      'v-bind="obj"（整体绑定对象）不支持：WXML 无法把对象展开为多个属性，' +
        '该写法会让所有动态属性被静默丢弃。请改为逐个绑定，如 :id="obj.id" :title="obj.title"。',
      prop.loc,
    )
  }

  // `v-on="handlers"`（无参数的整体事件绑定）同理：无法展开为多个 bind:xxx，
  // 旧实现静默丢弃全部事件绑定，元素看起来正常但完全不可交互。
  if (prop.name === 'on' && !prop.arg) {
    throw createCompileError(
      'v-on="handlers"（整体绑定事件）不支持：WXML 无法把对象展开为多个事件绑定，' +
        '该写法会让所有事件被静默丢弃。请改为逐个绑定，如 @tap="handlers.tap"。',
      prop.loc,
    )
  }

  const advice = UNSUPPORTED_DIRECTIVES[prop.name]
  if (!advice) return undefined
  throw createCompileError(`v-${prop.name} 不支持：${advice}`, prop.loc)
}

/**
 * 所有属性转换器列表（按优先级排序）
 */
export const propTransformers = [
  transformUnsupportedDirective,
  transformVForProp,
  transformKeyProp,
  transformVIfProp,
  transformVShowProp,
  transformBindProp,
  transformStaticProp,
]

/**
 * 按优先级合并属性转换结果
 * 高优先级覆盖低优先级
 */
export function mergePropResults(results: PropTransformResult[]): Map<string, VMSCodegenProp> {
  // 按 key 分组
  const grouped = new Map<string, PropTransformResult[]>()

  for (const result of results) {
    const existing = grouped.get(result.key) || []
    existing.push(result)
    grouped.set(result.key, existing)
  }

  // 合并，保留最高优先级
  const merged = new Map<string, VMSCodegenProp>()

  for (const [key, group] of grouped) {
    const highest = group.reduce((max, current) =>
      current.priority > max.priority ? current : max,
    )
    merged.set(key, highest.value)
  }

  return merged
}
