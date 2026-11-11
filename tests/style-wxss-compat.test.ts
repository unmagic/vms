import { describe, it, expect } from 'vitest'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parseStyles } from '../src/style'

/**
 * style 块的 WXSS 兼容性拦截。
 *
 * 原则：**产物必须能在微信小程序中运行**。以下写法若不拦截，
 * 会产出无效 WXSS 而使用者只看到"样式没生效"：
 *  - lang="scss"/"less"：不做预编译，嵌套语法原样进入 WXSS
 *  - <style src="...">：外部文件不会被打包，产物为空
 *  - v-bind(...)：小程序无 CSS 变量注入机制
 */
function stylesOf(styleTag: string) {
  const { descriptor } = parseSFC('<template><view>x</view></template>' + styleTag, {
    filename: 't.vue',
  })
  return descriptor.styles
}

describe('style 块：不支持语法在编译期报错', () => {
  it.each([
    ['scss', '<style lang="scss">.a { .b { color: red } }</style>'],
    ['less', '<style lang="less">.a { color: red }</style>'],
    ['sass', '<style lang="sass">.a\n  color: red</style>'],
  ])('lang=%s 报错并说明不做预编译', (_lang, tag) => {
    expect(() => parseStyles(stylesOf(tag))).toThrow(/预处理器|lang=/)
  })

  it('style src 报错并说明外部样式不会被打包', () => {
    expect(() => parseStyles(stylesOf('<style src="./x.css"></style>'))).toThrow(/src=/)
  })

  it('v-bind() 报错并指向替代方案', () => {
    expect(() => parseStyles(stylesOf('<style>.a { color: v-bind(c) }</style>'))).toThrow(/v-bind/)
  })
})

describe('style 块：标准 CSS 不受影响', () => {
  it('普通 CSS 正常输出', () => {
    expect(parseStyles(stylesOf('<style>.a { color: red }</style>'))).toBe('.a { color: red }')
  })

  it('lang=wxss 视为合法', () => {
    expect(parseStyles(stylesOf('<style lang="wxss">.a { color: red }</style>'))).toBe(
      '.a { color: red }',
    )
  })

  it('常见 WXSS 选择器与规则不被误拦', () => {
    const css = [
      '.a:hover { color: red }',
      '.a::before { content: "x" }',
      '.a:not(.b) { color: red }',
      '.a + .b { margin: 0 }',
      '@media (min-width: 100px) { .c { color: red } }',
      '@keyframes k { from { opacity: 0 } }',
      '.d { color: red !important }',
    ].join('\n')
    expect(parseStyles(stylesOf('<style>' + css + '</style>'))).toBe(css)
  })

  it('scoped + :deep 既有行为不变', () => {
    const out = parseStyles(stylesOf('<style scoped>:deep(.t-x) { color: red }</style>'))
    expect(out).toBe('.t-x { color: red }')
  })
})
