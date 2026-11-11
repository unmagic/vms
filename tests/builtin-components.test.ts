import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * Vue 内置组件必须编译报错。
 *
 * 回归背景：这类标签原先作为**未注册的自定义组件**进入产物
 * （`usingComponents` 中没有对应条目），小程序运行时不渲染任何内容，
 * 且不报错——与 v-html 属于同一类静默失效。
 *
 * 拦截名单与 Vue 自身的 `isCoreComponent` 判定对齐（含小写变体）：
 * Teleport/teleport、Suspense/suspense、KeepAlive/keep-alive、
 * BaseTransition/base-transition，外加 Transition/TransitionGroup
 * 与小写 `component`（动态组件）。
 */
function compile(tpl: string) {
  return compileVueContent(
    [
      '<template>' + tpl + '</template>',
      '<script setup lang="ts">',
      "import { ref } from '@unmagic/vue-mini'",
      "const comp = ref('view')",
      '</script>',
    ].join('\n'),
  )
}

const BUILT_INS = [
  'Teleport',
  'teleport',
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'keep-alive',
  'Suspense',
  'suspense',
  'BaseTransition',
  'base-transition',
  'component',
]

describe('Vue 内置组件：编译期报错', () => {
  it.each(BUILT_INS)('%s 报错并给出替代方案', async (tag) => {
    const r = await compile('<' + tag + '><view>a</view></' + tag + '>')
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toContain(tag)
  })
})

describe('对照：正常标签与用户组件不受影响', () => {
  it('小程序原生标签正常编译', async () => {
    const r = await compile('<view><text>a</text><button>b</button></view>')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('<text>')
  })

  it('用户自定义组件正常编译', async () => {
    const r = await compile('<MyCard :title="comp" />')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('MyCard')
  })

  it('第三方组件库标签正常编译', async () => {
    const r = await compile('<t-button :title="comp">b</t-button>')
    expect(r.error).toBeNull()
  })

  it('仅大写 Component 不拦截（与 Vue 判定一致：只有小写 component 是动态组件）', async () => {
    const r = await compile('<Component :title="comp" />')
    expect(r.error).toBeNull()
  })
})
