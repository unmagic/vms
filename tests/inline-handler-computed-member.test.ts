import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 内联事件处理器中的**计算成员**。
 *
 * 回归背景：map[key] 曾只改写对象侧，得到 __vmsProxyRefs.map[key]，
 * 而 key 在 handler 作用域中未声明 → 运行时 ReferenceError。
 */
function handlerOf(js: string): string {
  const m = js.match(/function __fun_0[\s\S]*?\n {4}\}/)
  return m ? m[0].replace(/\s+/g, ' ') : 'none'
}

describe('内联处理器中的计算成员改写', () => {
  it('读取 map[key]：索引变量一并改写', async () => {
    const r = await compileVueContent(
      [
        '<template><button @tap="() => onPick(map[key])">go</button></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const map = ref<Record<string, number>>({ a: 1 })',
        "const key = ref('a')",
        'const onPick = (v: number) => console.log(v)',
        '</script>',
      ].join('\n'),
    )
    expect(r.error).toBeNull()
    const h = handlerOf(r.js)
    expect(h).toContain('__vmsProxyRefs.map[__vmsProxyRefs.key]')
    expect(h).not.toContain('.map[key]')
  })

  it('赋值 arr[idx] = v：索引变量一并改写', async () => {
    const r = await compileVueContent(
      [
        '<template><button @tap="() => { arr[idx] = 9 }">go</button></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const arr = ref([1, 2])',
        'const idx = ref(0)',
        '</script>',
      ].join('\n'),
    )
    expect(r.error).toBeNull()
    expect(handlerOf(r.js)).toContain('__vmsProxyRefs.arr[__vmsProxyRefs.idx] = 9')
  })

  it('v-for 内读取 map[key]：索引变量一并改写', async () => {
    const r = await compileVueContent(
      [
        '<template><view v-for="(it, i) in list" :key="i"><button @tap="() => onPick(it.map[it.key])">go</button></view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        "const list = ref([{ map: { a: 1 }, key: 'a' }])",
        'const onPick = (v: number) => console.log(v)',
        '</script>',
      ].join('\n'),
    )

    expect(r.error).toBeNull()
    const h = handlerOf(r.js)
    expect(h).toContain('it.map[it.key]')
  })

  it('非计算成员的属性名保留', async () => {
    const r = await compileVueContent(
      [
        '<template><button @tap="() => onPick(obj.key)">go</button></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const obj = ref({ key: 1 })',
        'const onPick = (v: number) => console.log(v)',
        '</script>',
      ].join('\n'),
    )
    expect(r.error).toBeNull()
    expect(handlerOf(r.js)).toContain('__vmsProxyRefs.obj.key')
  })
})
