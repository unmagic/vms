import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('WXS 模板表达式端到端测试', () => {
  describe('1. 可选链表达式（WXS 降级）', () => {
    it('1.1 简单可选链属性访问', async () => {
      const vueContent = `
<template>
  <view>{{ user?.name }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref({ name: '张三' })
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 可选链需要 WXS 降级
      expect(wxml).toContain('wms_wxs')
    })

    it('1.2 链式可选链', async () => {
      const vueContent = `
<template>
  <view>{{ data?.items?.[0] }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const data = ref({ items: [1, 2, 3] })
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wms_wxs')
    })
  })

  describe('2. 数组方法 polyfill', () => {
    it('2.1 模板中使用 .find()', async () => {
      const vueContent = `
<template>
  <view>{{ list.find(x => x.active)?.name }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: 'A', active: true }, { name: 'B', active: false }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wms_wxs')
      expect(wxml).toContain('__vmsWXSUtils')
    })

    it('2.2 模板中使用 .includes()', async () => {
      const vueContent = `
<template>
  <view>{{ list.includes(target) }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([1, 2, 3])
const target = ref(2)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wms_wxs')
    })

    it('2.3 模板中使用 .filter()', async () => {
      const vueContent = `
<template>
  <view>{{ items.filter(x => x.visible).length }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ visible: true }, { visible: false }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wms_wxs')
    })
  })

  describe('3. 字符串方法 polyfill', () => {
    it('3.1 模板中使用 .padStart()', async () => {
      const vueContent = `
<template>
  <view>{{ text.padStart(5, '0') }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const text = ref('12')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wms_wxs')
    })

    it('3.2 模板中使用 .replaceAll()', async () => {
      const vueContent = `
<template>
  <view>{{ text.replaceAll('a', 'b') }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const text = ref('banana')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wms_wxs')
    })
  })

  describe('4. typeof 运算符', () => {
    it('4.1 模板中使用 typeof', async () => {
      const vueContent = `
<template>
  <view>{{ typeof value }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const value = ref(42)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // typeof 需要生成 WXS 函数
      expect(wxml).toContain('wms_wxs')
    })
  })

  describe('5. 复杂表达式（WXS 函数）', () => {
    it('5.1 三元 + 方法调用组合', async () => {
      const vueContent = `
<template>
  <view>{{ items.length > 0 ? items[0].name : '空' }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ name: 'A' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('items')
    })

    it('5.2 逻辑表达式', async () => {
      const vueContent = `
<template>
  <view>{{ a && b || c }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref(true)
const b = ref(false)
const c = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('a')
      expect(wxml).toContain('b')
      expect(wxml).toContain('c')
    })
  })

  describe('6. WXS 函数正确引用变量', () => {
    it('6.1 WXS 函数参数传递', async () => {
      const vueContent = `
<template>
  <view>{{ user?.name }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref({ name: '张三' })
</script>
`
      const { wxml, js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // WXS 函数应接收 user 作为参数
      expect(wxml).toContain('wms_wxs.__wxs_')
      expect(wxml).toContain('user')
      // JS 中 user 应被收集到 returnValue
      expect(js).toContain('user')
    })
  })
})
