import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('组件导入与注册测试', () => {
  describe('1. Vue 组件导入', () => {
    it('1.1 导入单个 .vue 组件', async () => {
      const vueContent = `
<template>
  <MyButton>点击</MyButton>
</template>
<script setup lang="ts">
import MyButton from './MyButton.vue'
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json).not.toBeNull()
      expect(result.json!.usingComponents).toHaveProperty('MyButton')
      expect(result.json!.usingComponents.MyButton).toBe('./MyButton')
    })

    it('1.2 导入多个 .vue 组件', async () => {
      const vueContent = `
<template>
  <Header />
  <Footer />
</template>
<script setup lang="ts">
import Header from '@/components/Header.vue'
import Footer from '@/components/Footer.vue'
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json!.usingComponents).toHaveProperty('Header')
      expect(result.json!.usingComponents).toHaveProperty('Footer')
      expect(result.json!.usingComponents.Header).toBe('/components/Header')
      expect(result.json!.usingComponents.Footer).toBe('/components/Footer')
    })

    it('1.3 @/ 路径别名解析', async () => {
      const vueContent = `
<template>
  <MyCard />
</template>
<script setup lang="ts">
import MyCard from '@/components/MyCard.vue'
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      // @/ 应被替换为 /
      expect(result.json!.usingComponents.MyCard).toBe('/components/MyCard')
    })

    it('1.4 相对路径导入', async () => {
      const vueContent = `
<template>
  <ChildComponent />
</template>
<script setup lang="ts">
import ChildComponent from './ChildComponent.vue'
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json!.usingComponents.ChildComponent).toBe('./ChildComponent')
    })
  })

  describe('2. 非 .vue 导入不应注册为组件', () => {
    it('2.1 导入工具函数不注册到 usingComponents', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
import { formatPrice } from '@/utils/price'
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json!.usingComponents).not.toHaveProperty('formatPrice')
    })

    it('2.2 从 @unmagic/vue-mini 导入不注册组件', async () => {
      const vueContent = `
<template>
  <view>{{ count }}</view>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from '@unmagic/vue-mini'
const count = ref(0)
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      // @unmagic/vue-mini 的导入不应注册到 usingComponents
      const uc = result.json!.usingComponents as Record<string, string>
      expect(Object.keys(uc).length).toBe(0)
    })
  })

  describe('3. JSON 配置生成', () => {
    it('3.1 默认生成 component: true', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json!.component).toBe(true)
    })

    it('3.2 非页面组件 styleIsolation 为 apply-shared', async () => {
      const vueContent = `
<template>
  <view>组件</view>
</template>
<script setup lang="ts">
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json!.styleIsolation).toBe('apply-shared')
    })

    it('3.3 页面组件 styleIsolation 为 shared', async () => {
      const vueContent = `
<template>
  <view>页面</view>
</template>
<script setup lang="ts">
</script>
`
      const result = await compileVueContent(vueContent, true)
      expect(result.error).toBeNull()
      expect(result.json!.styleIsolation).toBe('shared')
    })

    it('3.4 defineOptions 合并到 JSON', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({ styleIsolation: 'isolated' })
</script>
`
      const result = await compileVueContent(vueContent)
      expect(result.error).toBeNull()
      expect(result.json!.styleIsolation).toBe('isolated')
    })
  })
})
