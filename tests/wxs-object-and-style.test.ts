import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXS 环境事实（模拟器实测）与由此产生的三个修复。
 *
 * 实测：typeof Object / Array / String 均为 undefined；
 * for...in 与 try/catch 会让 WXS 编译失败。
 * Math / JSON / Number 存在。
 *
 * 1) polyfill 的 objectEntries / objectAssign / styleToString 依赖
 *    Object.keys → WXS 无此方法 → 静默返回空。
 *    修复：getOwnKeys 改用 JSON.stringify 解析键。
 * 2) :style="objVar"（对象变量）原样输出 {{objVar}} → 对象塞进字符串属性。
 *    修复：:style 强制走 WXS 并经 styleToString 转换。
 * 3) 数组/对象字面量内的变量未被提取为 WXS 形参
 *    （[objVar] 生成 function () 却引用 objVar）。
 *    修复：collectVariablesFromAST 增加 ArrayExpression 分支。
 */
function compile(tpl: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      "const objVar = ref({ color: 'red' })",
      "const strVar = ref('color:red')",
      "const clsVar = ref('on')",
      '</script>',
    ].join('\n'),
  )
}

const wxsOf = (wxml: string) => (wxml.match(/<wxs[\s\S]*?<\/wxs>/)?.[0] ?? '').replace(/\s+/g, ' ')

describe(':style 必须输出字符串（经 styleToString）', () => {
  it('对象变量 :style="objVar" 不再原样输出', async () => {
    const r = await compile('<view :style="objVar">x</view>')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('styleToString(objVar)')
    expect(r.wxml).not.toContain('{{objVar}}')
  })

  it('字符串变量 :style="strVar" 同样经 styleToString（字符串原样返回，安全）', async () => {
    const r = await compile('<view :style="strVar">x</view>')
    expect(r.wxml).toContain('styleToString(strVar)')
  })

  it('数组形式 :style="[objVar, ...]" 把变量作为 WXS 形参', async () => {
    const r = await compile('<view :style="[objVar]">x</view>')
    // 关键：形参必须包含 objVar，否则函数体引用未定义变量
    expect(wxsOf(r.wxml)).toMatch(/function\s*\(objVar\)/)
    expect(r.wxml).toContain('styleToString(objVar)')
  })
})

describe('数组字面量内的变量必须被提取为形参', () => {
  it('ArrayExpression 内的标识符进入形参', async () => {
    const r = await compile('<view :class="[clsVar, \'base\']">x</view>')
    expect(r.wxml).toContain('clsVar')
    expect(wxsOf(r.wxml)).toMatch(/function\s*\(clsVar\)/)
  })
})

describe('polyfill 不得使用 WXS 不支持的构造', () => {
  it('wxsUtils.wxs 不含 try/catch 与 for...in', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('polyfill/wxsUtils.wxs', 'utf8')
    // 剥离注释，避免注释里的说明文字造成误报
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(/\btry\s*\{/.test(code), 'try/catch 会让整个 WXS 文件编译失败').toBe(false)
    expect(/\bfor\s*\([^)]*\bin\b/.test(code), 'for...in 在 WXS 中报 Unexpected token').toBe(false)
  })
})
