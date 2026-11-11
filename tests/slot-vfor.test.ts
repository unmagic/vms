import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 插槽 v-for 场景补充测试
 * 基础插槽行为由 slot.test.ts 覆盖，这里聚焦 v-for 与插槽的组合场景
 */

describe('插槽与 v-for 结合', () => {
  describe('默认/具名插槽在使用方的 v-for', () => {
    it('1.1 v-for 内传入默认插槽内容', async () => {
      const vueContent = `
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <MyCard>
      <text>{{ g.name }}</text>
    </MyCard>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyCard from './MyCard.vue'
const groups = ref([{ id: 1, name: 'a' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toMatch(/wx:for="\{\{groups\}\}"/)
      expect(wxml).toContain('<MyCard')
      expect(wxml).toContain('{{g.name}}')
    })

    it('1.2 v-for 内传入具名插槽内容', async () => {
      const vueContent = `
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <MyLayout>
      <template v-slot:header>
        <text>{{ g.title }}</text>
      </template>
    </MyLayout>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyLayout from './MyLayout.vue'
const groups = ref([{ id: 1, title: 't' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot="header"')
      expect(wxml).toContain('{{g.title}}')
    })

    it('1.3 插槽内容引用外层 v-for 变量与 setup 变量混合', async () => {
      const vueContent = `
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <MyCard>
      <text>{{ g.name }} / {{ prefix }}</text>
    </MyCard>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyCard from './MyCard.vue'
const groups = ref([{ id: 1, name: 'a' }])
const prefix = ref('P')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{g.name}}')
      expect(wxml).toContain('{{prefix}}')
    })
  })

  describe('作用域插槽在使用方的 v-for', () => {
    it('2.1 v-for 内使用作用域插槽，槽变量与外层 v-for 变量共存', async () => {
      const vueContent = `
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <MyList>
      <template #row="{ item, index }">
        <text>{{ g.name }}-{{ item.name }}-{{ index }}</text>
      </template>
    </MyList>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyList from './MyList.vue'
const groups = ref([{ id: 1, name: 'a' }])
</script>
`
      const { wxml, js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // glass-easel 动态 slot 接收属性
      expect(wxml).toContain('slot:item')
      expect(wxml).toContain('slot:index')
      // 外层 v-for 变量与槽变量同时出现在插值中
      expect(wxml).toContain('{{g.name}}')
      expect(wxml).toContain('{{item.name}}')
      expect(wxml).toContain('{{index}}')
      // 槽变量不进入父组件 data
      expect(js).not.toContain('item.name,')
    })

    it('2.2 作用域插槽别名 + v-for', async () => {
      const vueContent = `
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <MyList>
      <template #row="{ item: it }">
        <text>{{ g.id }}-{{ it }}</text>
      </template>
    </MyList>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyList from './MyList.vue'
const groups = ref([{ id: 1 }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('slot:item="it"')
      expect(wxml).toContain('{{it}}')
      expect(wxml).toContain('{{g.id}}')
    })
  })

  describe('作用域插槽在提供方的 v-for', () => {
    it('3.1 v-for 内 slot 出口传 item/index 数据', async () => {
      const vueContent = `
<template>
  <view v-for="(item, index) in items" :key="item.id">
    <slot name="row" :item="item" :index="index" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1, name: 'a' }])
</script>
`
      const { wxml, js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 作用域数据转为属性绑定
      expect(wxml).toContain('item="{{item}}"')
      expect(wxml).toContain('index="{{index}}"')
      // dynamicSlots 开启
      expect(js).toContain('dynamicSlots')
      expect(js).toContain('multipleSlots')
    })

    it('3.2 嵌套 v-for 内 slot 出口传内外层数据', async () => {
      const vueContent = `
<template>
  <view v-for="g in groups" :key="g.id">
    <view v-for="(item, idx) in g.children" :key="item.id">
      <slot name="cell" :item="item" :groupName="g.name" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ id: 1, name: 'g1', children: [{ id: 1 }] }])
</script>
`
      const { wxml, js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('item="{{item}}"')
      expect(wxml).toContain('groupName="{{g.name}}"')
      expect(js).toContain('dynamicSlots')
    })
  })
})

describe('默认作用域插槽与 v-for', () => {
  it('4.1 使用方：v-for 内默认作用域插槽（v-slot="{ item }"）', async () => {
    const vueContent = `
<template>
  <view v-for="(g, gi) in groups" :key="g.id">
    <MyList>
      <template v-slot="{ item }">
        <text>{{ g.name }}-{{ item }}</text>
      </template>
    </MyList>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyList from './MyList.vue'
const groups = ref([{ id: 1, name: 'a' }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('slot:item')
    expect(wxml).toContain('{{g.name}}')
    expect(wxml).toContain('{{item}}')
  })

  it('4.2 使用方：v-for 内默认作用域插槽带 index', async () => {
    const vueContent = `
<template>
  <MyList>
    <template v-slot="{ item, index }">
      <text v-for="(g, gi) in groups" :key="g.id">{{ g.name }}-{{ item }}-{{ index }}</text>
    </template>
  </MyList>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import MyList from './MyList.vue'
const groups = ref([{ id: 1, name: 'a' }])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('slot:item')
    expect(wxml).toContain('slot:index')
    expect(wxml).toMatch(/wx:for="\{\{groups\}\}"/)
    expect(wxml).toContain('{{g.name}}')
    expect(wxml).toContain('{{item}}')
    expect(wxml).toContain('{{index}}')
  })
})
