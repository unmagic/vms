import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 一元 + 必须走 WXS，其余一元运算符保持 DIRECT。
 *
 * 实测（模拟器）：WXML 的表达式解析器**不支持一元加号**，
 * 产物里出现 {{+str}} 会让微信编译器报
 *   Bad value with message: unexpected token '+'
 * 且是**整个页面无法加载**（不只是该表达式为空）。
 *
 * 对照实测：!、-、~、!! 在 WXML 中均可用，二进制 + 也可用。
 * WXS 中一元 + 是合法的（+str → 7），因此只需把一元 + 路由到 WXS。
 */
function compile(expr: string) {
  return compileVueContent(
    [
      '<template><view>{{ ' + expr + ' }}</view></template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      "const str = ref('7')",
      'const num = ref(1.5)',
      'const flag = ref(true)',
      '</script>',
    ].join(String.fromCharCode(10)),
  )
}

describe('一元 + 走 WXS（否则整个页面编译失败）', () => {
  for (const expr of ['+str', '+num', '+str + 1']) {
    it(expr + ' 生成 WXS 调用', async () => {
      const r = await compile(expr)
      expect(r.error).toBeNull()
      // 关键：产物中不得出现裸的一元 +
      expect(r.wxml).not.toMatch(/\{\{\s*\+/)
      expect(r.wxml).toContain('<wxs')
    })
  }
})

describe('WXML 支持的一元运算符保持 DIRECT（避免无谓 WXS）', () => {
  for (const expr of ['-num', '!flag', '!!flag', '~num']) {
    it(expr + ' 不生成 WXS', async () => {
      const r = await compile(expr)
      expect(r.error).toBeNull()
      expect(r.wxml).not.toContain('<wxs')
    })
  }
})

describe('二进制 + 不受影响', () => {
  it('str + num 仍是 DIRECT（WXML 支持二进制 +）', async () => {
    const r = await compile('str + num')
    expect(r.wxml).not.toContain('<wxs')
  })
})
