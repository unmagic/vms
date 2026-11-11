import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 整体绑定对象（无参数）必须编译报错。
 *
 * 回归背景：`v-bind="obj"` 与 `v-on="handlers"` 会静默丢弃**全部**
 * 属性/事件——元素产物看起来完全正常，但没有属性、不可交互，且不报错。
 * WXML 没有把对象展开为多个属性/事件的机制，因此无法转换，只能报错。
 */
function compile(tpl: string, decls = '') {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      decls,
      '</script>',
    ].join('\n'),
  )
}

describe('整体绑定对象：编译期报错', () => {
  it('v-bind="obj" 报错并提示逐个绑定', async () => {
    const r = await compile('<view v-bind="attrs">a</view>', "const attrs = ref({ id: 'x' })")
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('v-bind')
    expect(r.error!.message).toContain('逐个绑定')
  })

  it('v-on="handlers" 报错并提示逐个绑定', async () => {
    const r = await compile('<button v-on="h">a</button>', 'const h = ref({ tap: () => {} })')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('v-on')
  })

  it('组件上的 v-bind="obj" 同样报错', async () => {
    const r = await compile('<MyCard v-bind="p" />', "const p = ref({ title: 'x' })")
    expect(r.error).not.toBeNull()
  })
})

describe('对照：有参数的绑定不受影响', () => {
  it(':attr 逐个绑定正常', async () => {
    const r = await compile(
      '<view :id="o.id" :title="o.t">a</view>',
      "const o = ref({ id: 'x', t: 'y' })",
    )
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('id="{{o.id}}"')
    expect(r.wxml).toContain('title="{{o.t}}"')
  })

  it('@tap 事件绑定正常', async () => {
    const r = await compile('<button @tap="go">a</button>', 'const go = () => {}')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('bind:tap=')
  })

  it('带参数的事件修饰符正常', async () => {
    const r = await compile('<button @tap.stop="go">a</button>', 'const go = () => {}')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('catch:tap=')
  })
})
