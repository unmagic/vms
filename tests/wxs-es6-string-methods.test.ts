import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * startsWith / endsWith / repeat 必须经 WXS polyfill。
 *
 * 官方《WXS 语法参考 · 数据类型》列出的 string 方法**只有 ES5**：
 *   toString valueOf charAt charCodeAt concat indexOf lastIndexOf
 *   localeCompare match replace search slice split substring
 *   toLowerCase toLocaleLowerCase toUpperCase toLocaleUpperCase trim
 * startsWith / endsWith / repeat 均为 ES6，WXS 中**不存在**。
 *
 * 回归背景：三者未登记进 WXS_POLYFILL_REGISTRY，被原样输出到 WXS，
 * 真机渲染为**空字符串**（静默失值），而 includes/padStart 因已登记而正常。
 */
function wxsOf(tpl: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      "const s = ref('abc')",
      'const arr = ref([1, 2, 3])',
      '</script>',
    ].join('\n'),
  ).then((r) =>
    (r.wxml.match(/<wxs[\s\S]*?<\/wxs>/)?.[0] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' '),
  )
}

describe('ES6 字符串方法经 WXS polyfill 转译', () => {
  it('startsWith 走 polyfill 而不是原样输出', async () => {
    const w = await wxsOf('{{ s.startsWith() }}')
    expect(w).toContain('__vmsWXSUtils.startsWith')
    expect(w).not.toMatch(/return s\.startsWith\(/)
  })

  it('endsWith 走 polyfill 而不是原样输出', async () => {
    const w = await wxsOf('{{ s.endsWith() }}')
    expect(w).toContain('__vmsWXSUtils.endsWith')
    expect(w).not.toMatch(/return s\.endsWith\(/)
  })

  it('repeat 走 polyfill 而不是原样输出', async () => {
    const w = await wxsOf('{{ s.repeat() }}')
    expect(w).toContain('__vmsWXSUtils.repeat')
    expect(w).not.toMatch(/return s\.repeat\(/)
  })

  it('带参数与 position 时仍走 polyfill', async () => {
    const w = await wxsOf("{{ s.startsWith('b', 1) }}")
    expect(w).toContain('__vmsWXSUtils.startsWith')
    const w2 = await wxsOf("{{ s.endsWith('b', 2) }}")
    expect(w2).toContain('__vmsWXSUtils.endsWith')
  })

  it('repeat 支持数字字面量', async () => {
    const w = await wxsOf("{{ 'ab'.repeat(2) }}")
    expect(w).toContain('__vmsWXSUtils.repeat')
  })
})

describe('对照：官方 WXS 已有的方法仍原样输出', () => {
  it('slice / indexOf / toUpperCase 不走 polyfill', async () => {
    for (const call of ['s.slice(0, 2)', "s.indexOf('b')", 's.toUpperCase()']) {
      const w = await wxsOf('{{ ' + call + ' }}')
      expect(w, call).not.toContain('__vmsWXSUtils')
    }
  })
})

/** polyfill 实现文件本身必须只含 WXS 支持的语法 */
describe('polyfill 实现文件的 WXS 兼容性', () => {
  it('wxsUtils.wxs 不含 WXS 不支持的构造', async () => {
    const fs = await import('node:fs')
    // 剥离注释后再检查：注释里出现 "slice/..." 这类省略号是正常的，
    // 只有代码中的 ... 才是 WXS 不支持的扩展运算符。
    const src = fs
      .readFileSync('polyfill/wxsUtils.wxs', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    for (const [name, re] of [
      ['箭头函数', /=>/],
      ['let/const', /\b(let|const)\s/],
      ['模板字符串', /`/],
      ['可选链', /\?\./],
      ['空值合并', /\?\?/],
      ['扩展运算符', /\.\.\./],
      // try/catch 在 WXS 中不支持（报 Unexpected token），
      // 会让整个 polyfill 文件编译失败、所有页面白屏。
      // 本轮就因在 getOwnKeys 里写 try/catch 踩过一次。
      ['try/catch', /\btry\s*\{/],
      ['for...in', /\bfor\s*\([^)]*\bin\b/],
    ] as Array<[string, RegExp]>) {
      expect(re.test(src), name).toBe(false)
    }
  })
})
