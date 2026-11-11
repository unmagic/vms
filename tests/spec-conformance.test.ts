import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { compileVueContent } from './test-utils'

/**
 * 将生成代码压缩为单行，便于断言跨行结构。
 * 仅归一化空白，不改变语法结构，避免测试依赖 babel generator 的换行策略。
 */
function flat(code: string): string {
  return code.replace(/\s+/g, ' ').trim()
}

/**
 * v-model / defineModel / 作用域插槽的微信小程序规范符合性测试
 *
 * 参照 glass-easel 官方规范（wechat-miniprogram/glass-easel）：
 * 1. 具名插槽：子节点以 slot="<name>" 定向插入
 * 2. 动态 slot（dynamicSlots: true）：子组件 <slot :item="item" /> 传数据，
 *    父组件子节点用 slot:item（可别名 slot:item="alias"）接收；
 *    具名 + 作用域需同时带 slot="name" 与 slot:xxx，
 *    官方用例：<div slot="abc" slot:some-text>
 * 3. 事件绑定：bind:<event>，事件对象为 e.detail.value
 * 4. 列表渲染：wx:for / wx:for-item / wx:for-index / wx:key
 * 5. 数据传递：data-* 传索引，多级用 data-a="{{[i, j]}}" 数组
 */

describe('WXML 规范：v-model 在 v-for 中使用 item 与 index', () => {
  it('1.1 原生 input 绑定 item.name：wx:for 变量 + data-a 传 index', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <input v-model="item.name" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: '' }])
</script>
`)

    expect(error).toBeNull()
    // 规范：wx:for 列表渲染 + wx:key
    expect(wxml).toContain('wx:for="{{list}}"')
    expect(wxml).toContain('wx:key="id"')
    // 默认 item/index 无需显式 wx:for-item / wx:for-index
    expect(wxml).not.toContain('wx:for-item')
    expect(wxml).not.toContain('wx:for-index')
    // 规范：绑定值为 item 属性路径
    expect(wxml).toContain('value="{{item.name}}"')
    // 规范：事件为 bind:input
    expect(wxml).toMatch(/bind:input="__fun_\d+"/)
    // 规范：索引经 data-* 传递（数组形式便于多级索引）
    expect(wxml).toContain('data-a="{{[index]}}"')
    // 规范：dataset 为字符串键，解构后按链回写
    expect(flat(js)).toContain('const { a: [index] } = __vms_event.currentTarget.dataset')
    expect(js).toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('item.name = __vms_event.detail.value')
  })

  it('1.2 显式命名的 v-for 变量生成 wx:for-item / wx:for-index', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <view v-for="(row, ri) in rows" :key="row.id">
    <input v-model="row.name" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, name: '' }])
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{rows}}"')
    expect(wxml).toContain('wx:for-item="row"')
    expect(wxml).toContain('wx:for-index="ri"')
    expect(wxml).toContain('value="{{row.name}}"')
    expect(wxml).toContain('data-a="{{[ri]}}"')
  })

  it('1.3 原生 switch 在 v-for 内使用 checked/change 规范', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <switch v-model="item.on" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, on: false }])
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('checked="{{item.on}}"')
    expect(wxml).toMatch(/bind:change="__fun_\d+"/)
    expect(wxml).toContain('data-a="{{[index]}}"')
  })
})

describe('WXML 规范：嵌套 v-for 中使用内外层 item/index', () => {
  it('2.1 双层嵌套：内层覆盖默认变量，data-a 传两级索引', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(row, ri) in rows" :key="row.id">
    <view v-for="(cell, ci) in row.cells" :key="cell.id">
      <input v-model="cell.text" />
      <text>{{ ri }}-{{ ci }}</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cells: [{ id: 1, text: '' }] }])
</script>
`)

    expect(error).toBeNull()
    // 规范：内外层均有独立 for-item / for-index，内层数据源引用外层 item
    expect(wxml).toContain('wx:for="{{rows}}" wx:for-item="row" wx:for-index="ri"')
    expect(wxml).toContain('wx:for="{{row.cells}}" wx:for-item="cell" wx:for-index="ci"')
    // 内层绑定的仍是内层 item
    expect(wxml).toContain('value="{{cell.text}}"')
    // 规范：data-* 用数组承载多级索引
    expect(wxml).toContain('data-a="{{[ri,ci]}}"')
    // 规范：setter 按索引逐级解引用后写入
    expect(flat(js)).toContain('const { a: [ri, ci] } = __vms_event.currentTarget.dataset')
    expect(js).toContain('const row = __vmsProxyRefs.rows[ri]')
    expect(js).toContain('const cell = row.cells[ci]')
    expect(js).toContain('cell.text = __vms_event.detail.value')
  })

  it('2.2 嵌套 v-for 内多个 v-model 各自独立 data 索引', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(row, ri) in rows" :key="row.id">
    <view v-for="(cell, ci) in row.cells" :key="cell.id">
      <MyInput v-model="cell.text" v-model:title="cell.title" />
    </view>
  </view>
</template>
<script setup lang="ts">
import MyInput from './MyInput.vue'
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cells: [{ id: 1, text: '', title: '' }] }])
</script>
`)

    expect(error).toBeNull()
    // 每个 v-model 各占一个 data 键，避免相互覆盖
    expect(wxml).toContain('data-a="{{[ri,ci]}}"')
    expect(wxml).toContain('data-b="{{[ri,ci]}}"')
    expect(flat(js)).toContain('const { a: [ri, ci] } = __vms_event.currentTarget.dataset')
    expect(flat(js)).toContain('const { b: [ri, ci] } = __vms_event.currentTarget.dataset')
    // 组件事件：detail 即 emit 的值
    expect(js).toContain('cell.text = __vms_event.detail')
    expect(js).toContain('cell.title = __vms_event.detail')
  })

  it('2.2b 解构式 v-for 的变量作为 v-model 目标：改写为 item 属性访问', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="({ id, name }, index) in list" :key="id">
    <input v-model="name" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: '' }])
</script>
`)

    expect(error).toBeNull()
    // WXML 中不存在解构变量 name，必须落到 wx:for 默认的 item 上
    expect(wxml).toContain('value="{{item.name}}"')
    expect(wxml).not.toContain('value="{{name}}"')
    expect(flat(js)).toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('item.name = __vms_event.detail.value')
    // 不得把解构变量 name 注册进组件 data（否则会与 v-for 作用域混淆）
    const internalState = js.match(/__vmsInternalState = \{([\s\S]*?)\}/)?.[1] ?? ''
    expect(internalState).not.toMatch(/\bname\b/)
    expect(js).not.toContain('__vmsProxyRefs.name')
  })

  it('2.2c 嵌套解构路径与数组解构：按路径逐级改写', async () => {
    const nested = await compileVueContent(`
<template>
  <view v-for="{ user: { name } } in list" :key="name">
    <input v-model="name" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ user: { name: '' } }])
</script>
`)
    expect(nested.error).toBeNull()
    expect(nested.wxml).toContain('value="{{item.user.name}}"')
    expect(nested.js).toContain('item.user.name = __vms_event.detail.value')

    const array = await compileVueContent(`
<template>
  <view v-for="([a, b], i) in pairs" :key="i">
    <input v-model="b" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const pairs = ref([['x', '']])
</script>
`)
    expect(array.error).toBeNull()
    expect(array.wxml).toContain('value="{{item[1]}}"')
    expect(array.js).toContain('item[1] = __vms_event.detail.value')
  })

  it('2.3 外层显式 index + 内层默认 index：自动生成唯一名称，产物合法', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <view v-for="child in item.children" :key="child.id">
      <input v-model="child.name" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, children: [{ id: 1, name: '' }] }])
</script>
`)

    expect(error).toBeNull()
    // 内层未显式命名，生成唯一 index 名，避免与外层 index 冲突
    expect(wxml).toContain('wx:for-index="_child_0_index"')
    expect(wxml).toContain('data-a="{{[index,_child_0_index]}}"')
    // 解构出的两个变量名互不相同，产物必须是合法 JS
    expect(flat(js)).toContain(
      'const { a: [index, _child_0_index] } = __vms_event.currentTarget.dataset',
    )
  })

  it('2.4 嵌套 v-for 各级显式使用同名 index：报编译错误而非产出非法代码', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <view v-for="(child, index) in item.children" :key="child.id">
      <input v-model="child.name" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, children: [{ id: 1, name: '' }] }])
</script>
`)

    // 内层同名 index 会遮蔽外层，且解构会重复声明同一变量
    expect(error).not.toBeNull()
    expect(error!.message).toContain('index')
    expect(error!.message).toContain('重复')
    // 不得产出 `[index, index]` 这类非法解构
    expect(js).not.toMatch(/\[index,\s*index\]/)
  })

  it('2.5 嵌套 v-for 使用不同 index 名：正常转译', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <view v-for="(child, childIndex) in item.children" :key="child.id">
      <input v-model="child.name" />
      <text>{{ index }}-{{ childIndex }}</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, children: [{ id: 1, name: '' }] }])
</script>
`)

    expect(error).toBeNull()
    // index 是 WXML 默认名，无需显式输出；childIndex 非默认，必须显式声明
    expect(wxml).not.toContain('wx:for-index="index"')
    expect(wxml).toContain('wx:for-index="childIndex"')
    expect(wxml).toContain('data-a="{{[index,childIndex]}}"')
    expect(flat(js)).toContain(
      'const { a: [index, childIndex] } = __vms_event.currentTarget.dataset',
    )
  })

  it('2.6 并列（非嵌套）v-for 复用同一 index 名不受影响', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <view v-for="(a, index) in listA" :key="a.id"><input v-model="a.v" /></view>
  <view v-for="(b, index) in listB" :key="b.id"><input v-model="b.v" /></view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const listA = ref([{ id: 1, v: '' }])
const listB = ref([{ id: 1, v: '' }])
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{listA}}"')
    expect(wxml).toContain('wx:for="{{listB}}"')
  })

  it('2.7 嵌套 v-for 内使用 item/index 作为只读展示不受影响', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <view v-for="(group, gi) in groups" :key="group.id">
    <view v-for="(item, ii) in group.children" :key="item.id">
      <input v-model="item.value" />
      <text>{{ group.name }}-{{ gi }}-{{ ii }}-{{ item.id }}</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ id: 1, name: 'g', children: [{ id: 1, value: '' }] }])
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('value="{{item.value}}"')
    // 内外层变量在插值中同时可见
    expect(wxml).toContain('{{group.name}}-{{gi}}-{{ii}}-{{item.id}}')
    expect(wxml).toContain('data-a="{{[gi,ii]}}"')
  })
})

describe('WXML 规范：defineModel 子组件侧', () => {
  it('3.1 defineModel 注册 properties 并生成 customRef（get props / set triggerEvent）', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <view>{{ model }}</view>
</template>
<script setup lang="ts">
const model = defineModel<string>()
</script>
`)

    expect(error).toBeNull()
    // 规范：声明为组件 property，类型为 null（任意类型）
    expect(js).toMatch(/properties:\s*\{[\s\S]*modelValue:\s*\{\s*type: null/)
    // 规范：读父组件传入值
    expect(js).toContain('return __vmsProps.modelValue')
    // 规范：写回经 triggerEvent('update:xxx')
    expect(js).toContain('__vmsContext.triggerEvent("update:modelValue", __vms_value)')
  })

  it('3.1b kebab-case 属性名生成合法的字符串键与计算成员访问', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <view>{{ v }}</view>
</template>
<script setup lang="ts">
const v = defineModel<string>('user-name')
</script>
`)

    expect(error).toBeNull()
    // 属性名不是合法 JS 标识符时，必须用字符串键
    expect(js).toContain('"user-name"')
    // 访问也必须用计算成员，避免 __vmsProps.user-name 语法错误
    expect(js).toContain('__vmsProps["user-name"]')
    expect(js).not.toContain('__vmsProps.user-name')
    // 事件名保持 kebab-case，与父组件 v-model:user-name 对应
    expect(js).toContain('triggerEvent("update:user-name"')

    // 产物必须是合法 JS
    expect(() => parse(js, { sourceType: 'module' })).not.toThrow()
  })

  // 回归：defineModel 变量曾被纳入"解构 props 改写"集合，
  // 导致 setter 生成 __vmsProps.model（非真实 property 名），
  // 完全绕过 customRef 的 setter，update 事件不会触发。
  it('3.1c defineModel 变量作为 v-model 目标：写回经 proxyRefs 而非 __vmsProps', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <input v-model="model" />
</template>
<script setup lang="ts">
const model = defineModel<string>()
</script>
`)

    expect(error).toBeNull()
    const setter = js.match(/function __fun_0[\s\S]*?\n {4}\}/)?.[0] ?? ''
    // 必须写 __vmsProxyRefs.model：proxyRefs 会解包到 customRef.value，
    // 由 customRef 的 setter 触发 triggerEvent('update:modelValue')
    expect(flat(setter)).toContain('__vmsProxyRefs.model = __vms_event.detail.value')
    expect(setter).not.toContain('__vmsProps.model')
    expect(js).toContain('proxyRefs')
    // customRef 的 setter 仍然保留
    expect(js).toContain('triggerEvent("update:modelValue", __vms_value)')
  })

  it('3.1d 具名 defineModel 同样经 proxyRefs 写回', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <input v-model="title" />
</template>
<script setup lang="ts">
const title = defineModel<string>('title')
</script>
`)

    expect(error).toBeNull()
    const setter = js.match(/function __fun_0[\s\S]*?\n {4}\}/)?.[0] ?? ''
    expect(flat(setter)).toContain('__vmsProxyRefs.title = __vms_event.detail.value')
    expect(setter).not.toContain('__vmsProps.title')
  })

  it('3.2 defineModel 具名变量在 v-for 内使用时数据源来自 props', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const title = defineModel<string>('title')
const change = () => { title.value = 'x' }
</script>
`)

    expect(error).toBeNull()
    expect(js).toMatch(/title:\s*\{\s*type: null/)
    expect(js).toContain('return __vmsProps.title')
    expect(js).toContain('triggerEvent("update:title", __vms_value)')
  })
})

describe('WXML 规范：作用域插槽（glass-easel dynamicSlots）', () => {
  it('4.1 子组件在 v-for 中导出 item/index：slot 属性绑定 + dynamicSlots', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(item, index) in items" :key="item.id">
    <slot name="row" :item="item" :index="index" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
</script>
`)

    expect(error).toBeNull()
    // 规范：slot 出口以属性形式导出数据
    expect(wxml).toContain('<slot name="row" item="{{item}}" index="{{index}}"')
    // 规范：dynamicSlots 与 multipleSlots 选项
    expect(js).toContain('dynamicSlots')
    expect(js).toContain('multipleSlots')
  })

  it('4.2 父组件接收具名作用域插槽：slot="name" 与 slot:xxx 必须同时存在', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ item, index }">
      <text>{{ item.name }}-{{ index }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    expect(error).toBeNull()
    // 官方用例 <div slot="abc" slot:some-text>：具名与作用域属性并存
    expect(wxml).toContain('slot="row"')
    expect(wxml).toContain('slot:item')
    expect(wxml).toContain('slot:index')
    expect(wxml).toContain('{{item.name}}-{{index}}')
  })

  it('4.3 作用域插槽别名：slot:item="alias"', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ item: it }">
      <text>{{ it }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    expect(error).toBeNull()
    // 规范：slot:xxx="alias" 指定别名
    expect(wxml).toContain('slot:item="it"')
    expect(wxml).toContain('slot="row"')
    expect(wxml).toContain('{{it}}')
  })

  it('4.3b kebab-case 数据名：slot:list-item="li"', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ 'list-item': li }">
      <text>{{ li.id }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    expect(error).toBeNull()
    // 字符串键（kebab-case）不得被静默丢弃
    expect(wxml).toContain('slot="row"')
    expect(wxml).toContain('slot:list-item="li"')
    expect(wxml).toContain('{{li.id}}')
  })

  it('4.3c v-model 不能绑定作用域插槽变量（父组件只读）', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ item }">
      <input v-model="item.name" />
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    // slot 变量由子组件传入，父组件中只读；写回会引用未定义的 __vmsProxyRefs
    expect(error).not.toBeNull()
    expect(error!.message).toContain('只读')
    expect(js).not.toContain('__vmsProxyRefs.item')
  })

  // 回归：经 v-for 间接写入插槽数据。slot 变量本身已在 4.3c 拦截，
  // 但 <template #row="{ items }"> 内 v-for="it in items" 再 v-model="it.x"
  // 会生成 __vmsProxyRefs.items[...]（items 从不注册），运行时抛 ReferenceError。
  it('4.3c2 插槽变量作为 v-for 数据源时，v-model 报编译错误', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ items }">
      <view v-for="(it, i) in items" :key="it.id">
        <input v-model="it.name" />
      </view>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('作用域插槽变量')
    expect(js).not.toContain('__vmsProxyRefs.items')
  })

  it('4.3c3 插槽 item 的属性作为 v-for 数据源时同样报错', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ item }">
      <view v-for="(sub, si) in item.subs" :key="sub.id">
        <MyInput v-model="sub.name" />
      </view>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
import MyInput from './MyInput.vue'
</script>
`)

    expect(error).not.toBeNull()
    expect(js).not.toContain('__vmsProxyRefs.item')
  })

  it('4.3d 作用域插槽内可正常绑定父组件自己的 ref', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ item }">
      <input v-model="local" />
      <text>{{ item.name }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
import { ref } from '@unmagic/vue-mini'
const local = ref('')
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('slot="row"')
    expect(wxml).toContain('slot:item')
    expect(wxml).toContain('value="{{local}}"')
  })

  it('4.3e 动态插槽名 v-slot:[name] 报编译错误（不得静默绑定字面量）', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template v-slot:[name]="{ item }">
      <text>{{ item }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
import { ref } from '@unmagic/vue-mini'
const name = ref('row')
</script>
`)

    // 小程序的 slot 名必须在编译期确定；旧行为会静默产出 slot="name"
    expect(error).not.toBeNull()
    expect(error!.message).toContain('动态插槽名')
    expect(wxml).not.toContain('slot="name"')
  })

  it('4.3f 静态具名插槽不受动态插槽名校验影响', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template #row="{ item }">
      <text>{{ item }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('slot="row"')
    expect(wxml).toContain('slot:item')
  })

  it('4.4 默认作用域插槽不带 slot 属性', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <MyList>
    <template #default="{ item }">
      <text>{{ item.name }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('slot:item')
    expect(wxml).not.toContain('slot="default"')
  })

  it('4.5 子组件嵌套 v-for 导出内外层数据', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(group, gi) in groups" :key="group.id">
    <view v-for="(item, ii) in group.children" :key="item.id">
      <slot name="cell" :item="item" :index="ii" :group="group" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ id: 1, children: [{ id: 1 }] }])
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('item="{{item}}"')
    expect(wxml).toContain('index="{{ii}}"')
    expect(wxml).toContain('group="{{group}}"')
    expect(wxml).toContain('wx:for-item="group"')
    expect(wxml).toContain('wx:for-index="ii"')
    expect(js).toContain('dynamicSlots')
  })

  it('4.6 父组件在嵌套 v-for 内使用作用域插槽并混用内外层变量', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <view v-for="(it, ii) in g.children" :key="it.id">
      <MyList>
        <template #row="{ item, index }">
          <text>{{ g.name }}-{{ it.name }}-{{ item.name }}-{{ index }}-{{ gi }}-{{ ii }}</text>
        </template>
      </MyList>
    </view>
  </view>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ id: 1, name: 'a', children: [{ id: 1, name: 'b' }] }])
</script>
`)

    expect(error).toBeNull()
    // 具名 + 作用域并存
    expect(wxml).toContain('slot="row"')
    expect(wxml).toContain('slot:item')
    expect(wxml).toContain('slot:index')
    // 外层 v-for 变量与槽变量可混用
    expect(wxml).toContain('{{g.name}}-{{it.name}}-{{item.name}}-{{index}}-{{gi}}-{{ii}}')
    // 槽变量属于子组件作用域，不得进入父组件 data
    expect(js).not.toContain('item.name,')
  })
})

describe('WXML 规范：v-model 与 defineModel 组合（父子双向绑定）', () => {
  it('5.1 父组件 v-model 对应子组件 defineModel 的默认 modelValue', async () => {
    const parent = await compileVueContent(`
<template>
  <MyInput v-model="text" />
</template>
<script setup lang="ts">
import MyInput from './MyInput.vue'
import { ref } from '@unmagic/vue-mini'
const text = ref('')
</script>
`)
    const child = await compileVueContent(`
<template>
  <view>{{ model }}</view>
</template>
<script setup lang="ts">
const model = defineModel<string>()
</script>
`)

    expect(parent.error).toBeNull()
    expect(child.error).toBeNull()
    // 父：传 modelValue + 监听 update:modelValue
    expect(parent.wxml).toContain('modelValue="{{text}}"')
    expect(parent.wxml).toMatch(/bind:update:modelValue="__fun_\d+"/)
    // 子：声明同名 property + 触发同名事件
    expect(child.js).toMatch(/modelValue:\s*\{\s*type: null/)
    expect(child.js).toContain('triggerEvent("update:modelValue"')
  })

  it('5.2 父组件 v-model:title 对应子组件 defineModel("title")', async () => {
    const parent = await compileVueContent(`
<template>
  <MyInput v-model:title="t" />
</template>
<script setup lang="ts">
import MyInput from './MyInput.vue'
import { ref } from '@unmagic/vue-mini'
const t = ref('')
</script>
`)
    const child = await compileVueContent(`
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const title = defineModel<string>('title')
</script>
`)

    expect(parent.error).toBeNull()
    expect(child.error).toBeNull()
    expect(parent.wxml).toContain('title="{{t}}"')
    expect(parent.wxml).toMatch(/bind:update:title="__fun_\d+"/)
    expect(child.js).toMatch(/title:\s*\{\s*type: null/)
    expect(child.js).toContain('triggerEvent("update:title"')
  })

  it('5.3 嵌套 v-for 内 v-model 对应 defineModel：索引回写链路完整', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <view v-for="(row, ri) in rows" :key="row.id">
    <view v-for="(cell, ci) in row.cells" :key="cell.id">
      <MyInput v-model="cell.value" />
    </view>
  </view>
</template>
<script setup lang="ts">
import MyInput from './MyInput.vue'
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cells: [{ id: 1, value: '' }] }])
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toContain('modelValue="{{cell.value}}"')
    expect(wxml).toMatch(/bind:update:modelValue="__fun_\d+"/)
    expect(wxml).toContain('data-a="{{[ri,ci]}}"')
    expect(js).toContain('const row = __vmsProxyRefs.rows[ri]')
    expect(js).toContain('const cell = row.cells[ci]')
    expect(js).toContain('cell.value = __vms_event.detail')
  })
})
