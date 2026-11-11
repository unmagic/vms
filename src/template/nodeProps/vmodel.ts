/**
 * v-model 指令编译
 *
 * 三种形态：
 * 1. 原生表单标签：v-model="text" → value="{{text}}" + bind:input 桥接（自动 setData 回写）
 * 2. 组件带参数：v-model:title="t" → modelValue 扩展 → title="{{t}}" + bind:update:title 桥接
 * 3. 组件无参数：v-model="t" → modelValue="{{t}}" + bind:update:modelValue 桥接
 *
 * 桥接函数在 setup 内生成（与内联事件处理器同机制），事件触发时把新值
 * 赋给 proxyRefs 上的变量；ref 赋值自动触发响应式更新，函数绑定已由运行时
 * 注入 data，子组件事件可直接调用。
 */
import t from '@babel/types'
import type {
  VMSAttrOrDirectiveNode,
  VMSCounter,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import { NodeTypes, type DirectiveNode } from '@vue/compiler-core'
import { addProperty, buildDestructuredAccess, resolveDestructuredVar } from '../tools'
import { getVForInfoList } from '../tools'
import { getVForItemName, getVForIndexName, getVForSourceExpression } from '@/utils/tools'
import { EVENT_PARAM_NAME, getFunctionIndexChar, buildProxyRefsItemAccess } from './eventHelpers'
import { GLOBAL_WHITELIST } from '@/utils/globalWhitelist'
import { createCompileError } from '@/utils/errorHandler'
import { parse } from '@babel/parser'
import { generate } from '@babel/generator'

/**
 * 微信小程序原生标签集合（非映射表内、但属于原生组件的标签）
 * 用于区分"未映射的原生标签"（报错）与自定义组件标签（走 modelValue 约定）
 */
const NATIVE_WX_TAGS = new Set([
  'view',
  'text',
  'image',
  'button',
  'block',
  'scroll-view',
  'swiper',
  'swiper-item',
  'movable-area',
  'movable-view',
  'cover-view',
  'cover-image',
  'icon',
  'progress',
  'rich-text',
  'form',
  'label',
  'checkbox',
  'checkbox-group',
  'radio',
  'radio-group',
  'picker',
  'picker-view',
  'picker-view-column',
  'slider',
  'switch',
  'input',
  'textarea',
  'navigator',
  'video',
  'camera',
  'live-player',
  'live-pusher',
  'map',
  'canvas',
  'web-view',
  'ad',
  'official-account',
  'open-data',
  'editor',
  'audio',
])

function isNativeTag(tag: string): boolean {
  return NATIVE_WX_TAGS.has(tag)
}

/**
 * 原生表单标签的 v-model 到 WXML 的属性/事件映射
 * valueKey: 绑定的属性；event: 监听的事件；supportsLazy: 是否支持 .lazy 改用 change 事件
 *
 * 注意：checkbox / radio / checkbox-group 的 e.detail.value 是数组，
 * 语义与单值 v-model 不匹配，不做映射（需用户手动 :checked + @tap/@change 处理）。
 */
interface NativeModelMap {
  valueKey: string
  event: string
  supportsLazy: boolean
  /**
   * 事件值是否为字符串，决定 .trim / .number 是否有意义。
   * switch 的 detail.value 是 boolean、slider 是 number，
   * 对其调用 .trim() 会抛 TypeError（非字符串没有 trim 方法），
   * .number 也会把 boolean 静默转成 1/0。Vue 同样只在文本类
   * 输入（text/textarea）上应用这两个修饰符。
   */
  stringValue: boolean
}

const NATIVE_MODEL_MAP = new Map<string, NativeModelMap>([
  // 小程序原生 input/textarea 没有 change 事件（只有 input/focus/blur），
  // 因此 .lazy 对原生标签不可用，仅对组件 v-model（change:update:xxx）有意义
  ['input', { valueKey: 'value', event: 'input', supportsLazy: false, stringValue: true }],
  ['textarea', { valueKey: 'value', event: 'input', supportsLazy: false, stringValue: true }],
  // picker 的 detail.value 是索引（number 或 number[]），非字符串
  ['picker', { valueKey: 'value', event: 'change', supportsLazy: false, stringValue: false }],
  ['slider', { valueKey: 'value', event: 'changing', supportsLazy: false, stringValue: false }],
  ['switch', { valueKey: 'checked', event: 'change', supportsLazy: false, stringValue: false }],
  ['picker-view', { valueKey: 'value', event: 'change', supportsLazy: false, stringValue: false }],
  ['radio-group', { valueKey: 'value', event: 'change', supportsLazy: false, stringValue: false }],
])

export interface VModelResult {
  /** 需要合并进节点 props 的属性（如 value / modelValue / title） */
  props: Array<{ name: string; content: string }>
}

/**
 * 处理 v-model / v-model:xxx 指令
 * 返回要添加的属性；事件桥接函数注册进 returnValue（与事件处理器同机制）
 */
export function processVModelProp(
  prop: VMSAttrOrDirectiveNode,
  node: VMSTemplateChildNode,
  tag: string,
  counter: VMSCounter,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
): VModelResult | null {
  if (prop.type !== NodeTypes.DIRECTIVE || prop.name !== 'model') {
    return null
  }

  const exp = prop.exp
  if (!exp || exp.type !== NodeTypes.SIMPLE_EXPRESSION || !exp.content) {
    throw createCompileError('v-model 需要一个可赋值的表达式', prop.loc)
  }

  // 解析修饰符：.lazy（input→change 事件）、.number（转数字）、.trim（去首尾空格）
  const modifiers = (prop.modifiers || []) as Array<{ content?: string }>
  const hasLazy = modifiers.some((m) => m.content === 'lazy')
  const hasNumber = modifiers.some((m) => m.content === 'number')
  const hasTrim = modifiers.some((m) => m.content === 'trim')
  const unknownModifier = modifiers.find(
    (m) => m.content && !['lazy', 'number', 'trim'].includes(m.content),
  )
  if (unknownModifier?.content) {
    throw createCompileError(
      `v-model 不支持修饰符 .${unknownModifier.content}，支持：.lazy / .number / .trim`,
      prop.loc,
    )
  }

  // 解析绑定的目标变量：仅支持标识符或成员表达式（如 user.name）
  const targetAst = fallbackParse(exp.content)
  if (!targetAst || (!t.isIdentifier(targetAst) && !t.isMemberExpression(targetAst))) {
    throw createCompileError(
      `v-model 仅支持绑定变量或成员表达式（如 v-model="text"、v-model="user.name"），收到：${exp.content}`,
      prop.loc,
    )
  }

  // 目标根变量需要进入 __vmsProxyRefs（ref 场景）；v-for item 场景另行处理
  const rootName = t.isIdentifier(targetAst) ? targetAst.name : rootOfMember(targetAst)

  // 成员表达式的根必须是标识符，否则是不可写目标（如 'a'.length、fn().x），
  // 直接编译会生成 `'a'.length = ...` 这类运行时报错代码
  if (!rootName) {
    throw createCompileError(
      `v-model 目标 "${exp.content}" 不可写入：成员表达式的根必须是变量（如 user.name）`,
      prop.loc,
    )
  }

  // 作用域插槽的接收变量来自子组件，在父组件中只读：
  // 它不属于父组件 data（addRenderProperty 会跳过），写回会引用未定义的
  // __vmsProxyRefs。与 Vue 中直接将 slot prop 用于 v-model 的语义一致——
  // Vue 运行时会警告该数据是只读的。
  if (ctx.scopedSlotVars.has(rootName)) {
    throw createCompileError(
      `v-model 目标 "${exp.content}" 是作用域插槽变量（由子组件通过 slot:${rootName} 传入），` +
        `在父组件中只读，不能双向绑定。如需修改请在子组件内更新源数据，` +
        `或将其同步到父组件的 ref 后再绑定。`,
      prop.loc,
    )
  }

  // 只读目标不支持 v-model：赋值会静默失效或直接运行时报错
  // - props / import / 编译宏变量：写入无效
  // - 全局变量（wx / console 等）：不会注册进 __vmsProxyRefs，生成的 setter
  //   会引用未定义的 __vmsProxyRefs 并抛 ReferenceError
  if (
    !isVForVar(rootName, ctx, node) &&
    (shouldSkip(rootName, ctx) || GLOBAL_WHITELIST.has(rootName))
  ) {
    const reason = GLOBAL_WHITELIST.has(rootName)
      ? '是全局变量（如 wx / console），不可作为双向绑定目标'
      : '是 props/import/宏 变量，不可直接写入'
    throw createCompileError(
      `v-model 目标 "${exp.content}" ${reason}。` +
        `请绑定 setup 内声明的 ref/reactive 变量，或通过 defineModel 建立双向绑定`,
      prop.loc,
    )
  }

  // 解构式 v-for 的变量（如 v-for="{ name } in list"）：
  // 它在 WXML 中并不存在，必须改写为对应层级的 item 属性访问，
  // 否则会生成 value="{{name}}" + __vmsProxyRefs.name 这类无效代码。
  // 其余转换路径（表达式、事件、computed）都走 resolveDestructuredVar，
  // v-model 需要同等的改写。
  const targetVForList = getVForInfoList(ctx, node)
  const destructured =
    targetVForList && targetVForList.length > 0
      ? resolveDestructuredVar(rootName, targetVForList)
      : null

  let boundExpression = exp.content
  let boundTargetAst: t.Expression = targetAst

  if (destructured && targetVForList) {
    const itemName = getVForItemName(targetVForList[destructured.level])

    // WXML 中内层同名 wx:for-item 会遮蔽外层。若目标所属层级不是最内层，
    // 且更内层也用同名 item，则无法在 WXML 中表达该层数据，直接报错。
    const shadowed =
      destructured.level < targetVForList.length - 1 &&
      targetVForList
        .slice(destructured.level + 1)
        .some((info) => getVForItemName(info) === itemName)

    if (shadowed) {
      throw createCompileError(
        `v-model 目标 "${exp.content}" 来自解构式 v-for，但被更内层的同名 ${itemName} 遮蔽，` +
          `无法正确解析。请为内层 v-for 指定不同的 item 名（wx:for-item）。`,
        prop.loc,
      )
    }

    const access = buildDestructuredAccess(t.identifier(itemName), destructured.path)
    boundExpression = generate(access).code
    boundTargetAst = access
  }

  // v-for 的源来自作用域插槽变量时（如 <template #row="{ items }">
  // 内的 v-for="it in items"），该数据由子组件传入，父组件没有可写源：
  // 编译产物会生成 __vmsProxyRefs.items[...]（items 从不注册），运行时抛 ReferenceError。
  // 仅当**目标本身依赖该 v-for 链**时才是问题；绑定父组件自己的 ref 不受影响。
  if (targetVForList && targetVForList.length > 0 && targetsVForItem(rootName, ctx, node)) {
    const slotRooted = targetVForList
      .map((info) => getVForSourceExpression(info).split(/[.[]/)[0]?.trim())
      .find((sourceRoot) => sourceRoot && ctx.scopedSlotVars.has(sourceRoot))

    if (slotRooted) {
      throw createCompileError(
        `v-model 目标 "${exp.content}" 的数据源来自作用域插槽变量 "${slotRooted}"，` +
          `由子组件传入，在父组件中只读，不能双向绑定。` +
          `如需修改请在子组件内更新源数据，或将其同步到父组件的 ref 后再绑定。`,
        prop.loc,
      )
    }
  }

  // v-for 索引变量本身不可作为 v-model 目标：索引由 v-for 控制，
  // 对其赋值既不会更新列表也不会影响渲染
  if (isVForIndexVar(rootName, ctx, node)) {
    throw createCompileError(
      `v-model 目标 "${exp.content}" 是 v-for 的索引变量，不可写入。` +
        `如需修改列表项请绑定 item 属性（如 item.name），或对整个数组重新赋值`,
      prop.loc,
    )
  }

  // 生成 setter 桥接函数名：(__vms_event) => { target = newValue }
  const funName = counter.generateFunctionPropertyName()

  // 生成 setter 桥接函数体
  // v-for 场景需要：data-x 传索引 + dataset 解构 + item 局部引用声明
  const vForInfoList = getVForInfoList(ctx, node)
  const inVFor = vForInfoList && vForInfoList.length > 0
  const dataKey = inVFor ? getFunctionIndexChar(counter.nodeDataKeyIndex++) : ''

  const setterStatements: t.Statement[] = []
  if (inVFor && vForInfoList) {
    const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
    setterStatements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.objectPattern([
            t.objectProperty(
              t.identifier(dataKey),
              t.arrayPattern(indices.map((idx) => t.identifier(idx))),
              false,
              false,
            ),
          ]),
          t.memberExpression(
            t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('currentTarget')),
            t.identifier('dataset'),
          ),
        ),
      ]),
    )
  }

  // 判定这条 v-model 绑定的是【自定义组件】还是【原生表单标签】。
  // 二者的事件对象形态不同（见 buildAssignStatement 内的说明），必须区分。
  // 与下方形态分支保持一致：
  //   形态 1（带静态参数 v-model:xxx）→ 组件
  //   形态 2（NATIVE_MODEL_MAP 命中）  → 原生标签
  //   形态 3（默认 modelValue）        → 组件
  const hasModelArg = Boolean(
    prop.arg && prop.arg.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.content,
  )
  const isComponentModel = hasModelArg || (!NATIVE_MODEL_MAP.has(tag) && !isNativeTag(tag))

  // 赋值语句：把新值写入目标变量（v-for item 场景：item.xxx = 新值）
  // .number / .trim 修饰符在赋值前转换
  const assignStatement = applyValueTransform(
    buildAssignStatement(boundTargetAst, node, ctx, isComponentModel),

    hasNumber,
    hasTrim,
  )
  setterStatements.push(assignStatement)

  const setter = t.functionExpression(
    null,
    [t.identifier(EVENT_PARAM_NAME)],
    t.blockStatement(setterStatements),
  )
  returnValue.properties.push(t.objectProperty(t.identifier(funName), setter))
  ctx.bridgedFunctions.add(funName)

  // 目标根变量注册（v-for 变量除外）
  // 解构式 v-for 的变量已由 boundTargetAst 改写为 item 属性访问，
  // 不能再作为 setup 变量注册（否则会生成引用未定义变量的 data 项）。
  if (!destructured && !isVForVar(rootName, ctx, node)) {
    if (!GLOBAL_WHITELIST.has(rootName) && !shouldSkip(rootName, ctx)) {
      addProperty(returnValue, rootName)
      ctx.internalVars.add(rootName)
      ctx.needsProxyRefs = true
    }
  }

  // setter 内部通过 __vmsProxyRefs 访问 v-for 数据源
  // （如 const it = __vmsProxyRefs.list[i]），且绑定的目标属于 v-for 时
  // 上面不会注册组件 data，因此必须显式要求生成 __vmsProxyRefs。
  // 否则会产出引用未定义变量的代码，运行时抛 ReferenceError。
  if (inVFor) {
    ctx.needsProxyRefs = true
  }

  // v-for 索引 data 属性（供 dataset 解构）
  const dataProps: Array<{ name: string; content: string }> = []
  if (inVFor && vForInfoList) {
    const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
    dataProps.push({
      name: `data-${dataKey}`,
      content: `{{[${indices.join(',')}]}}`,
    })
  }

  const extraPropsFor = (boundPropName: string, eventName: string): VModelResult => ({
    props: [
      { name: boundPropName, content: `{{${boundExpression}}}` },
      { name: `bind:${eventName}`, content: funName },
      ...dataProps,
    ],
  })

  // 形态 1：带参数的组件 v-model:xxx
  if (prop.arg && prop.arg.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.content) {
    // 动态参数（v-model:[key]）无法在编译期确定属性名与事件名，
    // arg.content 只是表达式文本，直接使用会静默绑定成错误属性（如 key="{{a}}"）。
    if (!prop.arg.isStatic) {
      throw createCompileError(
        `v-model 不支持动态参数（v-model:[${prop.arg.content}]）：` +
          '小程序组件属性与 update 事件名必须在编译期确定，请改用静态参数名。',
        prop.loc,
      )
    }
    rejectLazyOnComponent(tag, hasLazy, prop.loc)

    // 事件名固定为 update:<propName>，与子组件 defineModel / triggerEvent 的
    // 约定一致（如 context.triggerEvent('update:checked', ...)）。
    return extraPropsFor(prop.arg.content, `update:${prop.arg.content}`)
  }

  // 形态 2：原生表单标签
  const native = NATIVE_MODEL_MAP.get(tag)
  if (native) {
    // .lazy 仅对组件 v-model 有意义：小程序原生标签没有 change 事件
    if (hasLazy) {
      throw createCompileError(
        `<${tag}> 不支持 v-model.lazy 修饰符：小程序原生标签没有 change 事件，` +
          `.lazy 仅对自定义组件 v-model 有效`,
        prop.loc,
      )
    }
    // .trim / .number 只对字符串值有意义。switch 的值是 boolean、slider/picker
    // 的值是 number，套用 .trim() 会抛 TypeError，.number 则会把 boolean
    // 静默转成 1/0，都会产出错误数据。
    if (!native.stringValue) {
      const invalidModifier = hasTrim ? 'trim' : hasNumber ? 'number' : null
      if (invalidModifier) {
        const valueType = tag === 'switch' ? 'boolean' : 'number / number[]'
        throw createCompileError(
          `<${tag}> 不支持 v-model.${invalidModifier} 修饰符：其事件值类型是 ${valueType}，` +
            `${invalidModifier === 'trim' ? '.trim 会对其调用字符串方法而报错' : '.number 会改变值类型'}。` +
            `该修饰符仅对 input / textarea 等字符串值标签，以及自定义组件有效`,
          prop.loc,
        )
      }
    }
    return extraPropsFor(native.valueKey, native.event)
  }

  // 未映射的标签：input/textarea 之外的未知表单标签，给出明确提示
  if (isNativeTag(tag)) {
    throw createCompileError(
      `<${tag}> 不支持 v-model：其事件值类型与单值绑定不匹配` +
        `（如 checkbox/radio 的 detail.value 是数组），请改用 :checked + 事件手动处理`,
      prop.loc,
    )
  }

  // 形态 3：组件默认 modelValue 约定
  rejectLazyOnComponent(tag, hasLazy, prop.loc)

  return extraPropsFor('modelValue', 'update:modelValue')
}

/**
 * 组件上的 `.lazy` 目前无法实现，直接报错而不是静默忽略。
 *
 * Vue 的做法是把修饰符作为 `modelModifiers: { lazy: true }` 传给子组件，
 * 由子组件决定何时 emit。VMS 没有等价机制（`defineModel` 只编译出
 * `triggerEvent('update:xxx')`，不接收 modifiers），因此父组件写 `.lazy`
 * 既无法改变事件名（小程序组件不会触发 change:update:xxx），
 * 也无法告知子组件——产物与不写 `.lazy` 完全相同，属于静默失效。
 *
 * 需要延迟同步时，应由子组件在合适的时机触发 update 事件。
 */
function rejectLazyOnComponent(tag: string, hasLazy: boolean, loc: DirectiveNode['loc']): void {
  if (!hasLazy) return
  throw createCompileError(
    `<${tag}> 的 v-model.lazy 暂不支持：VMS 尚未实现 Vue 的 modelModifiers 传递机制，` +
      `父组件无法告知子组件延迟同步，写了也不会生效（与不加 .lazy 完全一致）。` +
      `如需延迟同步，请在子组件内部选择合适的时机触发 update 事件。`,
    loc,
  )
}

/**
 * 将 .number / .trim 修饰符应用到赋值语句
 * 把赋值右侧的 e.detail.value 包一层转换表达式
 * v-for 场景的赋值语句是 BlockStatement（含 item 声明），递归定位其中的赋值表达式
 */
function applyValueTransform(
  statement: t.Statement,
  hasNumber: boolean,
  hasTrim: boolean,
): t.Statement {
  const wrap = (value: t.Expression): t.Expression => {
    let v = value
    // 修饰符顺序须与 Vue 一致：先 .trim 再 .number。
    // 反序会生成 (+value).trim()，对任何非空输入都抛 TypeError：
    // 数字没有 trim 方法。Vue 的 vModelText 同样是 trim 在前。
    if (hasTrim) {
      v = t.callExpression(t.memberExpression(v, t.identifier('trim')), [])
    }
    if (hasNumber) {
      // value === '' ? '' : +value（空串不转 0，保持清空语义）
      // 空值判断作用于 trim 之后的值，与 Vue 行为一致
      v = t.conditionalExpression(
        t.binaryExpression('===', v, t.stringLiteral('')),
        t.stringLiteral(''),
        t.unaryExpression('+', v),
      )
    }
    return v
  }

  const transformAssign = (node: t.Node): void => {
    if (t.isAssignmentExpression(node)) {
      // 只转换"事件新值"右侧表达式，两种形态都要覆盖：
      //   原生标签   e.detail.value
      //   自定义组件 e.detail
      const right = node.right
      if (isDetailValueAccess(right) || isPlainDetailAccess(right)) {
        node.right = wrap(right)
      }
      return
    }
    const visitorKeys = t.VISITOR_KEYS[node.type]
    if (!visitorKeys) return
    for (const key of visitorKeys) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && Object.hasOwn(child, 'type')) {
            transformAssign(child as t.Node)
          }
        }
      } else if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) {
        transformAssign(value as t.Node)
      }
    }
  }

  transformAssign(statement)
  return statement
}

/**
 * 构造赋值语句：目标 = 新值
 * v-for 场景下目标变量改写为 __vmsProxyRefs.list[index] 访问
 */
function buildAssignStatement(
  targetAst: t.Expression,
  node: VMSTemplateChildNode,
  ctx: VMSTransformContext,
  isComponentModel = false,
): t.Statement {
  const vForInfoList = getVForInfoList(ctx, node)

  let left: t.Expression = targetAst

  if (vForInfoList && vForInfoList.length > 0) {
    // v-for 场景：目标根是 v-for item/index 时，声明各级 item 局部常量后改写为
    // itemChain.name = 新值（与内联事件处理器的 item 引用机制一致，
    // 保证嵌套 v-for 中外层 item 通过局部常量正确解析）
    const rootName = rootOfMember(left)
    const itemIndex = vForInfoList.findIndex((info) => getVForItemName(info) === rootName)
    const idxIndex = vForInfoList.findIndex(
      (info) => (getVForIndexName(info) || 'index') === rootName,
    )
    const level = itemIndex !== -1 ? itemIndex : idxIndex
    if (level !== -1) {
      const rewritten = rewriteVForTarget(left, vForInfoList, level)
      if (rewritten) {
        // 新值来源：事件对象（取值位置见 resolveNewValueExpression 说明）
        const newValue = resolveNewValueExpression(isComponentModel)
        const assign = t.expressionStatement(
          t.assignmentExpression('=', rewritten as t.LVal, newValue),
        )
        return t.blockStatement([...declareVForItemsUpTo(vForInfoList, level, ctx), assign])
      }
    }
    // 目标是 setup 变量（如 list 本身）：改写根为 proxyRefs 访问
    if (t.isIdentifier(left)) {
      left = t.memberExpression(t.identifier('__vmsProxyRefs'), left)
    } else if (t.isMemberExpression(left) && t.isIdentifier(left.object)) {
      left = t.memberExpression(
        t.memberExpression(t.identifier('__vmsProxyRefs'), left.object),
        left.property,
        left.computed,
      )
    }
  } else if (t.isIdentifier(left)) {
    left = t.memberExpression(t.identifier('__vmsProxyRefs'), left)
  } else if (t.isMemberExpression(left) && t.isIdentifier(left.object)) {
    // user.name → __vmsProxyRefs.user.name
    left = t.memberExpression(
      t.memberExpression(t.identifier('__vmsProxyRefs'), left.object),
      left.property,
      left.computed,
    )
  }

  // 新值来源
  const newValue = resolveNewValueExpression(isComponentModel)

  return t.expressionStatement(t.assignmentExpression('=', left as t.LVal, newValue))
}

/**
 * 取得事件对象里的新值表达式。
 *
 * 两类事件源的事件对象形态不同，用错会静默写入 undefined：
 *
 * 1. 原生表单标签（input/textarea/switch/slider/picker）
 *    事件是平台原生事件，值在 e.detail.value：
 *      <input bind:input> -> e.detail = { value: '...' }
 *
 * 2. 自定义组件（含 defineModel）
 *    值由子组件通过 context.triggerEvent(name, value) 传出。
 *    微信把第二个参数整体作为 detail，因此 e.detail 就是值本身：
 *      triggerEvent('update:modelValue', 'abc') -> e.detail === 'abc'
 *      triggerEvent('update:modelValue', {a:1}) -> e.detail === { a: 1 }
 *    已用模拟器实测：emit('raw','RAW_VALUE') 的 e.detail 为字符串 RAW_VALUE，
 *    而非 { value: 'RAW_VALUE' }。项目内既有代码同样按 e.detail 读取，
 *    见 subInformation/pages/SubJoinConfigSecondIndex.vue 的 updateIdCardFaceUrl。
 *
 * 早期实现两类都生成 e.detail.value，导致组件 v-model / defineModel
 * 把 undefined 写回父组件（父组件的值被清空）。
 */
function resolveNewValueExpression(isComponentModel: boolean): t.Expression {
  const detail = t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail'))
  return isComponentModel ? detail : t.memberExpression(detail, t.identifier('value'))
}

/** 判断表达式是否为 e.detail.value（原生表单标签形态） */
function isDetailValueAccess(node: t.Node): boolean {
  return (
    t.isMemberExpression(node) &&
    t.isMemberExpression(node.object) &&
    t.isIdentifier(node.object.object, { name: EVENT_PARAM_NAME }) &&
    t.isIdentifier(node.object.property, { name: 'detail' }) &&
    t.isIdentifier(node.property, { name: 'value' })
  )
}

/** 判断表达式是否为 e.detail（自定义组件形态） */
function isPlainDetailAccess(node: t.Node): boolean {
  return (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object, { name: EVENT_PARAM_NAME }) &&
    t.isIdentifier(node.property, { name: 'detail' })
  )
}

/**
 * 声明 0..level 层的 v-for item 局部常量
 * 外层 item 的 source 可能引用更外层的 item，需按嵌套顺序声明
 */
function declareVForItemsUpTo(
  vForInfoList: NonNullable<ReturnType<typeof getVForInfoList>>,
  level: number,
  ctx: VMSTransformContext,
): t.Statement[] {
  const statements: t.Statement[] = []
  for (let i = 0; i <= level; i++) {
    const info = vForInfoList[i]
    const itemName = getVForItemName(info)
    if (!itemName) continue
    statements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(itemName),
          buildProxyRefsItemAccess(vForInfoList, i, ctx.scriptScope),
        ),
      ]),
    )
  }
  return statements
}

/**
 * v-for 场景改写目标：item.name → __vmsProxyRefs.list[index].name
 * 返回 null 表示不是 v-for 目标
 */
function rewriteVForTarget(
  target: t.Expression,
  vForInfoList: NonNullable<ReturnType<typeof getVForInfoList>>,
  level: number,
): t.Expression | null {
  // 以声明好的 item 局部常量为访问链基底（buildAssignStatement 已按序声明）
  const itemName = getVForItemName(vForInfoList[level])
  if (!itemName) return null

  // 目标是 item 本身：item = 新值（整体替换）
  if (t.isIdentifier(target) && target.name === itemName) {
    return t.identifier(itemName)
  }

  // 目标是 item 属性（含嵌套 member）：item.a.b = 新值
  if (t.isMemberExpression(target)) {
    const rootName = rootOfMember(target)
    if (rootName === itemName) {
      return target
    }
  }
  return null
}

function rootOfMember(node: t.Expression): string {
  let cur: t.Expression = node
  while (t.isMemberExpression(cur)) {
    cur = cur.object as t.Expression
  }
  return t.isIdentifier(cur) ? cur.name : ''
}

/**
 * 判断目标根变量是否来自当前节点的某个 v-for item（含解构变量）。
 * 用于区分"经 v-for 间接写入插槽数据"与"绑定父组件自己的 ref"。
 */
function targetsVForItem(
  name: string,
  ctx: VMSTransformContext,
  node: VMSTemplateChildNode,
): boolean {
  const list = getVForInfoList(ctx, node)
  if (!list || list.length === 0) return false
  return list.some(
    (info) => getVForItemName(info) === name || Boolean(info.destructuredVars?.has(name)),
  )
}

function isVForVar(name: string, ctx: VMSTransformContext, node: VMSTemplateChildNode): boolean {
  const vForInfoList = getVForInfoList(ctx, node)
  if (!vForInfoList || vForInfoList.length === 0) return false
  return vForInfoList.some(
    (info) => getVForItemName(info) === name || (getVForIndexName(info) || 'index') === name,
  )
}

/**
 * 判断变量是否是 v-for 的索引变量（而非 item）
 * 注意默认索引名 'index' 在用户未显式命名时才生效
 */
function isVForIndexVar(
  name: string,
  ctx: VMSTransformContext,
  node: VMSTemplateChildNode,
): boolean {
  const vForInfoList = getVForInfoList(ctx, node)
  if (!vForInfoList || vForInfoList.length === 0) return false
  return vForInfoList.some(
    (info) => (getVForIndexName(info) || 'index') === name && getVForItemName(info) !== name,
  )
}

function shouldSkip(name: string, ctx: VMSTransformContext): boolean {
  const scope = ctx.scriptScope
  if (!scope) return false
  return (
    scope.props.has(name) ||
    scope.macros.has(name) ||
    scope.imports.has(name) ||
    scope.globals.has(name)
  )
}

/**
 * babel 解析表达式（Vue compiler 已给出 content，这里需要 AST）
 *
 * 解析失败时返回 null 而不是 t.identifier(content)：后者会把 "'lit'" 之类的
 * 非法目标伪装成合法标识符，最终生成 `__vmsProxyRefs.'lit' = ...` 这种语法错误代码，
 * 且编译期不报错。调用方需自行抛出 CompileError。
 */
function fallbackParse(content: string): t.Expression | null {
  try {
    const stmt = parse(content, { sourceType: 'script', plugins: ['typescript'] }).program.body[0]
    if (stmt?.type === 'ExpressionStatement') {
      return stmt.expression as t.Expression
    }
  } catch {
    // fallthrough
  }
  return null
}
