import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('v-show 测试', () => {
  it('简单 v-show', async () => {
    const vueContent = `
<template>
  <view v-show="visible">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const visible = ref(true)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('hidden="{{!(visible)}}"')
  })

  it('v-show 使用复杂表达式', async () => {
    const vueContent = `
<template>
  <view v-show="count > 0">列表</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(3)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('hidden')
    expect(wxml).toContain('count')
  })

  it('v-show 与 v-if 不同（不销毁 DOM）', async () => {
    const vueContent = `
<template>
  <view v-show="isVisible">v-show</view>
  <view v-if="isVisible">v-if</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isVisible = ref(true)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('hidden=')
    expect(wxml).toContain('wx:if=')
  })
})
