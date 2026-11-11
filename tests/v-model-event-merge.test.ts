import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * v-model 与显式事件绑定共存时的处理。
 *
 * v-model 会自动生成 setter 绑定（bind:input / bind:update:xxx），
 * 若用户显式写了同名事件，两者必须**都**执行：
 * 只保留其一会导致 v-model 回写失效（数据不更新）或用户回调不触发。
 * Vue 的做法是合并为数组，这里等价地生成顺序调用两者的桥接函数。
 */
describe('v-model 与显式事件绑定共存', () => {
  it('1.1 原生标签：v-model + @input 合并，两者都被调用', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <input v-model="a" @input="onIn" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref('')
const onIn = (e: any) => console.log(e)
</script>
`)

    expect(error).toBeNull()
    // 绑定到生成的桥接函数
    expect(wxml).toMatch(/bind:input="__fun_\d+"/)
    // 桥接函数内先执行 v-model 回写，再执行用户回调
    expect(js).toContain('__vmsProxyRefs.a = __vms_event.detail.value')
    expect(js).toMatch(/__fun_\d+\(__vms_event\)/)
    // 用户回调仍在函数体内被调用（未被丢弃）
    expect(js).toContain('onIn(__vms_event)')
  })

  it('1.2 组件：v-model + @update:modelValue 合并', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <MyInput v-model="a" @update:modelValue="onUp" />
</template>
<script setup lang="ts">
import MyInput from './MyInput.vue'
import { ref } from '@unmagic/vue-mini'
const a = ref('')
const onUp = (v: any) => console.log(v)
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toMatch(/bind:update:modelValue="__fun_\d+"/)
    // 组件 v-model：detail 本身就是 emit 的值（无 .value 嵌套）
    expect(js).toContain('__vmsProxyRefs.a = __vms_event.detail')
    expect(js).toContain('onUp(__vms_event)')
  })

  it('1.3 无冲突时不生成多余桥接，行为不变', async () => {
    const { wxml, js, error } = await compileVueContent(`
<template>
  <input v-model="a" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref('')
</script>
`)

    expect(error).toBeNull()
    expect(wxml).toMatch(/bind:input="__fun_0"/)
    expect(js).toContain('__vmsProxyRefs.a = __vms_event.detail.value')
  })

  it('1.4 显式绑定不会覆盖 v-model setter（回归防线）', async () => {
    const { wxml, error } = await compileVueContent(`
<template>
  <input v-model="a" @input="onIn" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref('')
const onIn = (e: any) => console.log(e)
</script>
`)

    expect(error).toBeNull()
    // 旧行为是直接绑定用户方法名，导致 v-model 的 setter 变成死代码
    expect(wxml).not.toMatch(/bind:input="onIn"/)
  })
})
