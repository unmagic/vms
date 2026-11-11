import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('事件修饰符测试', () => {
  describe('1. .stop 修饰符', () => {
    it('1.1 @tap.stop 生成 catchtap', async () => {
      const vueContent = `
<template>
  <view @tap.stop="onTap">内容</view>
</template>
<script setup lang="ts">
function onTap() {
  console.log('tapped')
}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('catch:tap="onTap"')
    })

    it('1.2 @tap.stop 内联函数', async () => {
      const vueContent = `
<template>
  <view @tap.stop="() => { count++ }">增加</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('catch:tap="__fun_')
    })
  })

  describe('2. 普通 bind 事件', () => {
    it('2.1 @tap 生成 bindtap', async () => {
      const vueContent = `
<template>
  <view @tap="onClick">点击</view>
</template>
<script setup lang="ts">
function onClick() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:tap="onClick"')
    })

    it('2.2 @input 生成 bindinput', async () => {
      const vueContent = `
<template>
  <input @input="onInput" />
</template>
<script setup lang="ts">
function onInput() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:input="onInput"')
    })

    it('2.3 @change 生成 bindchange', async () => {
      const vueContent = `
<template>
  <switch @change="onChange" />
</template>
<script setup lang="ts">
function onChange() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      expect(wxml).toContain('bind:change="onChange"')
    })
  })

  describe('3. catch 事件前缀', () => {
    it('3.1 @tap.stop 与 @tap 共存于不同元素', async () => {
      const vueContent = `
<template>
  <view @tap="onOuter">
    <view @tap.stop="onInner">内部</view>
  </view>
</template>
<script setup lang="ts">
function onOuter() {}
function onInner() {}
</script>
`
      const { wxml, error } = await compileVueContent(vueContent)

      expect(error).toBeNull()
      // 外层是 bind，内层是 catch
      expect(wxml).toContain('bind:tap="onOuter"')
      expect(wxml).toContain('catch:tap="onInner"')
    })
  })
})

/**
 * 无小程序等价语义的修饰符：编译报错而非静默忽略。
 *
 * 小程序事件系统为 bind / catch / mut-bind / capture-*，
 * 只有部分 Vue 修饰符有等价语义。其余原先被静默忽略——
 * 产物看起来正常但行为缺失（.prevent 不阻止默认行为、.once 会重复触发等）。
 */
function compileWithModifier(mod: string) {
  return compileVueContent(
    [
      '<template><button @tap.' + mod + '="go">a</button></template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      'const go = () => {}',
      '</script>',
    ].join('\n'),
  )
}

describe('2. 有小程序等价语义的修饰符：正常映射', () => {
  it.each([
    ['stop', 'catch:tap='],
    ['capture', 'capture-bind:tap='],
    ['mut', 'mut-bind:tap='],
    ['capture-stop', 'capture-catch:tap='],
  ])('2.x @tap.%s → %s', async (mod, expected) => {
    const { wxml, error } = await compileWithModifier(mod)
    expect(error).toBeNull()
    expect(wxml).toContain(expected)
  })

  it('2.y .raw 保留事件名且不报错', async () => {
    const { wxml, error } = await compileWithModifier('raw')
    expect(error).toBeNull()
    expect(wxml).toContain('bind:tap=')
  })
})

describe('3. 无小程序等价语义的修饰符：编译报错', () => {
  it.each(['prevent', 'self', 'once', 'passive', 'exact', 'left', 'right', 'middle'])(
    '3.x @tap.%s 报错并给出替代方案',
    async (mod) => {
      const { error } = await compileWithModifier(mod)
      expect(error, '.' + mod + ' 应当编译报错').not.toBeNull()
      expect(error!.message).toContain('.' + mod)
    },
  )

  it('3.y .prevent 的错误信息说明小程序无默认行为', async () => {
    const { error } = await compileWithModifier('prevent')
    expect(error!.message).toContain('默认行为')
  })

  it('3.z 与有映射的修饰符组合时仍报错', async () => {
    const { error } = await compileWithModifier('stop.prevent')
    expect(error).not.toBeNull()
    expect(error!.message).toContain('prevent')
  })
})
