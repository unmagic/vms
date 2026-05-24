import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('defineContext 宏测试', () => {
  describe('1. 基础用法', () => {
    it('1.1 defineContext 声明', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
const ctx = defineContext()
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // defineContext 声明应被移除，ctx 变量名被内部使用
      expect(js).toContain('defineComponent')
    })

    it('1.2 defineContext 与 defineEmits 配合', async () => {
      const vueContent = `
<template>
  <button @tap="handleClick">提交</button>
</template>
<script setup lang="ts">
const ctx = defineContext()
const emit = defineEmits(['submit'])
function handleClick() {
  emit('submit')
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // emit 应使用 ctx 变量名触发 triggerEvent
      expect(js).toContain('triggerEvent')
    })

    it('1.3 defineContext 与 defineProps 配合', async () => {
      const vueContent = `
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const ctx = defineContext()
const { title } = defineProps<{ title: string }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{title}}')
      expect(js).toContain('title')
    })
  })

  describe('2. defineContext 三宏配合', () => {
    it('2.1 defineProps + defineEmits + defineContext', async () => {
      const vueContent = `
<template>
  <view @tap="handleTap">{{ label }}</view>
</template>
<script setup lang="ts">
const ctx = defineContext()
const { label } = defineProps<{ label: string }>()
const emit = defineEmits(['tap'])
function handleTap() {
  emit('tap', label)
}
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{label}}')
      expect(js).toContain('triggerEvent')
      expect(js).toContain('properties')
    })
  })
})
