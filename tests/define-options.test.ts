import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('defineOptions 测试', () => {
  it('virtualHost 配置', async () => {
    const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({ virtualHost: false })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('virtualHost')
    expect(js).toContain('false')
  })

  it('styleIsolation 配置（写入 JSON）', async () => {
    const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({ styleIsolation: 'shared' })
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
  })

  it('空 defineOptions 不报错', async () => {
    const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({})
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
  })
})
