import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * v-model 事件对象的 detail 取值形态。
 *
 * 两类事件源的 detail 形态**不同**，用错会静默把 undefined 写回父组件：
 *
 * 1. 原生表单标签：平台原生事件，值在 e.detail.value
 * 2. 自定义组件（含 defineModel）：值由子组件 triggerEvent(name, value)
 *    传出，微信把第二个参数整体作为 detail，故 e.detail 就是值本身
 *
 * 实测依据（模拟器）：emit('raw','RAW_VALUE') 后 e.detail === 'RAW_VALUE'；
 * emit('wrapped',{value:'X'}) 后 e.detail === {value:'X'}。
 * 项目内既有代码亦按 e.detail 读取。
 *
 * 回归背景：早期实现两者都生成 e.detail.value，导致组件 v-model / defineModel
 * 把 undefined 写回父组件（实测父组件值从字符串变为 undefined）。
 */
function compileComponent(tpl: string, script: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import MyComp from './MyComp.vue'",
      "import { ref } from '@unmagic/vue-mini'",
      script,
      '</script>',
    ].join('\n'),
  )
}

function compileNative(tpl: string, script: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      script,
      '</script>',
    ].join('\n'),
  )
}

const assignOf = (js: string, name: string) =>
  (js.match(new RegExp('__vmsProxyRefs\\.' + name + ' = [^;]+')) || [''])[0]

describe('自定义组件 v-model 读取 e.detail', () => {
  it('默认 modelValue：e.detail（不是 e.detail.value）', async () => {
    const r = await compileComponent('<MyComp v-model="t" />', "const t = ref('x')")
    const a = assignOf(r.js, 't')
    expect(a).toContain('__vms_event.detail')
    expect(a).not.toContain('detail.value')
  })

  it('命名参数 v-model:num：e.detail', async () => {
    const r = await compileComponent('<MyComp v-model:num="n" />', 'const n = ref(0)')
    const a = assignOf(r.js, 'n')
    expect(a).toContain('__vms_event.detail')
    expect(a).not.toContain('detail.value')
  })

  it('t- 前缀（tdesign）组件同样按组件处理', async () => {
    const r = await compileComponent('<t-input v-model="t" />', "const t = ref('x')")
    const a = assignOf(r.js, 't')
    expect(a).toContain('__vms_event.detail')
    expect(a).not.toContain('detail.value')
  })
})

describe('原生表单标签 v-model 仍读取 e.detail.value', () => {
  it('input：e.detail.value 保持不变', async () => {
    const r = await compileNative('<input v-model="t" />', "const t = ref('x')")
    expect(assignOf(r.js, 't')).toContain('__vms_event.detail.value')
  })

  it('textarea / switch / slider 仍为 detail.value', async () => {
    for (const tag of ['textarea', 'switch', 'slider']) {
      const r = await compileNative('<' + tag + ' v-model="t" />', "const t = ref('x')")
      expect(assignOf(r.js, 't'), tag).toContain('__vms_event.detail.value')
    }
  })
})

describe('.trim / .number 修饰符在两种形态下都作用于正确的值', () => {
  it('原生 + .trim → detail.value.trim()', async () => {
    const r = await compileNative('<input v-model.trim="t" />', "const t = ref('x')")
    expect(assignOf(r.js, 't')).toContain('__vms_event.detail.value.trim()')
  })

  it('组件 + .trim → detail.trim()', async () => {
    const r = await compileComponent('<MyComp v-model.trim="t" />', "const t = ref('x')")
    const a = assignOf(r.js, 't')
    expect(a).toContain('__vms_event.detail.trim()')
    expect(a).not.toContain('detail.value')
  })

  it('组件 + .number → 基于 detail 转数字', async () => {
    const r = await compileComponent('<MyComp v-model.number="t" />', "const t = ref('x')")
    const a = assignOf(r.js, 't')
    expect(a).toContain('__vms_event.detail')
    expect(a).not.toContain('detail.value')
    expect(a).toContain('+__vms_event.detail')
  })
})
