import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXS 中不可用的全局函数改写为等价写法。
 *
 * 官方《WXS 语法参考 · 基础类库》列出的 Global 方法只有：
 *   parseInt / parseFloat / isNaN / isFinite / decodeURI / decodeURIComponent
 *   / encodeURI / encodeURIComponent
 * **没有 String，也没有 Boolean**。已用模拟器实测确认：
 *   {{ String(123) }} → 渲染为空字符串（静默失值）
 *   {{ Boolean(1) }}  → 渲染为空字符串
 *   {{ Number('42') }} / {{ parseInt('7x') }} / {{ isNaN('x') }} → 正常
 * 原样输出会让产物静默产出空值，故改写为等价 WXS 写法。
 */
function compile(expr: string) {
  return compileVueContent(
    [
      '<template><view :title="' + expr + '">x</view></template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      'const n = ref(123)',
      "const s = ref('abc')",
      '</script>',
    ].join('\n'),
  )
}

function wxsOf(wxml: string): string {
  return (wxml.match(/<wxs[\s\S]*?<\/wxs>/)?.[0] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ')
}

describe('String() 改写为字符串拼接', () => {
  it("String(123) → '' + 123", async () => {
    const r = await compile('String(123)')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain("'' + 123")
    expect(wxsOf(r.wxml)).not.toContain('String(')
  })

  it("String(变量) → '' + 变量", async () => {
    const r = await compile('String(n)')
    expect(wxsOf(r.wxml)).toContain("'' + n")
  })

  it('String() 无参 → 空字符串字面量', async () => {
    const r = await compile('String()')
    expect(wxsOf(r.wxml)).toContain("return ''")
  })
})

describe('Boolean() 改写为双重取反', () => {
  it('Boolean(1) → !!1', async () => {
    const r = await compile('Boolean(1)')
    expect(r.error).toBeNull()
    expect(wxsOf(r.wxml)).toContain('!!1')
    expect(wxsOf(r.wxml)).not.toContain('Boolean(')
  })

  it('Boolean(变量) → !!变量', async () => {
    const r = await compile('Boolean(n)')
    expect(wxsOf(r.wxml)).toContain('!!n')
  })

  it('Boolean() 无参 → false 字面量', async () => {
    const r = await compile('Boolean()')
    expect(wxsOf(r.wxml)).toContain('return false')
  })
})

describe('对照：WXS 中确实存在的全局不被改写', () => {
  it('Number() 保持原样（基础类库中有 Number）', async () => {
    const r = await compile('Number(s)')
    expect(wxsOf(r.wxml)).toContain('Number(s)')
  })

  it('parseInt / isNaN 保持原样', async () => {
    for (const e of ["parseInt('7x')", "isNaN('x')", "isFinite('1')"]) {
      const r = await compile(e)
      const name = e.slice(0, e.indexOf('('))
      expect(wxsOf(r.wxml), name + ' 不应被改写').toContain(name + '(')
    }
  })
})
