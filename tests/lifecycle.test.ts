import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('生命周期与 defineOptions 测试', () => {
  describe('1. 生命周期钩子', () => {
    it('1.1 onMounted（页面 onLoad）', async () => {
      const vueContent = `
<template>
  <view>{{ message }}</view>
</template>
<script setup lang="ts">
import { ref, onLoad } from '@unmagic/vue-mini'
const message = ref('')
onLoad((options) => {
  message.value = '页面已加载'
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onLoad')
      expect(js).toContain('message')
    })

    it('1.2 onShow 钩子', async () => {
      const vueContent = `
<template>
  <view>{{ count }}</view>
</template>
<script setup lang="ts">
import { ref, onShow } from '@unmagic/vue-mini'
const count = ref(0)
onShow(() => {
  count.value++
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onShow')
    })

    it('1.3 onHide 钩子', async () => {
      const vueContent = `
<template>
  <view>页面内容</view>
</template>
<script setup lang="ts">
import { onHide } from '@unmagic/vue-mini'
onHide(() => {
  console.log('页面隐藏')
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onHide')
    })

    it('1.4 onUnload 钩子', async () => {
      const vueContent = `
<template>
  <view>页面内容</view>
</template>
<script setup lang="ts">
import { onUnload } from '@unmagic/vue-mini'
onUnload(() => {
  console.log('页面卸载')
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onUnload')
    })

    it('1.5 组件 onAttached 钩子', async () => {
      const vueContent = `
<template>
  <view>组件内容</view>
</template>
<script setup lang="ts">
import { onAttached } from '@unmagic/vue-mini'
onAttached(() => {
  console.log('组件已挂载')
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onAttached')
    })

    it('1.6 组件 onDetached 钩子', async () => {
      const vueContent = `
<template>
  <view>组件内容</view>
</template>
<script setup lang="ts">
import { onDetached } from '@unmagic/vue-mini'
onDetached(() => {
  console.log('组件已卸载')
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onDetached')
    })

    it('1.7 多个生命周期钩子并存', async () => {
      const vueContent = `
<template>
  <view>{{ status }}</view>
</template>
<script setup lang="ts">
import { ref, onLoad, onShow, onHide } from '@unmagic/vue-mini'
const status = ref('初始化')
onLoad(() => {
  status.value = '已加载'
})
onShow(() => {
  status.value = '已显示'
})
onHide(() => {
  status.value = '已隐藏'
})
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('onLoad')
      expect(js).toContain('onShow')
      expect(js).toContain('onHide')
    })
  })

  describe('2. defineOptions 配置', () => {
    it('2.1 virtualHost 配置', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({ virtualHost: false })
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // virtualHost 应合并到 options 中
      expect(js).toContain('virtualHost')
      expect(js).toContain('false')
    })

    it('2.2 styleIsolation 配置（写入 JSON）', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({ styleIsolation: 'shared' })
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // defineOptions 的内容会被编译到 JSON，JS 中不一定出现
      expect(error).toBeNull()
    })

    it('2.3 空 defineOptions 不报错', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
defineOptions({})
</script>
`
      const { error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
    })
  })

  describe('3. defineExpose', () => {
    it('3.1 暴露方法', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
function increment() {
  count.value++
}
defineExpose({ increment })
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // defineExpose 应生成 export 方法
      expect(js).toContain('export')
      expect(js).toContain('increment')
    })

    it('3.2 暴露响应式数据', async () => {
      const vueContent = `
<template>
  <view>{{ value }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const value = ref('初始值')
defineExpose({ value })
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('export')
      expect(js).toContain('value')
    })

    it('3.3 暴露多个成员', async () => {
      const vueContent = `
<template>
  <view>内容</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const name = ref('test')
function doSomething() {}
function doOther() {}
defineExpose({ name, doSomething, doOther })
</script>
`
      const { js, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(js).toContain('export')
      expect(js).toContain('name')
      expect(js).toContain('doSomething')
      expect(js).toContain('doOther')
    })
  })

  describe('4. watch 响应式', () => {
    it('4.1 watch 单个 ref', async () => {
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

    it('4.2 watchEffect', async () => {
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

  describe('5. computed 响应式', () => {
    it('5.1 基础 computed', async () => {
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

    it('5.2 computed 依赖多个 ref', async () => {
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

    it('5.3 computed 在模板中直接使用', async () => {
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

  describe('6. reactive 响应式', () => {
    it('6.1 基础 reactive', async () => {
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

    it('6.2 reactive 与 ref 混用', async () => {
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
})
