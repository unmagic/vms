import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { transformVueToMiniProgram } from '../src/transformer'

/**
 * 作用域插槽依赖 glass-easel 的 dynamicSlots 能力。
 * 未开启 glassEasel 时产物会带 dynamicSlots 选项却缺少 componentFramework，
 * 真机上插槽数据不传递（静默失效），因此编译期必须告警。
 *
 * 这里直接调用真实 transformer（而非 test-utils 的模拟管线），
 * 确保告警逻辑与真实构建一致。
 */
const scopedSlotSfc = `<template>
  <view v-for="(item, index) in items" :key="item.id">
    <slot name="row" :item="item" :index="index" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ id: 1 }])
</script>
`

const normalSfc = `<template>
  <view>{{ msg }}</view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const msg = ref('hi')
</script>
`

const tmpDir = join(process.cwd(), 'src', '__tmp_transformer_fixtures__')

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function compile(sfc: string): Promise<string[]> {
  await mkdir(tmpDir, { recursive: true })
  const file = join(tmpDir, 'Comp.vue')
  await writeFile(file, sfc, 'utf-8')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await transformVueToMiniProgram(file, join(tmpDir, 'out'), false, async (s) => s)
  return warn.mock.calls.map((c) => String(c[0]))
}

describe('真实 transformer：作用域插槽的 glassEasel 依赖告警', () => {
  it('1.1 使用作用域插槽但未开启 glassEasel：输出警告并指明开关', async () => {
    const warnings = await compile(scopedSlotSfc)
    const combined = warnings.join('\n')

    expect(combined).toContain('glassEasel')
    expect(combined).toContain('作用域插槽')
    // 提示应给出具体文件，便于定位
    expect(combined).toContain('Comp.vue')
  })

  it('1.2 未使用作用域插槽：不产生该警告', async () => {
    const warnings = await compile(normalSfc)
    expect(warnings.join('\n')).not.toContain('glassEasel')
  })
})
