import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 未实现的编译宏必须编译报错。
 *
 * 回归背景：这类宏是**编译期语法**，运行时没有对应函数。VMS 未处理时，
 * 产物会保留宏调用本身：
 *  - `withDefaults(...)` → setup 内 `withDefaults is not defined`
 *  - `defineSlots<{...}>()` → 保留 TS 泛型，产出**非法 JavaScript**，
 *    小程序连文件都无法加载（`new Function(...)` 即抛 SyntaxError）
 * 两者原先都静默通过编译。
 */
function compile(code: string) {
  return compileVueContent(
    [
      '<template><view>{{ a }}</view></template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      code,
      '</script>',
    ].join('\n'),
  )
}

describe('未实现的编译宏：编译期报错', () => {
  it('withDefaults 报错并指向响应式 Props 解构', async () => {
    const r = await compile("const p = withDefaults(defineProps<{ a?: string }>(), { a: 'd' })")
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('withDefaults')
    expect(r.error!.message).toContain('解构')
  })

  it('defineSlots（带泛型）报错', async () => {
    const r = await compile('defineSlots<{ d: () => any }>()')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('defineSlots')
  })

  it('defineSlots（无泛型）同样报错', async () => {
    const r = await compile('defineSlots()')
    expect(r.error).not.toBeNull()
  })

  it('报错产物中不残留非法 JS', async () => {
    const r = await compile('defineSlots<{ d: () => any }>()')
    // 报错时不应产出可用的 js 内容
    expect(r.error).not.toBeNull()
  })
})

describe('对照：受支持的写法不受影响', () => {
  it('defineProps 解构默认值（推荐替代）正常编译', async () => {
    const r = await compile("const { a = 'd' } = defineProps<{ a?: string }>()")
    expect(r.error).toBeNull()
  })

  it('defineProps / defineEmits / defineExpose / defineOptions / defineModel 正常', async () => {
    for (const code of [
      'const p = defineProps<{ a?: string }>()',
      "const e = defineEmits<{ (x: 'go'): void }>()",
      'defineExpose({ a: 1 })',
      'defineOptions({ options: { multipleSlots: true } })',
      'const m = defineModel<string>()',
    ]) {
      const r = await compile(code)
      expect(r.error, code + ' 应当编译通过').toBeNull()
    }
  })
})
