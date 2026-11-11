import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * 解构式 v-for 的变量出现在**计算成员**中时的改写。
 * 回归背景：map[id] 曾只改写对象侧，得到 item.map[id]，
 * 而 id 在 WXML 作用域中并不存在 → 取值恒为 undefined。
 */
function compile(todo: string, decl: string) {
  return compileVueContent(
    [
      '<template>' + todo + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      decl,
      '</script>',
    ].join('\n'),
  )
}

describe('解构变量在计算成员中的改写', () => {
  it('map[id] 的索引改写为 item.id', async () => {
    const { wxml, error } = await compile(
      '<view v-for="{ id, map } in list" :key="id" :title="map[id]">{{ map[id] }}</view>',
      "const list = ref([{ id: 'k', map: { k: 'v' } }])",
    )
    expect(error).toBeNull()
    expect(wxml).toContain('item.map[item.id]')
    expect(wxml).not.toContain('item.map[id]')
  })

  it('嵌套计算成员逐层改写', async () => {
    const { wxml, error } = await compile(
      '<view v-for="{ id, map, list } in rows" :key="id" :title="list[map[id]]">x</view>',
      "const rows = ref([{ id: 'k', map: { k: 0 }, list: ['v'] }])",
    )
    expect(error).toBeNull()
    expect(wxml).toContain('item.list[item.map[item.id]]')
  })

  it('非计算成员的属性名不被改写', async () => {
    const { wxml, error } = await compile(
      '<view v-for="{ id, obj } in list" :key="id" :title="obj.id">x</view>',
      'const list = ref([{ id: 1, obj: { id: 9 } }])',
    )
    expect(error).toBeNull()
    expect(wxml).toContain('item.obj.id')
  })

  it('计算成员使用字面量索引时保持原样', async () => {
    const { wxml, error } = await compile(
      '<view v-for="{ id, arr } in list" :key="id" :title="arr[0]">x</view>',
      "const list = ref([{ id: 1, arr: ['v'] }])",
    )
    expect(error).toBeNull()
    expect(wxml).toContain('item.arr[0]')
  })
})
