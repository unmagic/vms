import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('生命周期钩子测试', () => {
  it('onLoad 钩子', async () => {
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

  it('onShow 钩子', async () => {
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

  it('onHide 钩子', async () => {
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

  it('onUnload 钩子', async () => {
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

  it('onAttached 钩子', async () => {
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

  it('onDetached 钩子', async () => {
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

  it('多个生命周期钩子并存', async () => {
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
