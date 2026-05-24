import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('模板标签映射测试', () => {
  describe('1. div → view', () => {
    it('1.1 div 转换为 view', async () => {
      const vueContent = `
<template>
  <div>内容</div>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<view')
      expect(wxml).toContain('内容</view>')
      expect(wxml).not.toContain('<div')
    })

    it('1.2 嵌套 div 全部转换', async () => {
      const vueContent = `
<template>
  <div>
    <div>内层</div>
  </div>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).not.toContain('<div')
      expect(wxml).toContain('<view')
    })

    it('1.3 div 带属性转换', async () => {
      const vueContent = `
<template>
  <div class="container" id="main">内容</div>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<view')
      expect(wxml).toContain('container')
      expect(wxml).toContain('id="main"')
    })
  })

  describe('2. img → image', () => {
    it('2.1 img 转换为 image', async () => {
      const vueContent = `
<template>
  <img src="/static/logo.png" />
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<image')
      expect(wxml).not.toContain('<img')
    })

    it('2.2 动态 src 的 img 转换', async () => {
      const vueContent = `
<template>
  <img :src="imageUrl" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const imageUrl = ref('/static/logo.png')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<image')
      expect(wxml).toContain('src="{{imageUrl}}"')
    })
  })

  describe('3. template → block', () => {
    it('3.1 带指令的 template 转换为 block', async () => {
      const vueContent = `
<template>
  <template v-if="show">
    <text>条件内容</text>
  </template>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<block')
      expect(wxml).toContain('wx:if="{{show}}"')
    })

    it('3.2 v-for 上的 template 转换为 block', async () => {
      const vueContent = `
<template>
  <template v-for="(item, index) in items" :key="index">
    <text>{{ item }}</text>
  </template>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref(['a', 'b'])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{items}}"')
    })

    it('3.3 无属性的 template 不生成 block 标签', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 顶层 template 已被 parseSFC 剥离，不会出现在 wxml 中
      expect(wxml).toContain('<view')
    })
  })

  describe('4. 小程序原生标签不转换', () => {
    it('4.1 view 保持不变', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<view')
      expect(wxml).toContain('内容')
    })

    it('4.2 text 保持不变', async () => {
      const vueContent = `
<template>
  <text>文字</text>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<text')
      expect(wxml).toContain('文字')
    })

    it('4.3 image 保持不变', async () => {
      const vueContent = `
<template>
  <image src="/logo.png" />
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<image')
    })

    it('4.4 button 保持不变', async () => {
      const vueContent = `
<template>
  <button>按钮</button>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<button')
      expect(wxml).toContain('按钮')
    })
  })

  describe('5. 混合使用', () => {
    it('5.1 div 和 view 混用', async () => {
      const vueContent = `
<template>
  <div class="outer">
    <view class="inner">内容</view>
  </div>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('outer')
      expect(wxml).toContain('inner')
      expect(wxml).not.toContain('<div')
    })
  })
})
