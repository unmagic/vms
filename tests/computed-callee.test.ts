import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

function handlerOf(js: string): string {
  const m = js.match(/function __fun_0[\s\S]*?\n {4}\}/)
  return m ? m[0].replace(/\s+/g, ' ') : 'none'
}

describe('计算成员作为调用目标时的属性改写', () => {
  it('a[b]() 的索引变量经 __vmsProxyRefs 解包', async () => {
    const r = await compileVueContent(
      [
        '<template><button @tap="a[b]()">go</button></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const a = ref<Record<string, () => void>>({ x: () => {} })',
        "const b = ref('x')",
        '</script>',
      ].join('\n'),
    )
    expect(r.error).toBeNull()
    const h = handlerOf(r.js)
    expect(h).toContain('__vmsProxyRefs.a[__vmsProxyRefs.b]')
    expect(h).not.toContain('__vmsProxyRefs.a[b]')
  })

  it('内联箭头包裹 a[b]() 同样改写索引变量', async () => {
    const r = await compileVueContent(
      [
        '<template><button @tap="() => a[b]()">go</button></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const a = ref<Record<string, () => void>>({ x: () => {} })',
        "const b = ref('x')",
        '</script>',
      ].join('\n'),
    )
    expect(r.error).toBeNull()
    const h = handlerOf(r.js)
    expect(h).toContain('__vmsProxyRefs.b')
    expect(h).not.toContain('a[b]')
  })
})
