import { describe, it, expect } from 'vitest'
import { parseStyles } from '../src/style'

/**
 * SFC style → WXSS 转换。
 *
 * 回归背景：`:deep(...)` / `::v-deep(...)` 是 Vue scoped CSS 语法，
 * WXSS **不支持**。旧实现原样输出，微信开发者工具会丢弃整条规则，
 * 样式静默失效（真实项目中已出现 14 处）。
 */
function style(content: string, scoped = true) {
  return [{ content, scoped }] as any
}

describe('parseStyles：:deep 展开', () => {
  it('1.1 单独的 :deep(...) 取括号内选择器', () => {
    expect(parseStyles(style(':deep(.t-input__content) { color: #333 }'))).toBe(
      '.t-input__content { color: #333 }',
    )
  })

  it('1.2 ::v-deep(...) 同样展开', () => {
    expect(parseStyles(style('::v-deep(.b) { color: red }'))).toBe('.b { color: red }')
  })

  it('1.3 前缀选择器与 :deep 拼接', () => {
    expect(parseStyles(style('.content-area :deep(.content-text) { color: red }'))).toBe(
      '.content-area .content-text { color: red }',
    )
  })

  it('1.4 同一条规则内多次 :deep 全部展开', () => {
    expect(parseStyles(style('.a :deep(.b) :deep(.c) { color: red }'))).toBe(
      '.a .b .c { color: red }',
    )
  })

  it('1.5 组合符形式 :deep(.a > .b) 保留内部结构', () => {
    expect(parseStyles(style(':deep(.a > .b) { color: red }'))).toBe('.a > .b { color: red }')
  })

  it('1.6 多个 style 块各自处理', () => {
    const out = parseStyles([
      { content: ':deep(.a) { color: red }', scoped: true },
      { content: ':deep(.b) { color: blue }', scoped: true },
    ] as any)
    expect(out).toBe('.a { color: red }\n.b { color: blue }')
  })
})

describe('parseStyles：既有行为保持不变', () => {
  it('2.1 scoped 的 [data-v-*] 属性被移除', () => {
    expect(parseStyles(style('.a[data-v-abc123] { color: red }'))).toBe('.a { color: red }')
  })

  it('2.2 非 scoped 样式保持原样', () => {
    expect(parseStyles(style('.a { color: red }', false))).toBe('.a { color: red }')
  })

  it('2.3 空样式块返回空字符串', () => {
    expect(parseStyles([])).toBe('')
    expect(parseStyles(undefined as any)).toBe('')
  })

  it('2.4 普通样式不受 :deep 处理影响', () => {
    const css = '.a { color: red }\n.b:hover { color: blue }'
    expect(parseStyles(style(css))).toBe(css)
  })

  // 回归：朴素的全局正则会改写**声明值**里的 ":deep(x)" 文本
  // （如 content: ":deep(x)"），那不是选择器，必须原样保留
  it('2.5 字符串字面量中的 :deep 文本不被改写', () => {
    const css = '.a::before { content: ":deep(x)" }'
    expect(parseStyles(style(css))).toBe('.a::before { content: ":deep(x)" }')
  })

  it('2.6 单引号字符串同样不被改写', () => {
    const css = ".a::before { content: ':deep(y)' }"
    expect(parseStyles(style(css))).toBe(".a::before { content: ':deep(y)' }")
  })

  it('2.7 注释中的 :deep 不被改写', () => {
    const css = '/* :deep(.a) 说明 */\n.b { color: red }'
    expect(parseStyles(style(css))).toContain('/* :deep(.a) 说明 */')
  })
})
