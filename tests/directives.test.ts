import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('模板指令测试', () => {
  describe('1. v-if / v-else-if / v-else', () => {
    it('1.1 简单 v-if', async () => {
      const vueContent = `
<template>
  <view v-if="show">显示内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if="{{show}}"')
    })

    it('1.2 v-if + v-else', async () => {
      const vueContent = `
<template>
  <view v-if="show">显示</view>
  <view v-else>隐藏</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if="{{show}}"')
      expect(wxml).toContain('wx:else')
    })

    it('1.3 v-if + v-else-if + v-else', async () => {
      const vueContent = `
<template>
  <view v-if="status === 'a'">状态A</view>
  <view v-else-if="status === 'b'">状态B</view>
  <view v-else>其他状态</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const status = ref('a')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if')
      expect(wxml).toContain('wx:elif')
      expect(wxml).toContain('wx:else')
    })

    it('1.4 嵌套 v-if', async () => {
      const vueContent = `
<template>
  <view v-if="showOuter">
    <text v-if="showInner">内层内容</text>
    <text v-else>内层隐藏</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const showOuter = ref(true)
const showInner = ref(false)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if="{{showOuter}}"')
      expect(wxml).toContain('wx:if="{{showInner}}"')
    })

    it('1.5 v-if 使用复杂表达式', async () => {
      const vueContent = `
<template>
  <view v-if="count > 0 && isActive">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(5)
const isActive = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:if')
      expect(wxml).toContain('count')
      expect(wxml).toContain('isActive')
    })
  })

  describe('2. v-show', () => {
    it('2.1 简单 v-show', async () => {
      const vueContent = `
<template>
  <view v-show="visible">内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const visible = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // v-show 转换为 hidden 属性
      expect(wxml).toContain('hidden="{{!(visible)}}"')
    })

    it('2.2 v-show 使用复杂表达式', async () => {
      const vueContent = `
<template>
  <view v-show="count > 0">列表</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(3)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('hidden')
      expect(wxml).toContain('count')
    })

    it('2.3 v-show 与 v-if 不同（不销毁 DOM）', async () => {
      const vueContent = `
<template>
  <view v-show="isVisible">v-show</view>
  <view v-if="isVisible">v-if</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isVisible = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('hidden=')
      expect(wxml).toContain('wx:if=')
    })
  })

  describe('3. v-for', () => {
    it('3.1 基础 v-for', async () => {
      const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    {{ item.name }}
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: '项目1' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{list}}"')
      expect(wxml).toContain('wx:key="id"')
    })

    it('3.2 v-for 自定义 item/index 名', async () => {
      const vueContent = `
<template>
  <view v-for="(row, rowIndex) in data" :key="row.id">
    {{ row.value }}
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const data = ref([{ id: 1, value: 'A' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{data}}"')
      expect(wxml).toContain('wx:for-item="row"')
      expect(wxml).toContain('wx:for-index="rowIndex"')
    })

    it('3.3 v-for 使用默认 item/index 名', async () => {
      const vueContent = `
<template>
  <view v-for="item in list" :key="item.id">{{ item.name }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: 'A' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{list}}"')
      // 默认 item/index 名不需要显式声明
      expect(wxml).not.toContain('wx:for-item="item"')
    })

    it('3.4 v-for 使用对象', async () => {
      const vueContent = `
<template>
  <view v-for="(value, key) in obj" :key="key">
    {{ key }}: {{ value }}
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const obj = ref({ a: 1, b: 2 })
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{obj}}"')
    })

    it('3.5 v-for 使用数字范围', async () => {
      const vueContent = `
<template>
  <view v-for="n in 5" :key="n">{{ n }}</view>
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for')
    })

    it('3.6 v-for 嵌套', async () => {
      const vueContent = `
<template>
  <view v-for="(group, gIndex) in groups" :key="gIndex">
    <text v-for="(item, iIndex) in group.items" :key="iIndex">{{ item }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ items: ['a', 'b'] }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for="{{groups}}"')
      expect(wxml).toContain('wx:for-item="group"')
      // 内层默认 item 名不会显式生成 wx:for-item
      expect(wxml).not.toContain('wx:for-item="item"')
      // 但内层 v-for 存在
      expect(wxml).toContain('wx:for="{{group.items}}"')
    })

    it('3.7 v-for 上 :key 为 index', async () => {
      const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="index">{{ item }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref(['a', 'b', 'c'])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:key="index"')
    })
  })

  describe('4. v-for 与 v-if 组合', () => {
    it('4.1 v-for 内使用 v-if（不同层级）', async () => {
      const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <text v-if="item.active">{{ item.name }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: 'A', active: true }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for')
      expect(wxml).toContain('wx:if')
    })
  })

  describe('5. v-for 与 template 结合', () => {
    it('5.1 template 上的 v-for', async () => {
      const vueContent = `
<template>
  <template v-for="(item, index) in list" :key="item.id">
    <text>{{ item.name }}</text>
    <text>{{ item.desc }}</text>
  </template>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: 'A', desc: '描述A' }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('wx:for')
    })

    it('5.2 template 上的 v-if', async () => {
      const vueContent = `
<template>
  <template v-if="show">
    <text>第一行</text>
    <text>第二行</text>
  </template>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const show = ref(true)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // template 上的 v-if 通过 block 实现
      expect(wxml).toContain('第一行')
      expect(wxml).toContain('第二行')
    })
  })

  describe('6. 动态属性绑定', () => {
    it('6.1 :src 动态绑定', async () => {
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

    it('6.2 多个动态属性', async () => {
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

    it('6.3 动态属性与静态属性混用', async () => {
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

  describe('7. 文本插值', () => {
    it('7.1 简单变量插值', async () => {
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

    it('7.2 表达式插值', async () => {
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

    it('7.3 模板中调用函数（需用 computed 包裱）', async () => {
      // 直接在模板中调用 script 内定义的函数并传入参数属于不支持的写法（外部函数有参数调用）
      // 应使用 computed 包裱结果，而不是直接在模板调用
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

    it('7.4 链式访问', async () => {
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
