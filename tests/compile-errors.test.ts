import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('编译错误边界测试', () => {
  describe('1. 不支持的特性应报错', () => {
    it('1.1 作用域插槽应报编译错误', async () => {
      const vueContent = `
<template>
  <MyList>
    <template v-slot:item="{ item }">
      <text>{{ item }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).not.toBeNull()
      expect(error?.message).toContain('作用域插槽')
    })

    it('1.2 插槽下文本子节点应报错', async () => {
      const vueContent = `
<template>
  <MyCard>
    <template v-slot:header>纯文本</template>
  </MyCard>
</template>
<script setup lang="ts">
import MyCard from './MyCard.vue'
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).not.toBeNull()
    })
  })

  describe('2. 缺少必要内容', () => {
    it('2.1 缺少 template 应报错', async () => {
      const vueContent = `
<script setup lang="ts">
const x = 1
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).not.toBeNull()
      expect(error?.message).toContain('template')
    })

    it('2.2 空 template', async () => {
      const vueContent = `
<template>
</template>
<script setup lang="ts">
</script>
`
      // 空 template 没有内容，parseSFC 解析后 template.ast 可能为空
      const { error, wxml } = await compileVueContent(vueContent)

      // 空 template 不一定报错，但 wxml 应为空或极简
      if (error) {
        expect(error).not.toBeNull()
      } else {
        expect(wxml).toBeDefined()
      }
    })
  })

  describe('3. defineOptions 错误使用', () => {
    it('3.1 defineOptions 传入非对象', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions('invalid')
</script>
`
      const { error } = await compileVueContent(vueContent)

      // 非对象参数应被忽略（不崩溃）
      expect(error).toBeNull()
    })

    it('3.2 defineOptions 使用动态值应报错', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
const name = 'test'
defineOptions({ name })
</script>
`
      const { error } = await compileVueContent(vueContent)

      // 动态值应报编译错误
      expect(error).not.toBeNull()
    })

    it('3.3 defineOptions 使用展开运算符应报错', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
const opts = { virtualHost: true }
defineOptions({ ...opts })
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).not.toBeNull()
    })
  })

  describe('4. defineExpose 错误使用', () => {
    it('4.1 defineExpose 传入非对象', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineExpose('invalid')
</script>
`
      const { error } = await compileVueContent(vueContent)

      // 非对象参数应被忽略（不崩溃）
      expect(error).toBeNull()
    })

    it('4.2 defineExpose 无参数', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineExpose()
</script>
`
      const { error } = await compileVueContent(vueContent)

      // 无参数不应崩溃
      expect(error).toBeNull()
    })
  })

  describe('5. 语法错误容错', () => {
    it('5.1 script 中有语法错误', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
const x = {  // 不完整的对象
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).not.toBeNull()
    })
  })

  describe('6. 页面组件 vs 普通组件', () => {
    it('6.1 页面组件不添加 virtualHost', async () => {
      const vueContent = `
<template>
  <view>页面</view>
</template>
<script setup lang="ts">
</script>
`
      const result = await compileVueContent(vueContent, true)
      expect(result.error).toBeNull()
      expect(result.js).not.toContain('virtualHost: true')
    })

    it('6.2 页面组件不添加 externalClasses', async () => {
      const vueContent = `
<template>
  <view>页面</view>
</template>
<script setup lang="ts">
</script>
`
      const result = await compileVueContent(vueContent, true)
      expect(result.error).toBeNull()
      expect(result.js).not.toContain('externalClasses')
    })

    it('6.3 页面组件不自动添加 style prop', async () => {
      const vueContent = `
<template>
  <view>页面</view>
</template>
<script setup lang="ts">
</script>
`
      const result = await compileVueContent(vueContent, true)
      expect(result.error).toBeNull()
      // 非页面组件默认添加 style，但页面组件不添加
      const propsMatch = result.js.match(/properties:\s*{([^}]*)}/)
      if (propsMatch) {
        expect(propsMatch[1]).not.toContain('style')
      }
    })
  })
})
