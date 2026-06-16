import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('computed / reactive / watch 测试', () => {
  describe('computed', () => {
    it('基础 computed', async () => {
      const vueContent = `
<template>
  <view>{{ double }}</view>
</template>
<script setup lang="ts">
import { ref, computed } from '@unmagic/vue-mini'
const count = ref(5)
const double = computed(() => count.value * 2)
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('{{double}}')
      expect(js).toContain('computed')
    })

    it('computed 依赖多个 ref', async () => {
      const vueContent = `
<template>
  <view>{{ fullName }}</view>
</template>
<script setup lang="ts">
import { ref, computed } from '@unmagic/vue-mini'
const firstName = ref('张')
const lastName = ref('三')
const fullName = computed(() => firstName.value + lastName.value)
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('{{fullName}}')
      expect(js).toContain('computed')
      expect(js).toContain('firstName')
      expect(js).toContain('lastName')
    })

    it('computed 在模板中直接使用', async () => {
      const vueContent = `
<template>
  <view v-if="isAdmin">管理员内容</view>
  <view>{{ displayName }}</view>
</template>
<script setup lang="ts">
import { ref, computed } from '@unmagic/vue-mini'
const role = ref('admin')
const name = ref('张三')
const isAdmin = computed(() => role.value === 'admin')
const displayName = computed(() => name.value + '（' + role.value + '）')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('wx:if="{{isAdmin}}"')
      expect(wxml).toContain('{{displayName}}')
    })
  })

  describe('reactive', () => {
    it('基础 reactive', async () => {
      const vueContent = `
<template>
  <view>{{ state.name }}</view>
</template>
<script setup lang="ts">
import { reactive } from '@unmagic/vue-mini'
const state = reactive({ name: '张三', age: 20 })
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('state.name')
    })

    it('reactive 与 ref 混用', async () => {
      const vueContent = `
<template>
  <view>{{ user.name }} - {{ count }}</view>
</template>
<script setup lang="ts">
import { ref, reactive } from '@unmagic/vue-mini'
const count = ref(0)
const user = reactive({ name: '张三' })
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('user.name')
      expect(wxml).toContain('count')
    })
  })

  describe('watch', () => {
    it('watch 单个 ref', async () => {
      const vueContent = `
<template>
  <view>{{ count }}</view>
</template>
<script setup lang="ts">
import { ref, watch } from '@unmagic/vue-mini'
const count = ref(0)
watch(count, (newVal) => {
  console.log('count changed:', newVal)
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('watch')
      expect(js).toContain('count')
    })

    it('watchEffect', async () => {
      const vueContent = `
<template>
  <view>{{ result }}</view>
</template>
<script setup lang="ts">
import { ref, watchEffect } from '@unmagic/vue-mini'
const count = ref(0)
const result = ref('')
watchEffect(() => {
  result.value = 'count is ' + count.value
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('watchEffect')
    })
  })
})
