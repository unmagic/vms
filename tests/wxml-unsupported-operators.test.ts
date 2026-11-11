import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXML 不支持的运算符必须走 WXS。
 *
 * 实测（模拟器）：以下运算符原样输出到 WXML 会让微信编译器报
 *   Bad value with message: unexpected token '...'
 * 且是**整个页面无法加载**（不只是该表达式为空）：
 *   一元 +   → unexpected token '+'
 *   **       → unexpected token '*'
 *   >>>      → unexpected token '>'
 *
 * 对照实测（WXML 均可用，保持 DIRECT）：
 *   ! - ~ !! === + - * / % << >> & | ^ 以及二进制 +
 *
 * 这三个运算符在 WXS 中均合法，因此只需改由 WXS 求值。
 */
const SCRIPT = [
  '<script setup lang="ts">',
  "import { ref } from '@unmagic/vue-mini'",
  "const str = ref('7')",
  'const num = ref(2)',
  '</script>',
].join(String.fromCharCode(10))

function compile(expr: string) {
  return compileVueContent(
    '<template><view>{{ ' + expr + ' }}</view></template>' + String.fromCharCode(10) + SCRIPT,
  )
}

const MUST_BE_WXS = ['num ** 2', 'num >>> 1', '+num', '+str', 'num ** 2 + 1']
const MUST_STAY_DIRECT = [
  'num << 1',
  'num >> 1',
  'num % 2',
  'num & 1',
  'num | 1',
  'num ^ 1',
  'num * 2',
  'num / 2',
  'num + 1',
  '-num',
  '!str',
  '~num',
]

describe('WXML 不支持的运算符必须走 WXS', () => {
  for (const expr of MUST_BE_WXS) {
    it(expr, async () => {
      const r = await compile(expr)
      expect(r.error).toBeNull()
      expect(r.wxml).toContain('<wxs')
      // 产物中不得残留裸的 ** / >>> / 一元 +
      expect(r.wxml).not.toMatch(/\{\{[^}]*\*\*/)
      expect(r.wxml).not.toMatch(/\{\{[^}]*>>>/)
    })
  }
})

describe('WXML 支持的运算符保持 DIRECT（避免无谓 WXS）', () => {
  for (const expr of MUST_STAY_DIRECT) {
    it(expr, async () => {
      const r = await compile(expr)
      expect(r.error).toBeNull()
      expect(r.wxml).not.toContain('<wxs')
    })
  }
})
