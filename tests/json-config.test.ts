import { describe, it, expect } from 'vitest'
import { createBaseJsonConfig } from '../src/utils/jsonConfig'
import { compileVueContent } from './test-utils'

describe('组件 JSON 配置生成', () => {
  describe('createBaseJsonConfig', () => {
    it('1.1 默认不写入 glass-easel 配置', () => {
      const config = createBaseJsonConfig(false, {}, false)

      expect(config).toEqual({
        component: true,
        styleIsolation: 'apply-shared',
        usingComponents: {},
      })
      expect(config).not.toHaveProperty('componentFramework')
      expect(config).not.toHaveProperty('glassEaselWebview')
    })

    it('1.2 glassEasel: true 写入 componentFramework 与 glassEaselWebview', () => {
      const config = createBaseJsonConfig(false, {}, true)

      expect(config.componentFramework).toBe('glass-easel')
      expect(config.glassEaselWebview).toBe(true)
    })

    it('1.3 页面组件使用 shared 样式隔离，普通组件使用 apply-shared', () => {
      expect(createBaseJsonConfig(true, {}, false).styleIsolation).toBe('shared')
      expect(createBaseJsonConfig(false, {}, false).styleIsolation).toBe('apply-shared')
    })

    it('1.4 usingComponents 原样透传', () => {
      const usingComponents = { MyComp: '/components/MyComp/MyComp' }
      expect(createBaseJsonConfig(false, usingComponents, false).usingComponents).toEqual(
        usingComponents,
      )
    })
  })

  describe('编译产物中的 JSON 配置', () => {
    const scopedSlotSfc = `
<template>
  <view v-for="(item, index) in items" :key="item.id">
    <slot name="row" :item="item" :index="index" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1 }])
</script>
`

    it('2.1 默认关闭 glassEasel 时 JSON 中不出现 glass-easel 字段', async () => {
      const { json, error } = await compileVueContent(scopedSlotSfc)

      expect(error).toBeNull()
      expect(json).not.toHaveProperty('componentFramework')
      expect(json?.component).toBe(true)
    })

    it('2.2 开启 glassEasel 后 JSON 写入 glass-easel 字段', async () => {
      const { json, error } = await compileVueContent(scopedSlotSfc, false, {
        glassEasel: true,
      })

      expect(error).toBeNull()
      expect(json?.componentFramework).toBe('glass-easel')
      expect(json?.glassEaselWebview).toBe(true)
    })

    it('2.3 glassEasel 配置与 defineOptions 合并时互不覆盖', async () => {
      const vueContent = `
<template>
  <view>hi</view>
</template>
<script setup lang="ts">
defineOptions({ styleIsolation: 'isolated' })
</script>
`
      const { json, error } = await compileVueContent(vueContent, false, { glassEasel: true })

      expect(error).toBeNull()
      // defineOptions 覆盖默认 styleIsolation，同时保留 glass-easel 配置
      expect(json?.styleIsolation).toBe('isolated')
      expect(json?.componentFramework).toBe('glass-easel')
      expect(json?.glassEaselWebview).toBe(true)
    })
  })
})
