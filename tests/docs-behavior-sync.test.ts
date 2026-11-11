import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileVueContent } from './test-utils'

/**
 * 文档与行为一致性。
 *
 * README / SKILL 中的「不支持的 Vue 特性」表给每项标注了**行为**：
 *  - 「编译报错」：写了会立即失败（推荐依赖，不会静默出错）
 *  - 「静默忽略」：不报错但不生效
 * 这里逐项验证标注与实际编译结果一致，防止文档与实现脱节。
 */
function compile(tpl: string, body = 'const t = ref(1)', extra = '') {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      body,
      extra,
      '</script>',
    ].join('\n'),
  )
}

// 文档标注为「编译报错」的项：必须确实报错
const MUST_ERROR: Array<[string, string, string, string]> = [
  ['defineSlots', '<view>x</view>', 'const t = ref(1)', 'defineSlots<{ d: () => any }>()'],
  [
    'withDefaults',
    '<view>x</view>',
    'const t = ref(1)',
    "const p = withDefaults(defineProps<{ a?: string }>(), { a: 'd' })",
  ],
  ['v-html', '<view v-html="t"></view>', 'const t = ref(1)', ''],
  ['v-text', '<view v-text="t"></view>', 'const t = ref(1)', ''],
  ['v-once', '<view v-once>{{ t }}</view>', 'const t = ref(1)', ''],
  ['v-memo', '<view v-memo="[t]">{{ t }}</view>', 'const t = ref(1)', ''],
  ['v-cloak', '<view v-cloak>{{ t }}</view>', 'const t = ref(1)', ''],
  ['Teleport', '<Teleport to="b"><view>a</view></Teleport>', 'const t = ref(1)', ''],
  ['Transition', '<Transition><view>a</view></Transition>', 'const t = ref(1)', ''],
  ['KeepAlive', '<KeepAlive><view>a</view></KeepAlive>', 'const t = ref(1)', ''],
  ['Suspense', '<Suspense><view>a</view></Suspense>', 'const t = ref(1)', ''],
  ['component :is', '<component :is="t" />', 'const t = ref(1)', ''],
  ['checkbox v-model', '<checkbox v-model="t" />', 'const t = ref(false)', ''],
  ['radio v-model', '<radio v-model="t" />', 'const t = ref(false)', ''],
]

describe('文档标注「编译报错」的项确实报错', () => {
  it.each(MUST_ERROR)('%s', async (name, tpl, body, extra) => {
    const r = await compile(tpl, body, extra)
    expect(r.error, name + ' 应当编译报错（文档已标注）').not.toBeNull()
  })
})

// 整体绑定对象已改为编译报错（原先静默丢弃全部属性/事件）
describe('v-bind="obj" / v-on="obj" 已转为编译报错', () => {
  it('v-bind="obj" 报错而非静默丢弃属性', async () => {
    const r = await compile('<view v-bind="attrs">a</view>', "const attrs = ref({ id: 'x' })")
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('v-bind')
  })

  it('v-on="handlers" 报错而非静默丢弃事件', async () => {
    const r = await compile('<button v-on="h">a</button>', 'const h = ref({ tap: () => {} })')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('v-on')
  })
})

// 无小程序等价语义的事件修饰符已改为编译报错（原先静默忽略）
describe('无映射的事件修饰符已转为编译报错', () => {
  it('.prevent 报错而非静默忽略', async () => {
    const r = await compile('<form @submit.prevent="go">a</form>', 'const go = () => {}')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain('prevent')
  })

  it('有映射的 .stop 仍正常生成 catch:', async () => {
    const r = await compile('<form @submit.stop="go">a</form>', 'const go = () => {}')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('catch:submit')
  })
})

// 文档表格本身的存在性（避免文档被删改后测试静默失效）
describe('文档表格存在且包含行为列', () => {
  for (const doc of ['README.md', 'skills/vms/SKILL.md']) {
    it(doc + ' 含「行为」列与替代方案说明', () => {
      const content = readFileSync(doc, 'utf8')
      // 「行为」列是本文档的核心信息（区分"编译报错"与其他处理方式），
      // 若被删改则上面的行为断言会失去意义——这里做存在性兜底
      expect(content).toContain('行为')
      expect(content).toContain('编译报错')
      // 表格中必须逐项列出不支持的特性
      expect(content).toContain('v-html')
      expect(content).toContain('withDefaults')
    })
  }
})
