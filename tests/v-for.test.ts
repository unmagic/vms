import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('v-for 测试', () => {
  it('基础 v-for', async () => {
    const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    {{ item.name }}
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: '项目1' }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{list}}"')
    expect(wxml).toContain('wx:key="id"')
  })

  it('v-for 自定义 item/index 名', async () => {
    const vueContent = `
<template>
  <view v-for="(row, rowIndex) in data" :key="row.id">
    {{ row.value }}
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const data = ref([{ id: 1, value: 'A' }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{data}}"')
    expect(wxml).toContain('wx:for-item="row"')
    expect(wxml).toContain('wx:for-index="rowIndex"')
  })

  it('v-for 使用默认 item/index 名', async () => {
    const vueContent = `
<template>
  <view v-for="item in list" :key="item.id">{{ item.name }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: 'A' }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{list}}"')
    expect(wxml).not.toContain('wx:for-item="item"')
  })

  it('v-for 使用对象', async () => {
    const vueContent = `
<template>
  <view v-for="(value, key) in obj" :key="key">
    {{ key }}: {{ value }}
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const obj = ref({ a: 1, b: 2 })
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{obj}}"')
  })

  it('v-for 使用数字范围', async () => {
    const vueContent = `
<template>
  <view v-for="n in 5" :key="n">{{ n }}</view>
</template>
<script setup lang="ts">
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for')
  })

  it('v-for 嵌套', async () => {
    const vueContent = `
<template>
  <view v-for="(group, gIndex) in groups" :key="gIndex">
    <text v-for="(item, iIndex) in group.items" :key="iIndex">{{ item }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ items: ['a', 'b'] }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for="{{groups}}"')
    expect(wxml).toContain('wx:for-item="group"')
    expect(wxml).not.toContain('wx:for-item="item"')
    expect(wxml).toContain('wx:for="{{group.items}}"')
  })

  it('v-for 上 :key 为 index', async () => {
    const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="index">{{ item }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref(['a', 'b', 'c'])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:key="index"')
  })

  it('v-for 内使用 v-if（不同层级）', async () => {
    const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <text v-if="item.active">{{ item.name }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: 'A', active: true }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for')
    expect(wxml).toContain('wx:if')
  })

  it('template 上的 v-for', async () => {
    const vueContent = `
<template>
  <template v-for="(item, index) in list" :key="item.id">
    <text>{{ item.name }}</text>
    <text>{{ item.desc }}</text>
  </template>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: 'A', desc: '描述A' }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:for')
  })
})
