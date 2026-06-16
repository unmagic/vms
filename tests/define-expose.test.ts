import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('defineExpose 测试', () => {
  it('暴露方法', async () => {
    const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
function increment() {
  count.value++
}
defineExpose({ increment })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('export')
    expect(js).toContain('increment')
  })

  it('暴露响应式数据', async () => {
    const vueContent = `
<template>
  <view>{{ value }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const value = ref('初始值')
defineExpose({ value })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('export')
    expect(js).toContain('value')
  })

  it('暴露多个成员', async () => {
    const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const name = ref('test')
function doSomething() {}
function doOther() {}
defineExpose({ name, doSomething, doOther })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('export')
    expect(js).toContain('name')
    expect(js).toContain('doSomething')
    expect(js).toContain('doOther')
  })
})
