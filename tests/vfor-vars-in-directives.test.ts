import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * v-for 局部变量出现在**模板指令表达式**中的交叉验证。
 * 这些位置经 WXS 或直接绑定求值，若把 item/index 误当外部变量会破坏产物。
 */
describe('v-for 变量在模板指令中', () => {
  const compile = (tpl: string, decls = '') =>
    compileVueContent(
      [
        '<template>' + tpl + '</template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const list = ref([{ on: true, n: 1 }])',
        decls,
        '</script>',
      ].join('\n'),
    )

  it('item 用于 :class 对象值', async () => {
    const r = await compile(
      '<view v-for="(item, index) in list" :key="index" :class="{ on: item.on }">x</view>',
    )
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('item.on')
    expect(r.wxml).not.toContain('__vmsProxyRefs.item')
  })

  it('index 用于 :class 对象值', async () => {
    const r = await compile(
      '<view v-for="(item, index) in list" :key="index" :class="{ even: index % 2 === 0 }">x</view>',
    )
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('index')
    expect(r.wxml).not.toContain('__vmsProxyRefs.index')
  })

  it('item 与 index 混用于 :style', async () => {
    const r = await compile(
      '<view v-for="(item, index) in list" :key="index" :style="{ color: item.on ? \'red\' : \'blue\' }">{{ index }}</view>',
    )
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('item.on')
    expect(r.wxml).not.toContain('__vmsProxyRefs.item')
  })

  it('index 用于 v-if 条件', async () => {
    const r = await compile(
      '<view v-for="(item, index) in list" :key="index"><text v-if="index > 0">y</text></view>',
    )
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('wx:if')
    expect(r.wxml).not.toContain('__vmsProxyRefs.index')
  })
})
