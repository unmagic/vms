import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * v-for 的 **index** 作为方法调用基对象时的处理。
 *
 * 回归背景：v-for 的 item 与 index 都是桥接函数内的局部变量
 * （item 经 data-a 索引还原、index 由 dataset 解构）。
 * 原实现只判断 item，导致 `index.go()` 落入"外部变量"分支，
 * 被注册进 __vmsInternalState 并在运行时悬空（index is not defined）。
 */
describe('v-for index 作为调用基对象', () => {
  const compile = (call: string) =>
    compileVueContent(
      [
        '<template><view v-for="(item, index) in list" :key="index"><button @tap="' +
          call +
          '">go</button></view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const list = ref([{ go: () => 1 }])',
        '</script>',
      ].join('\n'),
    )

  it('index.go() 不注册为组件 data', async () => {
    const r = await compile('index.go()')
    expect(r.error).toBeNull()
    // index 是 v-for 局部变量，不应进入 __vmsInternalState
    const internalState = r.js.match(/__vmsInternalState = \{([\s\S]*?)\}/)?.[1] ?? ''
    expect(internalState).not.toMatch(/\bindex\b/)
    // 也不应包装为 __vmsProxyRefs.index
    expect(r.js).not.toContain('__vmsProxyRefs.index')
  })

  it('item.go() 仍走 v-for item 路径（对照）', async () => {
    const r = await compile('item.go()')
    expect(r.error).toBeNull()
    expect(r.js).toContain('__vmsProxyRefs.list[index]')
    expect(r.js).not.toContain('__vmsProxyRefs.item')
  })

  it('index.toString() 同样不注册', async () => {
    const r = await compile('index.toString()')
    expect(r.error).toBeNull()
    const internalState = r.js.match(/__vmsInternalState = \{([\s\S]*?)\}/)?.[1] ?? ''
    expect(internalState).not.toMatch(/\bindex\b/)
  })
})
