import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXS 中缺失的静态方法必须经 polyfill 转译。
 *
 * 模拟器实测：typeof Object / Array / String === 'undefined'；
 * Math / JSON / Number 存在（但 Math 只到 ES5）。
 * 模板里直接写这些调用会**静默产出空值**。
 *
 * 回归背景（本轮修复）：Object.keys/values、Array.isArray、
 * Number.parseInt/parseFloat、Math.trunc/sign/log2/log10/cbrt/hypot
 * 此前均被原样输出到 WXS，真机渲染为空。
 */
const ROUTED: Array<[string, string]> = [
  ['Object.keys(obj)', 'objectKeys'],
  ['Object.values(obj)', 'objectValues'],
  ['Array.isArray(arr)', 'arrayIsArray'],
  ["Number.parseInt('7')", 'numberParseInt'],
  ["Number.parseFloat('1.5')", 'numberParseFloat'],
  ['Math.trunc(4.7)', 'mathTrunc'],
  ['Math.sign(-3)', 'mathSign'],
  ['Math.log2(8)', 'mathLog2'],
  ['Math.log10(100)', 'mathLog10'],
  ['Math.cbrt(27)', 'mathCbrt'],
  ['Math.hypot(3, 4)', 'mathHypot'],
]

/** WXS 官方支持、不应被改写的常见调用（防止过度 polyfill） */
const NATIVE: string[] = [
  'Math.floor(4.7)',
  'Math.max(1, 2)',
  "parseInt('7')",
  "parseFloat('1.5')",
  "isNaN('x')",
]

async function wxsOf(expr: string) {
  // 用文本插值（<view>{{ expr }}</view>）而不是属性绑定：
  // 属性绑定的 prop.content 不含 {{ }}，直接拼接会被当成普通字符串。
  const r = await compileVueContent(
    [
      '<template><view>{{ ' + expr + ' }}</view></template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      'const obj = ref({ a: 1 })',
      'const arr = ref([1])',
      '</script>',
    ].join(String.fromCharCode(10)),
  )
  expect(r.error).toBeNull()
  return (r.wxml.match(/<wxs[\s\S]*?<\/wxs>/)?.[0] ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
}

describe('WXS 缺失的静态方法走 polyfill', () => {
  for (const [expr, fn] of ROUTED) {
    it(expr + ' -> __vmsWXSUtils.' + fn, async () => {
      expect(await wxsOf(expr)).toContain('__vmsWXSUtils.' + fn)
    })
  }
})

describe('WXS 官方已有的调用不被改写', () => {
  for (const expr of NATIVE) {
    it(expr + ' 保持原样', async () => {
      const w = await wxsOf(expr)
      expect(w).not.toContain('__vmsWXSUtils')
    })
  }
})

describe('polyfill 实现本身符合 WXS 语义', () => {
  it('arrayIsArray 只比较 constructor 字符串，不引用 Array 全局', async () => {
    const fs = await import('node:fs')
    const code = fs
      .readFileSync('polyfill/wxsUtils.wxs', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    // 若写成 `|| ctor === Array`，WXS 中 Array 未定义会抛错——
    // 而 {x:1} 这类非数组对象恰恰是 isArray 最需要判断的情况
    expect(/ctor === Array\b/.test(code)).toBe(false)
    expect(/value\.constructor === 'Array'/.test(code)).toBe(true)
  })
})
