import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('defineProps 测试', () => {
  describe('1. 类型声明式 defineProps', () => {
    it('1.1 基础类型声明', async () => {
      const vueContent = `
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const { title } = defineProps<{ title: string }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{title}}')
      // title 作为 prop 应在 properties 中
      expect(js).toContain('properties')
      expect(js).toContain('title')
    })

    it('1.2 多个 props 类型声明', async () => {
      const vueContent = `
<template>
  <view>{{ title }} - {{ count }}</view>
</template>
<script setup lang="ts">
const { title, count } = defineProps<{ title: string; count: number }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{title}}')
      expect(wxml).toContain('{{count}}')
      expect(js).toContain('title')
      expect(js).toContain('count')
    })

    it('1.3 可选 props', async () => {
      const vueContent = `
<template>
  <view>{{ label }}</view>
</template>
<script setup lang="ts">
const { label } = defineProps<{ label?: string }>()
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('label')
    })
  })

  describe('2. 带默认值的解构 defineProps', () => {
    it('2.1 字符串默认值', async () => {
      const vueContent = `
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const { title = '默认标题' } = defineProps<{ title?: string }>()
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('title')
      // 带默认值的 prop 应在 properties 中有 value 字段
      expect(js).toContain('value')
      expect(js).toContain('默认标题')
    })

    it('2.2 数值默认值', async () => {
      const vueContent = `
<template>
  <view>{{ count }}</view>
</template>
<script setup lang="ts">
const { count = 0 } = defineProps<{ count?: number }>()
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('count')
      expect(js).toContain('0')
    })

    it('2.3 布尔默认值', async () => {
      const vueContent = `
<template>
  <view v-if="visible">内容</view>
</template>
<script setup lang="ts">
const { visible = true } = defineProps<{ visible?: boolean }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if')
      expect(js).toContain('visible')
      expect(js).toContain('true')
    })
  })

  describe('3. prop 别名（解构重命名）', () => {
    it('3.1 别名解构', async () => {
      const vueContent = `
<template>
  <view>{{ myLabel }}</view>
</template>
<script setup lang="ts">
const { label: myLabel } = defineProps<{ label: string }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // wxml 使用别名 myLabel
      expect(wxml).toContain('{{myLabel}}')
      // properties 使用原始名 label
      expect(js).toContain('label')
    })

    it('3.2 带默认值的别名解构', async () => {
      const vueContent = `
<template>
  <view>{{ myTitle }}</view>
</template>
<script setup lang="ts">
const { title: myTitle = '默认' } = defineProps<{ title?: string }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{myTitle}}')
      expect(js).toContain('title')
      expect(js).toContain('默认')
    })
  })

  describe('4. rest 操作符', () => {
    it('4.1 rest 解构', async () => {
      const vueContent = `
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const { title, ...restProps } = defineProps<{ title: string; size?: string }>()
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('title')
    })
  })

  describe('5. props 在模板中的各种用法', () => {
    it('5.1 props 用于 v-if', async () => {
      const vueContent = `
<template>
  <view v-if="show">显示内容</view>
</template>
<script setup lang="ts">
const { show } = defineProps<{ show: boolean }>()
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if="{{show}}"')
    })

    it('5.2 props 用于 v-for', async () => {
      const vueContent = `
<template>
  <view v-for="(item, index) in items" :key="item.id">{{ item.name }}</view>
</template>
<script setup lang="ts">
const { items } = defineProps<{ items: Array<{ id: number; name: string }> }>()
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{items}}"')
    })

    it('5.3 props 用于动态绑定', async () => {
      const vueContent = `
<template>
  <view :class="className">内容</view>
</template>
<script setup lang="ts">
const { className } = defineProps<{ className: string }>()
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('className')
    })

    it('5.4 props 用于事件处理器', async () => {
      const vueContent = `
<template>
  <view @tap="() => { onTap(title) }">{{ title }}</view>
</template>
<script setup lang="ts">
const { title } = defineProps<{ title: string }>()
function onTap(t: string) {
  console.log(t)
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // props 变量在事件处理器中应通过 __vmsProps 访问
      expect(js).toContain('__vmsProps.title')
    })

    it('5.5 未解构的 props 通过变量名访问', async () => {
      const vueContent = `
<template>
  <view>{{ myProps.title }}</view>
</template>
<script setup lang="ts">
const myProps = defineProps<{ title: string }>()
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // myProps 对应 __vmsProps，模板访问 myProps.title
      expect(wxml).toContain('title')
    })
  })

  describe('6. style prop 特殊处理', () => {
    it('6.1 默认包含 style prop', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
// 非页面组件默认包含 style prop
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 非页面组件默认应该包含 style prop
      expect(js).toContain('style')
    })

    it('6.2 覆盖 style prop', async () => {
      const vueContent = `
<template>
  <view :style="customStyle">内容</view>
</template>
<script setup lang="ts">
const { style: customStyle } = defineProps<{ style: string }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('customStyle')
      expect(js).toContain('style')
    })
  })
})
