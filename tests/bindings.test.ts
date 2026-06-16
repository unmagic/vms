import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('动态属性绑定与文本插值测试', () => {
  describe('动态属性绑定', () => {
    it(':src 动态绑定', async () => {
      const vueContent = `
<template>
  <image :src="imageUrl" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const imageUrl = ref('/static/logo.png')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('src="{{imageUrl}}"')
    })

    it('多个动态属性', async () => {
      const vueContent = `
<template>
  <input :value="inputVal" :placeholder="hint" :disabled="isDisabled" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const inputVal = ref('')
const hint = ref('请输入')
const isDisabled = ref(false)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('value="{{inputVal}}"')
      expect(wxml).toContain('placeholder="{{hint}}"')
      expect(wxml).toContain('disabled="{{isDisabled}}"')
    })

    it('动态属性与静态属性混用', async () => {
      const vueContent = `
<template>
  <input type="text" :value="inputVal" placeholder="请输入" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const inputVal = ref('')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('type="text"')
      expect(wxml).toContain('value="{{inputVal}}"')
      expect(wxml).toContain('placeholder="请输入"')
    })
  })

  describe('文本插值', () => {
    it('简单变量插值', async () => {
      const vueContent = `
<template>
  <text>{{ message }}</text>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const message = ref('Hello')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('{{message}}')
    })

    it('表达式插值', async () => {
      const vueContent = `
<template>
  <text>{{ count * 2 }}</text>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(5)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('count')
    })

    it('computed 包裱结果', async () => {
      const vueContent = `
<template>
  <text>{{ formattedName }}</text>
</template>
<script setup lang="ts">
import { ref, computed } from '@unmagic/vue-mini'
const name = ref('张三')
const formattedName = computed(() => '用户：' + name.value)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('{{formattedName}}')
    })

    it('链式访问', async () => {
      const vueContent = `
<template>
  <text>{{ user.profile.name }}</text>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref({ profile: { name: '张三' } })
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('user.profile.name')
    })
  })
})
