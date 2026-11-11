import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * WXML 侧产物完整性：指令产出的属性必须自洽。
 *
 * 与 host-identifier-integrity.test.ts（JS 侧）互补，这里校验模板侧不变式：
 *   1. 每个 bind:* 指向的 `__fun_N` 必须在 JS 中有对应定义
 *   2. 每个 `data-*` 索引键必须在 setter 中被解构使用
 *   3. `wx:for-item` 与 `wx:for-index` 不得同名（内层会遮蔽外层）
 *   4. `wx:elif` / `wx:else` 必须有前置 `wx:if`
 *
 * 这些是通用不变式：新增指令/特性若破坏了任一条，测试会直接失败，
 * 无需为每个新组合单独补写断言。
 */

const scenarios: Array<[string, string, string]> = [
  ['原生 v-model', '<input v-model="a" />', "const a = ref('')"],
  ['组件 v-model', '<MyInput v-model="a" />', "const a = ref('')"],
  [
    'v-for 内 v-model',
    '<view v-for="(it,i) in list" :key="it.id"><input v-model="it.a" /></view>',
    "const a = ref('')",
  ],
  [
    '嵌套 v-for 内 v-model',
    '<view v-for="(r,ri) in rows" :key="r.id"><view v-for="(c,ci) in r.cs" :key="c.id"><input v-model="c.a" /></view></view>',
    "const a = ref('')",
  ],
  [
    'v-for 内事件传参',
    '<view v-for="(it,i) in list" :key="it.id"><button @tap="onTap(it,i)">x</button></view>',
    'const onTap = (x: any, y: number) => x',
  ],
  [
    '内联箭头事件',
    '<button @tap="() => onTap(a)">x</button>',
    'const a = ref(1)\nconst onTap = (v: number) => v',
  ],
  [
    'v-model 与显式事件共存',
    '<input v-model="a" @input="onIn" />',
    "const a = ref('')\nconst onIn = (e: any) => e",
  ],
  [
    'v-if / v-else-if / v-else 链',
    '<view v-if="a">1</view><view v-else-if="b">2</view><view v-else>3</view>',
    'const a = ref(false)\nconst b = ref(false)',
  ],
  [
    'v-for 内 v-if 链',
    '<view v-for="(it,i) in list" :key="i"><text v-if="it.a">1</text><text v-else>2</text></view>',
    'const a = ref(false)',
  ],
  [
    'template v-for',
    '<template v-for="(it,i) in list" :key="it.id"><view>{{ it.a }}</view><text>{{ i }}</text></template>',
    'const a = ref(false)',
  ],
  [
    'v-show 在 v-for 内',
    '<view v-for="(it,i) in list" :key="i"><text v-show="it.a">x</text></view>',
    'const a = ref(1)',
  ],
  [
    'class/style/WXS 在 v-for 内',
    '<view v-for="(it,i) in list" :key="i"><text :class="{ on: it.a }" :style="{ color: it.c }">x</text></view>',
    'const a = ref(1)',
  ],
  ['默认插槽', '<MyList><view>content</view></MyList>', 'const a = ref(1)'],
  ['具名插槽', '<MyList><template #head><view>h</view></template></MyList>', 'const a = ref(1)'],
  [
    '作用域插槽',
    '<MyList><template #row="{ item }"><text>{{ item.x }}</text></template></MyList>',
    'const a = ref(1)',
  ],
  [
    '作用域插槽别名',
    '<MyList><template #row="{ item: it }"><text>{{ it.x }}</text></template></MyList>',
    'const a = ref(1)',
  ],
  [
    '插槽出口（提供方）',
    '<view v-for="(it,i) in list" :key="it.id"><slot name="row" :item="it" :index="i" /></view>',
    'const a = ref(1)',
  ],
]

describe('WXML 侧产物完整性', () => {
  it.each(scenarios)('%s', async (_name, template, decl) => {
    const vueContent = [
      '<template>' + template + '</template>',
      '<script setup lang="ts">',
      "import MyInput from './MyInput.vue'",
      "import MyList from './MyList.vue'",
      "import { ref } from '@unmagic/vue-mini'",
      "const list = ref([{ id: 1, a: true, c: 'red', x: 1 }])",
      'const rows = ref([{ id: 1, cs: [{ id: 1, a: true }] }])',
      decl,
      '</script>',
    ].join('\n')

    const { wxml, js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()

    // 事件处理函数必须有定义
    for (const match of wxml.matchAll(/bind:[^=]+="([^"]+)"/g)) {
      const handler = match[1]
      if (handler.startsWith('__fun_')) {
        expect(js).toMatch(new RegExp('function ' + handler + '\\b'))
      }
    }

    // data-* 索引键必须在 setter 解构中使用
    for (const match of wxml.matchAll(/data-([a-z])=/g)) {
      expect(js).toMatch(new RegExp('\\b' + match[1] + '\\s*:'))
    }

    // for-item 与 for-index 不得同名
    const itemNames = [...wxml.matchAll(/wx:for-item="([^"]+)"/g)].map((m) => m[1])
    const indexNames = [...wxml.matchAll(/wx:for-index="([^"]+)"/g)].map((m) => m[1])
    for (const indexName of indexNames) {
      expect(itemNames).not.toContain(indexName)
    }

    // elif / else 必须有前置 if
    if (/wx:elif=|wx:else/.test(wxml)) {
      expect(wxml).toMatch(/wx:if=/)
    }
  })
})
