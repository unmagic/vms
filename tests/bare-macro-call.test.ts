import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 裸宏调用必须编译报错。
 *
 * `defineProps` / `defineEmits` / `defineModel` 必须**接收其返回值**——
 * 编译器需要知道绑定到哪个变量，才能生成 properties / emits / model，
 * 并把变量替换为运行时访问。
 *
 * 回归背景：写成裸调用语句时，此前会被**静默跳过**，后果是双重的：
 *   1. props 未生成 → 产物里 `return { title }` 引用未声明变量
 *   2. 该调用**原样保留**（含 TS 泛型）→ 产物是**非法 JavaScript**
 * 即静默产出错误产物，属于最难排查的一类问题。
 */
function compile(body: string, tpl = '<view>x</view>') {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { defineProps, defineEmits, defineModel } from '@unmagic/vue-mini'",
      body,
      '</script>',
    ].join('\n'),
  )
}

describe('裸宏调用：编译期报错', () => {
  it('defineProps<{...}>() 报错并给出正确写法', async () => {
    const r = await compile('defineProps<{ title: string }>()')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('defineProps')
    expect(r.error!.message).toContain('必须接收其返回值')
  })

  it('裸 defineEmits() 报错', async () => {
    const r = await compile('defineEmits()')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('defineEmits')
  })

  it('裸 defineModel() 报错', async () => {
    const r = await compile('defineModel()')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('defineModel')
  })

  it('报错信息同时给出赋值与解构两种正确写法', async () => {
    const r = await compile('defineProps<{ a: string }>()')
    expect(r.error!.message).toContain('const props =')
    expect(r.error!.message).toContain('const { x } =')
  })
})

describe('对照：接收返回值的写法不受影响', () => {
  it('const props = defineProps<{...}>() 正常生成 properties', async () => {
    const r = await compile(
      'const props = defineProps<{ title: string }>()',
      '<view>{{ title }}</view>',
    )
    expect(r.error).toBeNull()
    expect(r.js).toContain('title')
    expect(r.js).toMatch(/properties:[\s\S]*title/)
  })

  it('defineModel 接收返回值正常', async () => {
    const r = await compile('const m = defineModel<string>()', '<view>{{ m }}</view>')
    expect(r.error).toBeNull()
  })
})
