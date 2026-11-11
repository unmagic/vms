import { type SFCStyleBlock } from '@vue/compiler-sfc'
import { createCompileError } from '@/utils/errorHandler'

/**
 * 把 Vue SFC 的 style 块转换为小程序 WXSS。
 *
 * 处理内容：
 *  1. 移除 scoped 属性选择器 `[data-v-xxx]`（小程序无该机制，靠 styleIsolation 隔离）
 *  2. 展开 `:deep(...)` / `::v-deep(...)` 穿透选择器
 *
 * ⚠️ `:deep()` 是 Vue scoped CSS 的语法，**WXSS 不支持**。若原样输出，
 * 微信开发者工具会丢弃整条规则，样式静默失效。小程序的样式隔离本身
 * 已通过 `styleIsolation` 控制，因此这里直接取括号内的选择器。
 *
 * 例：
 *   `:deep(.t-input__content) { color: #333 }`   → `.t-input__content { color: #333 }`
 *   `.content :deep(.text) { ... }`              → `.content .text { ... }`
 */

/** 匹配 `:deep(...)` / `::v-deep(...)`，捕获括号内选择器（不嵌套括号） */
const DEEP_RE = /::?v-deep\(\s*([^()]*?)\s*\)|:deep\(\s*([^()]*?)\s*\)/g

/**
 * 展开 `:deep(...)`；保留括号内的选择器结构。
 *
 * 需要跳过字符串字面量与注释，否则 `content: ":deep(x)"` 这类**声明值**
 * 会被误改（那不是选择器）。这里按字符扫描，只在非字符串/注释区域应用替换。
 */
function unwrapDeepSelectors(css: string): string {
  let out = ''
  let i = 0

  while (i < css.length) {
    const ch = css[i]

    // 字符串字面量：整体原样拷贝
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < css.length) {
        if (css[j] === '\\') j += 2
        else if (css[j] === quote) {
          j++
          break
        } else j++
      }
      out += css.slice(i, j)
      i = j
      continue
    }

    // 注释：整体原样拷贝
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const j = end === -1 ? css.length : end + 2
      out += css.slice(i, j)
      i = j
      continue
    }

    // 命中 :deep(...) / ::v-deep(...)
    DEEP_RE.lastIndex = i
    const m = DEEP_RE.exec(css)
    if (m && m.index === i) {
      out += (m[1] ?? m[2] ?? '').trim()
      i += m[0].length
      continue
    }

    out += ch
    i++
  }

  // 展开后可能出现连续空格（如 `.a :deep(.b)` → `.a .b` 之外的空隙）
  return out.replace(/[ \t]{2,}/g, ' ')
}

/**
 * 校验 style 块是否会被编译成**能在小程序中运行**的 WXSS。
 *
 * 这些写法若静默放行，产出的 WXSS 会被开发者工具丢弃或直接报错，
 * 而使用者只会看到"样式没生效"。按"产物必须能在目标环境运行"的原则，
 * 这里在编译期直接失败并说明原因。
 */
function assertStyleIsWxssCompatible(style: SFCStyleBlock): void {
  // 1. 预处理器：项目未安装 sass/less，嵌套语法会原样进入 WXSS（非法）
  if (style.lang && style.lang !== 'css' && style.lang !== 'wxss') {
    throw createCompileError(
      `style lang="${style.lang}" 不支持：VMS 不做预处理器编译，` +
        `嵌套/变量语法会原样进入 WXSS 而无法被小程序解析。` +
        `请改用标准 CSS，或在外部预编译为 CSS 后再引入。`,
      style.loc ? { start: style.loc.start, end: style.loc.end } : null,
    )
  }

  // 2. <style src="...">：内容不会被打包，产物为空 → 样式静默全部丢失
  if (style.src) {
    throw createCompileError(
      `style src="${style.src}" 不支持：外部样式不会被打包进 WXSS，` +
        `产物中该样式块为空。请把样式内联到 SFC，或改为在 wxss 中 @import。`,
      style.loc ? { start: style.loc.start, end: style.loc.end } : null,
    )
  }

  // 3. v-bind()：小程序无 CSS 变量注入机制，原样输出永不生效
  if (/v-bind\s*\(/.test(style.content)) {
    throw createCompileError(
      `style 中的 v-bind() 不支持：小程序 WXSS 没有 CSS 变量注入机制，` +
        `该声明不会生效。请改用动态 class 或 :style 绑定。`,
      style.loc ? { start: style.loc.start, end: style.loc.end } : null,
    )
  }
}

export function parseStyles(styles: SFCStyleBlock[]): string {
  if (!styles || styles.length === 0) {
    return ''
  }

  return styles
    .map((style) => {
      assertStyleIsWxssCompatible(style)

      let css = style.content

      // `:deep()` 必须先于 scoped 属性清理，否则 `:deep(.a[data-v-x])`
      // 会先被剥掉属性、再展开，虽结果相同但顺序上更稳妥
      css = unwrapDeepSelectors(css)

      // 移除 scoped 标记
      if (style.scoped) {
        css = css.replace(/\[data-v-[a-zA-Z0-9]+\]/g, '')
      }

      return css
    })
    .join('\n')
}
