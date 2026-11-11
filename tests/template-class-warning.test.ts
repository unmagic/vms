import { describe, it, expect, vi } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * <template> 上的 class/style 不会生效。
 *
 * <template> 编译为 <block>（官方称虚拟块），不产生真实节点。
 * 已用微信开发者工具模拟器实测确认：querySelectorAll('block') 返回空数组，
 * 而同样选择 view 能查到元素——证明 block 无 DOM 存在，其上的 class/style 无效。
 */
function compile(tpl: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      'const on = ref(true)',
      '</script>',
    ].join('\n'),
  )
}

function warnedAboutBlock(spy: ReturnType<typeof vi.spyOn>): boolean {
  return spy.mock.calls.some((c: unknown[]) => String(c[0]).includes('虚拟块'))
}

describe('<template> 上的 class/style 告警', () => {
  it('template + class 触发告警', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await compile('<template class="wrap"><view>a</view></template>')
    const warned = warnedAboutBlock(spy)
    spy.mockRestore()
    expect(warned).toBe(true)
  })

  it('template + :class 触发告警', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await compile('<template :class="on"><view>a</view></template>')
    const warned = warnedAboutBlock(spy)
    spy.mockRestore()
    expect(warned).toBe(true)
  })

  it('仅 :style（无 class）不告警', async () => {
    // 告警只针对 class：style 的自动注入（根节点为 template）用户无从移走，
    // 且手写 :style 在 block 上同样无效但极少见，保持最小告警面
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await compile('<template :style="{ color: \'red\' }"><view>a</view></template>')
    const warned = warnedAboutBlock(spy)
    spy.mockRestore()
    expect(warned).toBe(false)
  })
})

describe('对照：普通元素与无 class 的 template 不告警', () => {
  it('view 上的 class 不告警', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await compile('<view class="wrap"><text>a</text></view>')
    const warned = warnedAboutBlock(spy)
    spy.mockRestore()
    expect(warned).toBe(false)
  })

  it('无 class/style 的 template（仅 v-for）不告警', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await compile('<template v-for="i in [1,2]" :key="i"><view>{{ i }}</view></template>')
    const warned = warnedAboutBlock(spy)
    spy.mockRestore()
    expect(warned).toBe(false)
  })
})
