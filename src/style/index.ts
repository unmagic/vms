import { type SFCStyleBlock } from '@vue/compiler-sfc'

export function parseStyles(styles: SFCStyleBlock[]): string {
  if (!styles || styles.length === 0) {
    return ''
  }

  // 合并所有样式块
  return styles
    .map((style) => {
      // 移除scoped标记
      if (style.scoped) {
        return style.content.replace(/\[data-v-[a-zA-Z0-9]+\]/g, '')
      }
      return style.content
    })
    .join('\n')
}
