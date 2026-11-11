import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

function handlerOf(js: string): string {
  const m = js.match(/function __fun_0[\s\S]*?\n {4}\}/)
  return m ? m[0].replace(/\s+/g, ' ') : 'none'
}

/**
 * 全局变量在表达式体处理器的参数中不应被包装为 __vmsProxyRefs。
 * 回归背景：`() => onX(Date.now())` 曾生成 `onX(__vmsProxyRefs.Date.now())`，
 * 而 Date 从未注册进组件 data → 运行时抛
 * "Cannot read properties of undefined (reading 'now')"。
 *
 * 块体写法与三元写法走的是另外的改写路径，本来就正确；
 * 只有**表达式体调用**这条路径缺少全局白名单判断。
 */
describe('表达式体处理器中的全局变量', () => {
  const compile = (tmpl: string, decls = '') =>
    compileVueContent(
      [
        '<template><button @tap="' + tmpl + '">go</button></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const onX = (x: unknown) => x',
        'const flag = ref(true)',
        decls,
        '</script>',
      ].join('\n'),
    )

  it('Date.now() 不作为 __vmsProxyRefs 属性访问', async () => {
    const r = await compile('() => onX(Date.now())')
    expect(r.error).toBeNull()
    const h = handlerOf(r.js)
    expect(h).toContain('Date.now()')
    expect(h).not.toContain('__vmsProxyRefs.Date')
  })

  it.each(['Math', 'JSON', 'Object', 'console', 'wx'])('%s 同样保持原样', async (g) => {
    const r = await compile('() => onX(' + g + ')')
    expect(r.error).toBeNull()
    expect(handlerOf(r.js)).not.toContain('__vmsProxyRefs.' + g)
  })

  it('块体写法行为一致（对照）', async () => {
    const r = await compile('() => { return onX(Date.now()) }')
    expect(r.error).toBeNull()
    expect(handlerOf(r.js)).toContain('Date.now()')
  })

  it('普通 setup 变量仍包装为 __vmsProxyRefs', async () => {
    const r = await compile('() => onX(local)', 'const local = ref(1)')
    expect(r.error).toBeNull()
    expect(handlerOf(r.js)).toContain('__vmsProxyRefs.local')
  })
})
