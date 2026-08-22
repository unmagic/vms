import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('解构式 v-for', () => {
  it('对象解构：模板插值与 wx:for-item', async () => {
    const vue = `
<template>
  <view v-for="{ id, name } in items" :key="id">
    <text>{{ name }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    // item 名统一为默认 'item'，不再输出错误的 wx:for-item="{ id, name }"
    expect(wxml).not.toContain('wx:for-item')
    expect(wxml).toContain('{{item.name}}')
    // 解构变量不应被收集为 setup 变量
    expect(js).not.toContain('name,')
  })

  it('对象解构 + 显式 index', async () => {
    const vue = `
<template>
  <view v-for="({ id, name }, index) in items" :key="id">
    <text>{{ index }}: {{ name }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('{{index}}')
    expect(wxml).toContain('{{item.name}}')
  })

  it('别名解构：userId 映射到 item.id', async () => {
    const vue = `
<template>
  <view v-for="{ id: userId, name } in items" :key="userId">
    <text>{{ userId }} - {{ name }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('{{item.id}}')
    expect(wxml).toContain('{{item.name}}')
  })

  it('数组解构：[a, b] 映射到 item[0]/item[1]', async () => {
    const vue = `
<template>
  <view v-for="[a, b] in items" :key="a">
    <text>{{ a }} - {{ b }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([[1, 2], [3, 4]])
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('{{item[0]}}')
    expect(wxml).toContain('{{item[1]}}')
  })

  it('嵌套对象解构：{ user: { name } } 映射到 item.user.name', async () => {
    const vue = `
<template>
  <view v-for="{ user: { name } } in items" :key="name">
    <text>{{ name }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ user: { name: 'a' } }])
</script>`
    const { wxml, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('{{item.user.name}}')
  })

  it('事件参数使用解构变量：onTap(id) → onTap(item.id)', async () => {
    const vue = `
<template>
  <view v-for="{ id } in items" :key="id">
    <button @tap="onTap(id)">tap</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1 }])
function onTap(id: number) { console.log(id) }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('data-a=')
    // id 通过 __vmsProxyRefs.items[index].id 访问
    expect(js).toContain('__vmsProxyRefs.items[')
    expect(js).toContain('.id')
    // 解构变量不应被收集为 internal 变量
    expect(js).not.toContain('__vmsInternalState')
  })

  it('computed 绑定使用解构变量：fmt(name)', async () => {
    const vue = `
<template>
  <view v-for="{ name } in items" :key="name" :title="fmt(name)" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ name: 'a' }])
function fmt(s: string) { return '[' + s + ']' }
</script>`
    const { wxml, js, error } = await compileVueContent(vue)
    expect(error).toBeNull()
    expect(wxml).toContain('title="{{__vmsComputed_0[')
    // name 在 map 回调里改写为 item.name
    expect(js).toContain('__vmsProxyRefs.fmt(item.name)')
  })
})
