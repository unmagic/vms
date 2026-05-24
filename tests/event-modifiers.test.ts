import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('事件修饰符测试', () => {
  describe('1. .stop 修饰符', () => {
    it('1.1 @tap.stop 生成 catchtap', async () => {
      const vueContent = `
<template>
  <view @tap.stop="onTap">内容</view>
</template>
<script setup lang="ts">
function onTap() {
  console.log('tapped')
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('catch:tap="onTap"')
    })

    it('1.2 @tap.stop 内联函数', async () => {
      const vueContent = `
<template>
  <view @tap.stop="() => { count++ }">增加</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('catch:tap="__fun_')
    })
  })

  describe('2. 普通 bind 事件', () => {
    it('2.1 @tap 生成 bindtap', async () => {
      const vueContent = `
<template>
  <view @tap="onClick">点击</view>
</template>
<script setup lang="ts">
function onClick() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:tap="onClick"')
    })

    it('2.2 @input 生成 bindinput', async () => {
      const vueContent = `
<template>
  <input @input="onInput" />
</template>
<script setup lang="ts">
function onInput() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:input="onInput"')
    })

    it('2.3 @change 生成 bindchange', async () => {
      const vueContent = `
<template>
  <switch @change="onChange" />
</template>
<script setup lang="ts">
function onChange() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:change="onChange"')
    })
  })

  describe('3. catch 事件前缀', () => {
    it('3.1 @tap.stop 与 @tap 共存于不同元素', async () => {
      const vueContent = `
<template>
  <view @tap="onOuter">
    <view @tap.stop="onInner">内部</view>
  </view>
</template>
<script setup lang="ts">
function onOuter() {}
function onInner() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 外层是 bind，内层是 catch
      expect(wxml).toContain('bind:tap="onOuter"')
      expect(wxml).toContain('catch:tap="onInner"')
    })
  })
})
