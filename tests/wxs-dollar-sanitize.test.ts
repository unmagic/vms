import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXS 降级中的 `$` 处理边界。
 *
 * 原则：**产物必须能在微信小程序的 WXS/WXML 环境中合法运行**，
 * 而不是照搬 Vue 语义。WXS 不支持 `$` 标识符，因此：
 *  - **变量名**中的 `$` → `_`
 *  - **属性名**中的 `$` → 改用计算成员/字符串键（`obj['$v']`、`{ '$k': 1 }`）
 *
 * 两种错误做法都要避免：
 *  - 改名成 `obj._v` → 读不存在的属性，静默取到 undefined
 *  - 原样保留 `obj.$v` → `$` 作为标识符进入 WXS，产物不保证可运行
 */
function extractWxs(wxml: string): string {
  return wxml.match(/<wxs[\s\S]*?<\/wxs>/)?.[0] ?? ''
}

describe('WXS 降级的 $ 处理（产物合法性优先）', () => {
  it('成员访问改写为计算成员：obj.$value -> obj["$value"]', async () => {
    const { wxml, error } = await compileVueContent(
      [
        '<template><view :class="obj.$value ? true : false">x</view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const obj = ref({ $value: true })',
        '</script>',
      ].join('\n'),
    )

    expect(error).toBeNull()
    const wxs = extractWxs(wxml)
    // 键名精确保留，且以 WXS 合法的字符串键形式出现
    expect(wxs).toContain("['$value']")
    expect(wxs).not.toContain('.$value')
    expect(wxs).not.toContain('._value')
  })

  it('可选链与嵌套属性同样改写', async () => {
    const { wxml, error } = await compileVueContent(
      [
        '<template><view :class="a.$b.$c ? true : false">x</view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const a = ref({ $b: { $c: true } })',
        '</script>',
      ].join('\n'),
    )

    expect(error).toBeNull()
    const wxs = extractWxs(wxml)
    expect(wxs).toContain("['$b']")
    expect(wxs).toContain("['$c']")
    expect(wxs).not.toMatch(/\.\$[bc]/)
  })

  it('变量名中的 $ 仍替换为 _', async () => {
    const { wxml, error } = await compileVueContent(
      [
        '<template><view :class="$flag ? true : false">x</view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const $flag = ref(true)',
        '</script>',
      ].join('\n'),
    )

    expect(error).toBeNull()
    expect(extractWxs(wxml)).toContain('_flag')
  })

  it('已用字符串键的计算成员保持等价形式', async () => {
    const { wxml, error } = await compileVueContent(
      [
        '<template><view :class="obj[\'$k\'] ? true : false">x</view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const obj = ref<Record<string, boolean>>({ $k: true })',
        '</script>',
      ].join('\n'),
    )

    expect(error).toBeNull()
    expect(extractWxs(wxml)).toContain("['$k']")
  })

  it('对象字面量的 $ 键改写为字符串键', async () => {
    const { wxml, error } = await compileVueContent(
      [
        "<template><view :class=\"{ on: ({ '$k': 1 })['$k'] === 1 }\">x</view></template>",
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const n = ref(1)',
        '</script>',
      ].join('\n'),
    )

    expect(error).toBeNull()
    const wxs = extractWxs(wxml)
    // 非计算 key 的 $k 应变成字符串键，不再出现裸标识符
    expect(wxs).not.toMatch(/\{\s*\$k\s*:/)
  })
})
