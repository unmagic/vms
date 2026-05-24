import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('class / style 绑定测试', () => {
  describe('1. 静态 class', () => {
    it('1.1 单个静态 class', async () => {
      const vueContent = `
<template>
  <view class="container">内容</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('class="container')
    })

    it('1.2 多个静态 class', async () => {
      const vueContent = `
<template>
  <view class="box active primary">内容</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('box')
      expect(wxml).toContain('active')
      expect(wxml).toContain('primary')
    })
  })

  describe('2. 动态 :class 绑定', () => {
    it('2.1 对象语法（条件 class）', async () => {
      const vueContent = `
<template>
  <view :class="{ active: isActive, disabled: isDisabled }">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isActive = ref(true)
const isDisabled = ref(false)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 复杂表达式应走 WXS 路径，生成 wxs 脚本
      expect(wxml).toContain('wms_wxs')
      expect(wxml).toContain('isActive')
      expect(wxml).toContain('isDisabled')
    })

    it('2.2 数组语法', async () => {
      const vueContent = `
<template>
  <view :class="[baseClass, activeClass]">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const baseClass = ref('btn')
const activeClass = ref('btn-active')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('baseClass')
      expect(wxml).toContain('activeClass')
    })

    it('2.3 条件表达式', async () => {
      const vueContent = `
<template>
  <view :class="isActive ? 'active' : 'inactive'">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isActive = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('isActive')
    })

    it('2.4 简单变量（不使用 WXS）', async () => {
      const vueContent = `
<template>
  <view :class="className">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const className = ref('active')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{className}}')
    })

    it('2.5 静态 class 与 :class 共存', async () => {
      const vueContent = `
<template>
  <view class="base" :class="{ active: isActive }">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isActive = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 静态 class 和动态 class 都应该出现
      expect(wxml).toContain('base')
      expect(wxml).toContain('isActive')
    })

    it('2.6 数组+对象混合语法', async () => {
      const vueContent = `
<template>
  <view :class="['base', { active: isActive }]">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isActive = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('base')
      expect(wxml).toContain('isActive')
    })

    it('2.7 模板字符串动态 class', async () => {
      const vueContent = `
<template>
  <view :class="\`btn-\${type}\`">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const type = ref('primary')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('type')
    })
  })

  describe('3. 非页面组件根节点自动继承 class', () => {
    it('3.1 单根节点组件自动添加 class 继承', async () => {
      const vueContent = `
<template>
  <view>单根节点组件</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 非页面组件的单根节点应自动添加 class 属性用于继承父组件 class
      expect(wxml).toContain('class')
    })

    it('3.2 根节点已有 class 时合并', async () => {
      const vueContent = `
<template>
  <view class="my-component">组件内容</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('my-component')
      // 同时包含父组件传入的 class
      expect(wxml).toContain('class')
    })
  })

  describe('4. :style 动态样式', () => {
    it('4.1 对象语法 style', async () => {
      const vueContent = `
<template>
  <view :style="{ color: textColor, fontSize: fontSize + 'px' }">文字</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const textColor = ref('#333')
const fontSize = ref(14)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('textColor')
      expect(wxml).toContain('fontSize')
    })

    it('4.2 简单变量 style', async () => {
      const vueContent = `
<template>
  <view :style="inlineStyle">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const inlineStyle = ref('color: red;')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{inlineStyle}}')
    })

    it('4.3 静态 style 与动态 :style 共存', async () => {
      const vueContent = `
<template>
  <view style="padding: 10px;" :style="{ color: textColor }">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const textColor = ref('blue')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('textColor')
    })
  })

  describe('5. externalClasses 配置', () => {
    it('5.1 非页面组件自动生成 externalClasses', async () => {
      const vueContent = `
<template>
  <view>组件</view>
</template>
<script setup lang="ts">
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('externalClasses')
      expect(js).toContain('"class"')
    })

    it('5.2 有 class prop 时不自动添加 externalClasses', async () => {
      const vueContent = `
<template>
  <view :class="myClass">组件</view>
</template>
<script setup lang="ts">
const { class: myClass } = defineProps<{ class: string }>()
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 当用户自定义了 class prop，不应再添加 externalClasses
      expect(js).not.toContain('externalClasses')
    })
  })
})
