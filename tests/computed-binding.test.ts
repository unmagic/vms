import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('属性绑定函数返回值（computed 绑定）', () => {
  it(':title 绑定无参函数返回值', async () => {
    const vue = `
<template>
  <view :title="getTitle()" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const name = ref('hello')
function getTitle() { return name.value + '!' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0}}"')
    expect(js).toContain('computed')
    expect(js).toContain('proxyRefs')
    expect(js).toContain('__vmsProxyRefs.getTitle()')
  })

  it(':title 绑定带参函数返回值', async () => {
    const vue = `
<template>
  <view :title="fmt(name)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const name = ref('hello')
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0}}"')
    expect(js).toContain('__vmsProxyRefs.fmt(__vmsProxyRefs.name)')
  })

  it('文本插值中的函数调用', async () => {
    const vue = `
<template>
  <text>{{ fmt(name) }}</text>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const name = ref('hello')
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('{{__vmsComputed_0}}')
  })

  it('v-if 中的函数返回值', async () => {
    const vue = `
<template>
  <view v-if="isVisible()">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
function isVisible() { return show.value }
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:if="{{__vmsComputed_0}}"')
  })

  it('v-show 中的函数返回值', async () => {
    const vue = `
<template>
  <view v-show="shouldShow()">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const visible = ref(false)
function shouldShow() { return visible.value }
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('hidden="{{!(__vmsComputed_0)}}"')
  })

  it('多个函数绑定生成唯一名称', async () => {
    const vue = `
<template>
  <view :title="a()" :data-x="b()" />
</template>
<script setup lang="ts">
function a() { return 'a' }
function b() { return 'b' }
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('__vmsComputed_0')
    expect(wxml).toContain('__vmsComputed_1')
  })

  it('成员表达式作为参数', async () => {
    const vue = `
<template>
  <image :src="getUrl(user.avatar)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref({ avatar: '/a.png' })
function getUrl(p: string) { return 'https://x.com' + p }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('src="{{__vmsComputed_0}}"')
    expect(js).toContain('__vmsProxyRefs.getUrl(__vmsProxyRefs.user.avatar)')
  })

  it('v-for 内绑定函数返回值（item 作为参数）', async () => {
    const vue = `
<template>
  <view v-for="item in items" :key="item.id" :title="fmt(item.name)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for-index="_item_0_index"')
    expect(wxml).toContain('title="{{__vmsComputed_0[_item_0_index]}}"')
    expect(js).toContain('__vmsProxyRefs.items.map(item => __vmsProxyRefs.fmt(item.name))')
  })

  it('v-for 内绑定函数返回值（显式 index 作为参数）', async () => {
    const vue = `
<template>
  <view v-for="(item, index) in items" :key="index" :title="fmt(item.name, index)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ name: 'a' }])
function fmt(s: string, i: number) { return i + ':' + s }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[index]}}"')
    expect(js).toContain(
      '__vmsProxyRefs.items.map((item, index) => __vmsProxyRefs.fmt(item.name, index))',
    )
  })

  it('v-for 内绑定函数返回值（item 与 setup 变量混合）', async () => {
    const vue = `
<template>
  <view v-for="item in items" :key="item.id" :title="fmt(item.name, prefix)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
const prefix = ref('P:')
function fmt(s: string, p: string) { return p + s }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[_item_0_index]}}"')
    expect(js).toContain('__vmsProxyRefs.fmt(item.name, __vmsProxyRefs.prefix)')
  })

  it('嵌套 v-for 内绑定函数返回值', async () => {
    const vue = `
<template>
  <view v-for="row in rows" :key="row.id">
    <view v-for="col in row.cols" :key="col.id" :title="fmt(col.name)" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cols: [{ id: 2, name: 'a' }] }])
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    // 嵌套 v-for 生成多层 .map() 和多维 index 取值
    expect(wxml).toContain('title="{{__vmsComputed_0[_row_0_index][_col_1_index]}}"')
    expect(js).toContain(
      '__vmsProxyRefs.rows.map(row => row.cols.map(col => __vmsProxyRefs.fmt(col.name)))',
    )
  })

  it('嵌套 v-for 内绑定函数返回值（外层 index 作为参数）', async () => {
    const vue = `
<template>
  <view v-for="(row, rowIndex) in rows" :key="rowIndex">
    <view v-for="col in row.cols" :key="col.id" :title="fmt(col.name, rowIndex)" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cols: [{ id: 2, name: 'a' }] }])
function fmt(s: string, i: number) { return i + ':' + s }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[rowIndex]')
    expect(js).toContain(
      'rows.map((row, rowIndex) => row.cols.map(col => __vmsProxyRefs.fmt(col.name, rowIndex)))',
    )
  })

  it('嵌套 v-for 内绑定函数返回值（内层 index 作为参数）', async () => {
    const vue = `
<template>
  <view v-for="row in rows" :key="row.id">
    <view v-for="(col, colIdx) in row.cols" :key="colIdx" :title="fmt(col.name, colIdx)" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cols: [{ id: 2, name: 'a' }] }])
function fmt(s: string, i: number) { return i + ':' + s }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[_row_0_index][colIdx]}}"')
    expect(js).toContain('row.cols.map((col, colIdx) => __vmsProxyRefs.fmt(col.name, colIdx))')
  })

  it('嵌套 v-for 内绑定函数返回值（item 与 setup 变量混合）', async () => {
    const vue = `
<template>
  <view v-for="row in rows" :key="row.id">
    <view v-for="col in row.cols" :key="col.id" :title="fmt(col.name, prefix)" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, cols: [{ id: 2, name: 'a' }] }])
const prefix = ref('P:')
function fmt(s: string, p: string) { return p + s }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[_row_0_index][_col_1_index]}}"')
    expect(js).toContain('__vmsProxyRefs.fmt(col.name, __vmsProxyRefs.prefix)')
  })

  it('嵌套 v-for 内绑定函数返回值（同时引用内外层 item）', async () => {
    const vue = `
<template>
  <view v-for="row in rows" :key="row.id">
    <view v-for="col in row.cols" :key="col.id" :title="fmt(row.label, col.name)" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, label: 'R', cols: [{ id: 2, name: 'a' }] }])
function fmt(r: string, c: string) { return r + ':' + c }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[_row_0_index][_col_1_index]}}"')
    // row 是外层 map 参数，通过闭包在内层访问
    expect(js).toContain(
      'rows.map(row => row.cols.map(col => __vmsProxyRefs.fmt(row.label, col.name)))',
    )
  })

  it('三层嵌套 v-for 内绑定函数返回值', async () => {
    const vue = `
<template>
  <view v-for="cat in cats" :key="cat.id">
    <view v-for="row in cat.rows" :key="row.id">
      <view v-for="col in row.cols" :key="col.id" :title="fmt(col.name)" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const cats = ref([{ id: 1, rows: [{ id: 2, cols: [{ id: 3, name: 'a' }] }] }])
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    // 三层嵌套生成三维 index 取值
    expect(wxml).toContain('title="{{__vmsComputed_0[_cat_0_index][_row_1_index][_col_2_index]}}"')
    expect(js).toContain(
      '__vmsProxyRefs.cats.map(cat => cat.rows.map(row => row.cols.map(col => __vmsProxyRefs.fmt(col.name))))',
    )
  })

  it('嵌套 v-for 源为复杂表达式（方括号访问）', async () => {
    const vue = `
<template>
  <view v-for="row in rows" :key="row.id">
    <view v-for="col in grouped[row.key]" :key="col.id" :title="fmt(col.name)" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const rows = ref([{ id: 1, key: 'a' }])
const grouped = ref({ a: [{ id: 2, name: 'x' }] })
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[_row_0_index][_col_1_index]}}"')
    // grouped 是 setup ref → __vmsProxyRefs.grouped；row 是外层 map 参数，不改写
    expect(js).toContain('__vmsProxyRefs.grouped[row.key]')
  })

  it('导入的函数作为绑定（模块作用域直连）', async () => {
    const vue = `
<template>
  <view :title="fmtExternal(name)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import { fmtExternal } from './utils'
const name = ref('hello')
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0}}"')
    // 导入函数直接访问，不经过 __vmsProxyRefs
    expect(js).toContain('fmtExternal(__vmsProxyRefs.name)')
  })
})
