import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXS 环境构造器兼容性。
 *
 * 官方《WXS 语法参考》明确规定：
 *  - date   —— 「生成 date 对象需要使用 getDate 函数」
 *  - regexp —— 「生成 regexp 对象需要使用 getRegExp 函数」
 * 而《基础类库》中 `Date` 仅提供 parse / UTC / now 三个静态属性，
 * 不存在构造函数。因此 `new Date(...)` / `new RegExp(...)` 在 WXS 中
 * 无法运行——旧实现把它们原样输出，只有在真机运行到该行时才暴露。
 *
 * 编译期改写为等价的 WXS 工厂函数，属于「产物必须能在目标环境运行」
 * 这一原则的直接应用。
 */
function compile(expr: string) {
  return compileVueContent(
    [
      '<template><view :title="' + expr + '">x</view></template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      'const t = ref(1700000000000)',
      "const s = ref('x')",
      '</script>',
    ].join('\n'),
  )
}

function wxsOf(wxml: string): string {
  return (wxml.match(/<wxs[\s\S]*?<\/wxs>/)?.[0] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ')
}

describe('WXS 构造器改写为工厂函数', () => {
  it('new Date() → getDate()', async () => {
    const r = await compile('new Date()')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('getDate()')
    expect(wxsOf(r.wxml)).not.toContain('new Date(')
  })

  it('new Date(ts) → getDate(ts) 且保留参数', async () => {
    const r = await compile('new Date(t)')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('getDate(t)')
  })

  it('new RegExp(s) → getRegExp(s)', async () => {
    const r = await compile('new RegExp(s)')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('getRegExp(s)')
    expect(wxsOf(r.wxml)).not.toContain('new RegExp(')
  })

  it('作为实参嵌套时同样改写', async () => {
    const r = await compile("s.replace(new RegExp(s), 'y')")
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('getRegExp(s)')
  })
})

describe('对照：WXS 中合法的写法不受影响', () => {
  it('Date.now() 保持原样（基础类库明确支持）', async () => {
    const r = await compile('Date.now()')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('Date.now()')
    expect(wxsOf(r.wxml)).not.toContain('getDate')
  })

  it('其它构造器（如 Object）不被误改', async () => {
    const r = await compile('new Object()')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('new Object(')
  })
})
