import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('插槽（Slot）测试', () => {
  describe('1. 默认插槽', () => {
    it('1.1 基础默认插槽接收（slot 出口）', async () => {
      // 子组件声明 slot 出口
      const vueContent = `
<template>
  <view class="wrapper">
    <slot></slot>
  </view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<slot')
      // 有 slot 时应开启 multipleSlots
      expect(js).toContain('multipleSlots')
    })

    it('1.2 带名字的默认插槽', async () => {
      const vueContent = `
<template>
  <view>
    <slot name="default"></slot>
  </view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('<slot')
    })

    it('1.3 不使用 slot 时不开启 multipleSlots', async () => {
      const vueContent = `
<template>
  <view>普通组件，无插槽</view>
</template>
<script setup lang="ts">
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 不含 slot 时不应开启 multipleSlots
      expect(js).not.toContain('multipleSlots')
    })
  })

  describe('2. 具名插槽（使用方）', () => {
    it('2.1 传入具名插槽内容（v-slot）', async () => {
      const vueContent = `
<template>
  <MyCard>
    <template v-slot:header>
      <text>标题</text>
    </template>
  </MyCard>
</template>
<script setup lang="ts">
import MyCard from './MyCard.vue'
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 具名插槽内容应加 slot 属性
      expect(wxml).toContain('slot="header"')
    })

    it('2.2 #slot 缩写语法', async () => {
      const vueContent = `
<template>
  <MyCard>
    <template #footer>
      <text>底部</text>
    </template>
  </MyCard>
</template>
<script setup lang="ts">
import MyCard from './MyCard.vue'
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot="footer"')
    })

    it('2.3 多个具名插槽', async () => {
      const vueContent = `
<template>
  <MyLayout>
    <template v-slot:header>
      <text>头部</text>
    </template>
    <template v-slot:main>
      <text>主内容</text>
    </template>
    <template v-slot:footer>
      <text>底部</text>
    </template>
  </MyLayout>
</template>
<script setup lang="ts">
import MyLayout from './MyLayout.vue'
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot="header"')
      expect(wxml).toContain('slot="main"')
      expect(wxml).toContain('slot="footer"')
    })

    it('2.4 default 插槽不添加 slot 属性', async () => {
      const vueContent = `
<template>
  <MyCard>
    <template v-slot:default>
      <text>默认内容</text>
    </template>
  </MyCard>
</template>
<script setup lang="ts">
import MyCard from './MyCard.vue'
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // default 插槽不应添加 slot="default" 属性
      expect(wxml).not.toContain('slot="default"')
    })
  })

  describe('3. 插槽接收方（slot 出口）', () => {
    it('3.1 具名 slot 出口', async () => {
      const vueContent = `
<template>
  <view class="card">
    <view class="card-header">
      <slot name="header"></slot>
    </view>
    <view class="card-body">
      <slot></slot>
    </view>
  </view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('name="header"')
      expect(wxml).toContain('card-header')
      expect(js).toContain('multipleSlots')
    })

    it('3.2 slot 出口自动开启 multipleSlots', async () => {
      const vueContent = `
<template>
  <view>
    <slot name="title"></slot>
    <slot name="content"></slot>
  </view>
</template>
<script setup lang="ts">
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('multipleSlots')
      expect(js).toContain('true')
    })
  })

  describe('4. 作用域插槽（不支持场景）', () => {
    it('4.1 作用域插槽应报编译错误', async () => {
      const vueContent = `
<template>
  <MyList>
    <template v-slot:item="{ item }">
      <text>{{ item.name }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import MyList from './MyList.vue'
</script>
`
      const { error } = await compileVueContent(vueContent)

      // 作用域插槽（有 exp 的 v-slot）应该报错
      expect(error).not.toBeNull()
      expect(error?.message).toContain('作用域插槽')
    })
  })

  describe('5. 混合使用场景', () => {
    it('5.1 插槽与 v-if 结合', async () => {
      const vueContent = `
<template>
  <MyCard>
    <template v-slot:header>
      <text v-if="showTitle">{{ title }}</text>
    </template>
  </MyCard>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyCard from './MyCard.vue'
const showTitle = ref(true)
const title = ref('测试标题')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot="header"')
      expect(wxml).toContain('wx:if="{{showTitle}}"')
    })

    it('5.2 插槽内容包含事件处理', async () => {
      const vueContent = `
<template>
  <MyModal>
    <template v-slot:footer>
      <button @tap="handleClose">关闭</button>
    </template>
  </MyModal>
</template>
<script setup lang="ts">
import MyModal from './MyModal.vue'
function handleClose() {
  console.log('close')
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot="footer"')
      expect(wxml).toContain('bind:tap="handleClose"')
    })

    it('5.3 插槽与 v-for 结合', async () => {
      const vueContent = `
<template>
  <MyContainer>
    <template v-slot:list>
      <view v-for="(item, index) in items" :key="item.id">
        {{ item.name }}
      </view>
    </template>
  </MyContainer>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyContainer from './MyContainer.vue'
const items = ref([{ id: 1, name: '项目1' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot="list"')
      expect(wxml).toContain('wx:for="{{items}}"')
    })
  })
})
