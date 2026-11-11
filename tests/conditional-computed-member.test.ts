import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

function handlerOf(js: string): string {
  const m = js.match(/function __fun_0[\s\S]*?\n {4}\}/)
  return m ? m[0].replace(/\s+/g, ' ') : 'none'
}
const SCRIPT = [
  '<script setup lang="ts">',
  "import { ref } from '@unmagic/vue-mini'",
  'const map = ref<Record<string, number>>({ a: 1 })',
  "const key = ref('a')",
  'const flag = ref(true)',
  'const onPick = (v: number) => v',
  'const onSkip = () => 0',
  '</script>',
].join('\n')

describe('条件/逻辑表达式中的计算成员', () => {
  it('三元表达式内 map[key] 的索引变量被收集与改写', async () => {
    const r = await compileVueContent(
      '<template><button @tap="() => (flag ? onPick(map[key]) : onSkip())">go</button></template>' +
        SCRIPT,
    )
    expect(r.error).toBeNull()
    const h = handlerOf(r.js)
    expect(h).toContain('__vmsProxyRefs.map[__vmsProxyRefs.key]')
    expect(h).not.toContain('.map[key]')
  })

  it('逻辑表达式内 map[key] 同样处理', async () => {
    const r = await compileVueContent(
      '<template><button @tap="() => (flag && onPick(map[key]))">go</button></template>' + SCRIPT,
    )
    expect(r.error).toBeNull()
    expect(handlerOf(r.js)).toContain('__vmsProxyRefs.map[__vmsProxyRefs.key]')
  })
})
