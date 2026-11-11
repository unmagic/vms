import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { compileVueContent } from './test-utils'

/**
 * 产物完整性：任何对 `__vmsProxyRefs` 的访问都必须有对应声明。
 *
 * 回归背景：v-model 在 v-for 内的桥接函数会生成
 * `const it = __vmsProxyRefs.list[i]`，但 `__vmsProxyRefs` 的生成
 * 曾被 "hasInlineFunctions || hasComputedBindings" 门控——当目标本身是
 * v-for 变量时不会注册组件 data，该门控为假，于是产出引用未定义变量的代码
 * （模块级 `proxyRefs` 也未导入），运行时抛 ReferenceError。
 */
describe('产物完整性：__vmsProxyRefs 必须成对声明', () => {
  const cases: Array<[string, string, string]> = [
    [
      '单层 v-for 内的 item 属性',
      '<view v-for="(it, i) in list" :key="it.id"><input v-model="it.a" /></view>',
      "const list = ref([{ id: 1, a: '' }])",
    ],
    [
      '嵌套 v-for 内的内层 item',
      '<view v-for="(r, ri) in rows" :key="r.id"><view v-for="(c, ci) in r.cs" :key="c.id"><input v-model="c.a" /></view></view>',
      "const rows = ref([{ id: 1, cs: [{ id: 1, a: '' }] }])",
    ],
    [
      '解构式 v-for 的变量',
      '<view v-for="({ id, a }, i) in list" :key="id"><input v-model="a" /></view>',
      "const list = ref([{ id: 1, a: '' }])",
    ],
    [
      'template v-for 内的 item',
      '<template v-for="(it, i) in list" :key="it.id"><input v-model="it.a" /></template>',
      "const list = ref([{ id: 1, a: '' }])",
    ],
    [
      'v-for 内的深层属性（组件）',
      '<view v-for="(it, i) in list" :key="it.id"><MyInput v-model="it.deep.name" /></view>',
      "const list = ref([{ id: 1, deep: { name: '' } }])",
    ],
    [
      'v-for 内绑定 setup 变量',
      '<view v-for="(it, i) in list" :key="it.id"><input v-model="other" /></view>',
      "const list = ref([{ id: 1 }])\nconst other = ref('')",
    ],
  ]

  it.each(cases)('%s：使用了就必须声明', async (_name, template, decl) => {
    const usesComponent = template.includes('MyInput')
    const vueContent = `<template>${template}</template>
<script setup lang="ts">
${usesComponent ? "import MyInput from './MyInput.vue'" : ''}
import { ref } from '@unmagic/vue-mini'
${decl}
</script>
`
    const { js, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(() => parse(js, { sourceType: 'module' })).not.toThrow()

    const usesProxyRefs = js.includes('__vmsProxyRefs.')
    if (usesProxyRefs) {
      // 必须存在 const __vmsProxyRefs = proxyRefs(...)
      expect(js).toContain('const __vmsProxyRefs = proxyRefs(')
      // 且必须从运行时导入 proxyRefs
      expect(js).toMatch(/import\s*\{[^}]*proxyRefs[^}]*\}\s*from\s*["']@unmagic\/vue-mini["']/)
    }
  })
})
