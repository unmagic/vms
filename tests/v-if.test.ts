import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('v-if / v-else-if / v-else 测试', () => {
  it('简单 v-if', async () => {
    const vueContent = `
<template>
  <view v-if="show">显示内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:if="{{show}}"')
  })

  it('v-if + v-else', async () => {
    const vueContent = `
<template>
  <view v-if="show">显示</view>
  <view v-else>隐藏</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:if="{{show}}"')
    expect(wxml).toContain('wx:else')
  })

  it('v-if + v-else-if + v-else', async () => {
    const vueContent = `
<template>
  <view v-if="status === 'a'">状态A</view>
  <view v-else-if="status === 'b'">状态B</view>
  <view v-else>其他状态</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const status = ref('a')
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:if')
    expect(wxml).toContain('wx:elif')
    expect(wxml).toContain('wx:else')
  })

  it('嵌套 v-if', async () => {
    const vueContent = `
<template>
  <view v-if="showOuter">
    <text v-if="showInner">内层内容</text>
    <text v-else>内层隐藏</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const showOuter = ref(true)
const showInner = ref(false)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:if="{{showOuter}}"')
    expect(wxml).toContain('wx:if="{{showInner}}"')
  })

  it('v-if 使用复杂表达式', async () => {
    const vueContent = `
<template>
  <view v-if="count > 0 && isActive">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(5)
const isActive = ref(true)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('wx:if')
    expect(wxml).toContain('count')
    expect(wxml).toContain('isActive')
  })

  it('template 上的 v-if', async () => {
    const vueContent = `
<template>
  <template v-if="show">
    <text>第一行</text>
    <text>第二行</text>
  </template>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('第一行')
    expect(wxml).toContain('第二行')
  })
})
