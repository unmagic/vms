import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('真实场景模式测试（基于 example 项目）', () => {
  describe('1. 第三方组件（TDesign）集成', () => {
    it('1.1 TDesign 按钮组件', async () => {
      const vueContent = `
<template>
  <t-button theme="primary" size="large" @tap="handleClick">
    点击按钮
  </t-button>
</template>
<script setup lang="ts">
function handleClick() {
  console.log('clicked')
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('t-button')
      expect(wxml).toContain('bind:tap="handleClick"')
    })

    it('1.2 TDesign 图标组件', async () => {
      const vueContent = `
<template>
  <t-icon name="help-circle-filled" size="32rpx" color="#999999" />
</template>
<script setup lang="ts">
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('t-icon')
    })

    it('1.3 TDesign 遮罩层组件', async () => {
      const vueContent = `
<template>
  <t-overlay :visible="isVisible" @tap="onClose">
    <view>内容</view>
  </t-overlay>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isVisible = ref(false)
function onClose() {
  isVisible.value = false
}
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('t-overlay')
      expect(js).toContain('isVisible')
    })
  })

  describe('2. 复杂 Prop 类型', () => {
    it('2.1 对象类型 prop', async () => {
      const vueContent = `
<template>
  <view>{{ cancelBtn?.content }}</view>
</template>
<script setup lang="ts">
const { cancelBtn = null } = defineProps<{
  cancelBtn?: {
    content: string
    action?: () => void
  } | null
}>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('cancelBtn')
      expect(wxml).toContain('cancelBtn')
    })

    it('2.2 函数类型 prop', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
const { onClick } = defineProps<{
  onClick?: () => void
}>()
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('onClick')
    })

    it('2.3 联合类型 prop', async () => {
      const vueContent = `
<template>
  <view>{{ value }}</view>
</template>
<script setup lang="ts">
const { value } = defineProps<{ value: number | string }>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('value')
      expect(wxml).toContain('value')
    })

    it('2.4 数组类型 prop', async () => {
      const vueContent = `
<template>
  <view v-for="item in options" :key="item.value">{{ item.label }}</view>
</template>
<script setup lang="ts">
const { options } = defineProps<{
  options: Array<{ value: string; label: string }>
}>()
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('options')
      expect(wxml).toContain('wx:for')
    })
  })

  describe('3. 多次 defineOptions 调用', () => {
    it('3.1 多次 defineOptions 应合并', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({ styleIsolation: 'shared' })
defineOptions({ virtualHost: true })
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('virtualHost')
    })
  })

  describe('4. 组件组合模式', () => {
    it('4.1 插槽与 v-if 结合', async () => {
      const vueContent = `
<template>
  <view>
    <slot v-if="showHeader" name="header"></slot>
    <slot></slot>
  </view>
</template>
<script setup lang="ts">
const { showHeader = true } = defineProps<{ showHeader?: boolean }>()
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('slot')
      expect(wxml).toContain('wx:if')
    })

    it('4.2 插槽与 v-for 结合', async () => {
      const vueContent = `
<template>
  <view v-for="item in items" :key="item.id">
    <slot :item="item"></slot>
  </view>
</template>
<script setup lang="ts">
const { items } = defineProps<{
  items: Array<{ id: number; name: string }>
}>()
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('wx:for')
    })

    it('4.3 动态 class 与 style 结合', async () => {
      const vueContent = `
<template>
  <view
    :class="{ active: isActive, disabled: isDisabled }"
    :style="{ color: textColor, fontSize: fontSize + 'px' }"
  >
    内容
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isActive = ref(true)
const isDisabled = ref(false)
const textColor = ref('#333')
const fontSize = ref(14)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('isActive')
      expect(wxml).toContain('textColor')
    })
  })

  describe('5. watch 深度监听', () => {
    it('5.1 watch 多个数据源', async () => {
      const vueContent = `
<template>
  <view>{{ result }}</view>
</template>
<script setup lang="ts">
import { ref, watch } from '@unmagic/vue-mini'
const options = ref([])
const value = ref('')
const result = ref('')
watch(
  [() => options, () => value],
  ([options, value]) => {
    result.value = options?.find((item) => item.value === value)?.label ?? '请选择'
  },
  { immediate: true },
)
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('watch')
      expect(js).toContain('immediate')
    })
  })

  describe('6. computed 链式使用', () => {
    it('6.1 computed 依赖其他 computed', async () => {
      const vueContent = `
<template>
  <view>{{ fullName }}</view>
</template>
<script setup lang="ts">
import { ref, computed } from '@unmagic/vue-mini'
const firstName = ref('张')
const lastName = ref('三')
const fullName = computed(() => firstName.value + lastName.value)
const displayName = computed(() => '用户：' + fullName.value)
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('computed')
      expect(wxml).toContain('fullName')
    })

    it('6.2 computed 返回对象', async () => {
      const vueContent = `
<template>
  <view>{{ content.text }}</view>
</template>
<script setup lang="ts">
import { computed } from '@unmagic/vue-mini'
const content = computed(() => ({
  text: 'Hello',
  fontSize: 18,
}))
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('computed')
      expect(wxml).toContain('content')
    })
  })

  describe('7. 事件处理模式', () => {
    it('7.1 事件修饰符 .stop', async () => {
      const vueContent = `
<template>
  <view @tap.stop="onToggle">
    <t-icon name="help-circle-filled" />
  </view>
</template>
<script setup lang="ts">
function onToggle() {
  console.log('toggled')
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('catch:tap="onToggle"')
    })

    it('7.2 内联事件与方法调用', async () => {
      const vueContent = `
<template>
  <view @tap="onClick">
    <t-button @tap="() => { visible = false }">关闭</t-button>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const visible = ref(true)
function onClick() {
  console.log('clicked')
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('bind:tap="onClick"')
    })

    it('7.3 事件传递 data 属性', async () => {
      const vueContent = `
<template>
  <view v-for="item of options" :key="item.value" :data-item="item" @tap="onItemTap">
    {{ item.label }}
  </view>
</template>
<script setup lang="ts">
const { options } = defineProps<{
  options: Array<{ value: string; label: string }>
}>()
function onItemTap(event: any) {
  console.log(event.currentTarget.dataset.item)
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('data-item')
      expect(wxml).toContain('bind:tap="onItemTap"')
    })
  })

  describe('8. 条件与列表组合', () => {
    it('8.1 v-for + v-if + v-else', async () => {
      const vueContent = `
<template>
  <view v-for="item in list" :key="item.id">
    <text v-if="item.active">{{ item.name }}</text>
    <text v-else>{{ item.name }} (禁用)</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([
  { id: 1, name: '项目1', active: true },
  { id: 2, name: '项目2', active: false },
])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('wx:for')
      expect(wxml).toContain('wx:if')
      expect(wxml).toContain('wx:else')
    })

    it('8.2 嵌套 v-if + v-for', async () => {
      const vueContent = `
<template>
  <view v-if="showList">
    <view v-for="item in list" :key="item.id">
      <text v-if="item.selected">{{ item.name }}</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const showList = ref(true)
const list = ref([{ id: 1, name: '项目1', selected: true }])
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('wx:if="{{showList}}"')
      expect(wxml).toContain('wx:for')
    })
  })

  describe('9. 样式绑定高级模式', () => {
    it('9.1 动态 style 对象', async () => {
      const vueContent = `
<template>
  <view :style="{ '--td-button-light-bg-color': activeBgColor, '--td-button-light-color': activeColor }">
    内容
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const activeBgColor = ref('rgba(3, 198, 90, 0.1)')
const activeColor = ref('#00522f')
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('activeBgColor')
      expect(wxml).toContain('activeColor')
    })

    it('9.2 动态 class 三元表达式', async () => {
      const vueContent = `
<template>
  <view :class="item.value === value ? 'active' : 'normal'">
    {{ item.label }}
  </view>
</template>
<script setup lang="ts">
const { value } = defineProps<{ value: string }>()
const item = { value: 'test', label: '测试' }
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(wxml).toContain('value')
    })
  })

  describe('10. 异步操作模式', () => {
    it('10.1 async/await 在事件处理中', async () => {
      const vueContent = `
<template>
  <view>
    <button @tap="handleSubmit">提交</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const loading = ref(false)
async function handleSubmit() {
  loading.value = true
  try {
    await Promise.resolve()
  } finally {
    loading.value = false
  }
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('handleSubmit')
      expect(js).toContain('loading')
    })
  })

  describe('11. 组件通信模式', () => {
    it('11.1 defineEmits + defineProps 组合', async () => {
      const vueContent = `
<template>
  <view @tap="handleChange">{{ value }}</view>
</template>
<script setup lang="ts">
const { value } = defineProps<{ value: string }>()
const emit = defineEmits<{
  (e: 'update:value', value: string): void
}>()
function handleChange() {
  emit('update:value', 'new value')
}
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
      expect(wxml).toContain('value')
    })

    it('11.2 defineContext + defineEmits', async () => {
      const vueContent = `
<template>
  <view @tap="handleTap">触发</view>
</template>
<script setup lang="ts">
const ctx = defineContext()
const emit = defineEmits(['tap'])
function handleTap() {
  ctx.triggerEvent('tap')
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
    })
  })
})
