import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { compileVueContent } from './test-utils'

/**
 * 产物完整性：宿主注入的标识符必须在其使用处有明确来源。
 *
 * 背景：多轮审查发现的缺陷多为"产物语法合法，但引用了不存在的变量"
 * （典型：v-for 内 v-model 使用了未声明的 __vmsProxyRefs）。仅做语法校验
 * 无法发现这类问题，因此这里对每个产物统一校验：
 *   - __vmsProps / __vmsContext 必须是 setup 形参
 *   - __vmsProxyRefs / __vmsRenderState / __vmsInternalState 使用则须有 const 声明
 *   - __fun_N 被引用则须有对应的 function 定义
 */

const scenarios: Array<[string, string, string]> = [
  ['原生 v-model', '<input v-model="a" />', "const a = ref('')"],
  ['组件 v-model', '<MyInput v-model="a" />', "const a = ref('')"],
  [
    'v-for 内原生 v-model',
    '<view v-for="(it,i) in list" :key="it.id"><input v-model="it.a" /></view>',
    "const a = ref('')",
  ],
  [
    'v-for 内组件 v-model',
    '<view v-for="(it,i) in list" :key="it.id"><MyInput v-model="it.a" /></view>',
    "const a = ref('')",
  ],
  [
    '解构 v-for 内 v-model',
    '<view v-for="({ id, a }, i) in list" :key="id"><input v-model="a" /></view>',
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
    'const a = ref(1)\nconst onTap = (x: any, y: number) => x',
  ],
  ['内联箭头事件', '<button @tap="() => { a.value++ }">x</button>', 'const a = ref(1)'],
  [
    'computed 绑定',
    '<view :title="fmt(a)">x</view>',
    'const a = ref(1)\nconst fmt = (v: number) => String(v)',
  ],
  [
    'v-for 内 computed 绑定',
    '<view v-for="(it,i) in list" :key="it.id"><text :title="fmt(it)">{{ i }}</text></view>',
    'const a = ref(1)\nconst fmt = (v: any) => String(v)',
  ],
  [
    '作用域插槽',
    '<MyList><template #row="{ item }"><text>{{ item.x }}</text></template></MyList>',
    'const a = ref(1)',
  ],
  ['defineModel 作为目标', '<input v-model="m" />', 'const m = defineModel<string>()'],
  ['解构 props', '<view>{{ p.x }}</view>', 'const p = defineProps<{ x: number }>()'],
  ['v-model 修饰符', '<input v-model.number.trim="a" />', "const a = ref('')"],
  [
    'v-model + 显式事件',
    '<input v-model="a" @input="onIn" />',
    "const a = ref('')\nconst onIn = (e: any) => e",
  ],
]

const sharedDecls = [
  "import MyInput from './MyInput.vue'",
  "import MyList from './MyList.vue'",
  "import { ref, defineModel } from '@unmagic/vue-mini'",
  'const list = ref([{ id: 1, a: 1 }])',
  'const rows = ref([{ id: 1, cs: [{ id: 1, a: 1 }] }])',
]

describe('产物完整性：宿主注入标识符', () => {
  it.each(scenarios)('%s', async (_name, template, decl) => {
    const vueContent = [
      '<template>' + template + '</template>',
      '<script setup lang="ts">',
      ...sharedDecls,
      decl,
      '</script>',
    ].join('\n')

    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()

    // 产物必须是合法 JS/TS（测试管线不跑 Babel，故启用 TS 插件）
    expect(() => parse(js, { sourceType: 'module', plugins: ['typescript'] })).not.toThrow()

    const setupParams = js.match(/setup\(([^)]*)\)/)?.[1] ?? ''
    for (const name of ['__vmsProps', '__vmsContext']) {
      if (js.includes(name)) {
        expect(setupParams).toContain(name)
      }
    }

    for (const name of ['__vmsProxyRefs', '__vmsRenderState', '__vmsInternalState']) {
      if (new RegExp(name + '\\s*\\.').test(js)) {
        expect(js).toMatch(new RegExp('const ' + name + '\\s*='))
      }
    }

    const funIndexes = new Set([...js.matchAll(/__fun_(\\d+)/g)].map((m) => m[1]))
    for (const index of funIndexes) {
      expect(js).toMatch(new RegExp('function __fun_' + index + '\\b'))
    }
  })
})
