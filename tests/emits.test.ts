import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('defineEmits 测试', () => {
  describe('1. 基础 emit 声明', () => {
    it('1.1 数组风格声明', async () => {
      const vueContent = `
<template>
  <button @tap="handleClick">点击</button>
</template>
<script setup lang="ts">
const emit = defineEmits(['click', 'change'])
function handleClick() {
  emit('click')
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // emit 应转换为 context.triggerEvent 调用
      expect(js).toContain('triggerEvent')
      expect(js).toContain("'click'")
    })

    it('1.2 类型声明风格', async () => {
      const vueContent = `
<template>
  <button @tap="handleClick">提交</button>
</template>
<script setup lang="ts">
const emit = defineEmits<{
  (e: 'submit', value: string): void
  (e: 'cancel'): void
}>()
function handleClick() {
  emit('submit', 'hello')
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
      expect(js).toContain("'submit'")
    })

    it('1.3 emit 与数据传递', async () => {
      const vueContent = `
<template>
  <button @tap="handleConfirm">确认</button>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const emit = defineEmits(['confirm'])
const value = ref('test')
function handleConfirm() {
  emit('confirm', value.value)
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
    })
  })

  describe('2. emit 在内联事件中使用', () => {
    it('2.1 内联箭头函数中 emit', async () => {
      const vueContent = `
<template>
  <button @tap="() => { emit('click') }">点击</button>
</template>
<script setup lang="ts">
const emit = defineEmits(['click'])
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:tap="__fun_')
      expect(js).toContain('triggerEvent')
    })

    it('2.2 内联函数中 emit 并传值', async () => {
      const vueContent = `
<template>
  <button @tap="() => { emit('change', inputValue) }">提交</button>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const emit = defineEmits(['change'])
const inputValue = ref('')
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
    })
  })

  describe('3. emit 与 props 组合', () => {
    it('3.1 接受 props 并触发 emit', async () => {
      const vueContent = `
<template>
  <button @tap="handleClick">{{ label }}</button>
</template>
<script setup lang="ts">
const props = defineProps<{ label: string }>()
const emit = defineEmits(['clicked'])
function handleClick() {
  emit('clicked', props.label)
}
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{label}}')
      expect(js).toContain('triggerEvent')
      expect(js).toContain('properties')
    })

    it('3.2 解构 props 并使用 emit', async () => {
      const vueContent = `
<template>
  <view>{{ title }}</view>
  <button @tap="handleClose">关闭</button>
</template>
<script setup lang="ts">
const { title } = defineProps<{ title: string }>()
const emit = defineEmits(['close'])
function handleClose() {
  emit('close')
}
</script>
`
      const { js, wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('{{title}}')
      expect(js).toContain('triggerEvent')
    })
  })

  describe('4. 事件名称的命名规范', () => {
    it('4.1 camelCase 事件名', async () => {
      const vueContent = `
<template>
  <button @tap="handleUpdate">更新</button>
</template>
<script setup lang="ts">
const emit = defineEmits(['updateValue'])
function handleUpdate() {
  emit('updateValue', 123)
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
      expect(js).toContain("'updateValue'")
    })

    it('4.2 多个 emit 事件', async () => {
      const vueContent = `
<template>
  <button @tap="handleOk">确定</button>
  <button @tap="handleCancel">取消</button>
</template>
<script setup lang="ts">
const emit = defineEmits(['ok', 'cancel'])
function handleOk() {
  emit('ok')
}
function handleCancel() {
  emit('cancel')
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
      expect(js).toContain("'ok'")
      expect(js).toContain("'cancel'")
    })
  })

  describe('5. emit 上下文变量名', () => {
    it('5.1 自定义 context 变量名', async () => {
      const vueContent = `
<template>
  <button @tap="handleAction">触发</button>
</template>
<script setup lang="ts">
const myEmit = defineEmits(['action'])
function handleAction() {
  myEmit('action')
}
</script>
`
      const { js, error } = await compileVueContent(vueContent)
      expect(error).toBeNull()
      expect(js).toContain('triggerEvent')
      expect(js).toContain("'action'")
    })
  })
})
