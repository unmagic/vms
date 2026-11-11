import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 不支持的 Vue 指令必须**编译报错**，不能静默丢弃。
 *
 * 回归背景：`v-html="html"` 曾被静默忽略，产出空元素（内容彻底丢失）
 * 且不报任何错；`v-text` 同理。README/SKILL 中早已列为不支持，
 * 但编译期没有任何拦截，属于最难排查的一类问题。
 */
function compile(tpl: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      "const html = ref('<b>x</b>')",
      "const txt = ref('t')",
      'const n = ref(1)',
      'const list = ref([1])',
      '</script>',
    ].join('\n'),
  )
}

describe('不支持指令的编译期拦截', () => {
  it.each([
    ['v-html', '<view v-html="html"></view>'],
    ['v-text', '<view v-text="txt"></view>'],
    ['v-once', '<view v-once>{{ n }}</view>'],
    ['v-memo', '<view v-memo="[n]">{{ n }}</view>'],
    ['v-cloak', '<view v-cloak>{{ n }}</view>'],
  ])('%s 报编译错误而非静默丢弃', async (name, tpl) => {
    const r = await compile(tpl)
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain(name)
  })

  it('v-html 的错误信息给出替代方案（rich-text）', async () => {
    const r = await compile('<view v-html="html"></view>')
    expect(r.error!.message).toContain('rich-text')
  })

  it('v-text 的错误信息指向插值写法', async () => {
    const r = await compile('<view v-text="txt"></view>')
    expect(r.error!.message).toContain('插值')
  })
})

describe('对照：受支持指令与 v-pre 行为不变', () => {
  it('v-if / v-show / v-for 正常编译', async () => {
    const r = await compile('<view v-if="n" v-show="n" v-for="x in list" :key="x">{{ n }}</view>')
    expect(r.error).toBeNull()
  })

  it('v-pre 保留为字面量文本（Vue 解析器已处理，语义正确）', async () => {
    const r = await compile('<view v-pre>{{ raw }}</view>')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('{{ raw }}')
  })
})
