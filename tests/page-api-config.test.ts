import { describe, expect, it } from 'vitest'
import { parse as babelParse } from '@babel/parser'
import type { Expression, ObjectExpression } from '@babel/types'
import * as t from '@babel/types'
import { traverse } from '../src/utils/babelTraverse'
import { compileVueContent } from './test-utils'

/** 从编译产物中取出 defineComponent() 调用的实参列表 */
function getDefineComponentArgs(js: string): Array<Expression> {
  const ast = babelParse(js, { sourceType: 'module', plugins: ['typescript'] })
  let args: Array<Expression> = []
  traverse(ast, {
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee, { name: 'defineComponent' })) {
        args = path.node.arguments as Array<Expression>
      }
    },
  })
  return args
}

/** 取出 defineComponent 第二个参数（vue-mini Config）解析为字面量对象 */
function getComponentConfig(js: string): Record<string, unknown> | null {
  const secondArg = getDefineComponentArgs(js)[1]
  if (!secondArg || !t.isObjectExpression(secondArg)) return null
  return readConfigObject(secondArg)
}

function readConfigObject(node: ObjectExpression): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const prop of node.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && t.isBooleanLiteral(prop.value)) {
      config[prop.key.name] = prop.value.value
    }
  }
  return config
}

/** 构造一个 script setup 的测试 SFC；lang 传空字符串表示不写 lang 属性 */
function createSfc(script: string, lang: string = 'ts'): string {
  const langAttr = lang ? ` lang="${lang}"` : ''
  return `
<template>
  <view>content</view>
</template>
<script setup${langAttr}>
${script}
</script>
`
}

describe('页面 API 配置注入（defineComponent 第二个参数）', () => {
  it('1. 顶层同时使用三个页面 API 时按固定顺序注入配置', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll, onShareAppMessage, onShareTimeline } from '@unmagic/vue-mini'

onPageScroll(() => {})
onShareAppMessage(() => ({ title: 'title' }))
onShareTimeline(() => ({ title: 'timeline' }))`),
    )

    expect(error).toBeNull()
    expect(JSON.stringify(getComponentConfig(js))).toBe(
      JSON.stringify({ listenPageScroll: true, canShareToOthers: true, canShareToTimeline: true }),
    )
  })

  it('2. 仅使用 onPageScroll 时只注入 listenPageScroll', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll } from '@unmagic/vue-mini'

onPageScroll(() => {})`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ listenPageScroll: true })
  })

  it('3. 仅使用 onShareAppMessage 时只注入 canShareToOthers', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onShareAppMessage } from '@unmagic/vue-mini'

onShareAppMessage(() => ({ title: 'title' }))`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ canShareToOthers: true })
  })

  it('4. 仅使用 onShareTimeline 时只注入 canShareToTimeline', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onShareTimeline } from '@unmagic/vue-mini'

onShareTimeline(() => ({ title: 'timeline' }))`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ canShareToTimeline: true })
  })

  it('5. 未使用页面 API 时保持单参数调用', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { ref, onLoad } from '@unmagic/vue-mini'

const message = ref('')
onLoad(() => {
  message.value = 'loaded'
})`),
    )

    expect(error).toBeNull()
    expect(getDefineComponentArgs(js)).toHaveLength(1)
    expect(getComponentConfig(js)).toBeNull()
  })

  it('6. 函数体内嵌套调用不注入（只判断当前 script 顶层）', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll, onShareAppMessage } from '@unmagic/vue-mini'

function registerPageHooks() {
  onPageScroll(() => {})
  onShareAppMessage(() => ({ title: 'title' }))
}

registerPageHooks()`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toBeNull()
  })

  it('7. 生命周期回调等嵌套调用不注入', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onLoad, onShareTimeline } from '@unmagic/vue-mini'

onLoad(() => {
  onShareTimeline(() => ({ title: 'timeline' }))
})`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toBeNull()
  })

  it('8. 条件分支内的顶层调用不注入', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll } from '@unmagic/vue-mini'

if (typeof wx !== 'undefined') {
  onPageScroll(() => {})
}`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toBeNull()
  })

  it('9. 非 script setup lang="ts" 不注入', async () => {
    for (const lang of ['', 'js']) {
      const { js, error } = await compileVueContent(
        createSfc(
          `import { onPageScroll } from '@unmagic/vue-mini'

onPageScroll(() => {})`,
          lang,
        ),
      )

      expect(error).toBeNull()
      expect(getComponentConfig(js)).toBeNull()
    }
  })

  it('10. 与其他模块导入的同名函数不注入', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll } from '@/utils/page'

onPageScroll(() => {})`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toBeNull()
  })

  it('11. 支持导入别名', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll as listenScroll, onShareAppMessage as share } from '@unmagic/vue-mini'

listenScroll(() => {})
share(() => ({ title: 'title' }))`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ listenPageScroll: true, canShareToOthers: true })
  })

  it('12. 支持命名空间导入', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import * as vueMini from '@unmagic/vue-mini'

vueMini.onShareTimeline(() => ({ title: 'timeline' }))`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ canShareToTimeline: true })
  })

  it('13. 只识别 @unmagic/vue-mini，其他包（包括 @vue-mini/core）不注入', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll } from '@vue-mini/core'

onPageScroll(() => {})`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toBeNull()
  })

  it('14. 页面组件同样注入配置', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onPageScroll } from '@unmagic/vue-mini'

onPageScroll(() => {})`),
      true,
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ listenPageScroll: true })
  })

  it('15. type-only 导入不注入', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import type { onPageScroll } from '@unmagic/vue-mini'

onPageScroll(() => {})`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toBeNull()
  })

  it('16. defineOptions 与页面 API 同时使用时互不影响', async () => {
    const { js, json, error } = await compileVueContent(
      createSfc(`import { onShareAppMessage } from '@unmagic/vue-mini'

defineOptions({ styleIsolation: 'shared' })

onShareAppMessage(() => ({ title: 'title' }))`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ canShareToOthers: true })
    expect(json?.styleIsolation).toBe('shared')
  })

  it('17. defineExpose 与页面 API 同时使用时保留 export 方法', async () => {
    const { js, error } = await compileVueContent(
      createSfc(`import { onShareTimeline } from '@unmagic/vue-mini'

function refresh() {}

defineExpose({ refresh })

onShareTimeline(() => ({ title: 'timeline' }))`),
    )

    expect(error).toBeNull()
    expect(getComponentConfig(js)).toEqual({ canShareToTimeline: true })
    expect(js).toContain('export')
    expect(js).toContain('refresh')
  })

  it('18. 纯模板组件保持单参数调用', async () => {
    const { js, error } = await compileVueContent(`
<template>
  <view>template only</view>
</template>
`)

    expect(error).toBeNull()
    expect(getDefineComponentArgs(js)).toHaveLength(1)
  })
})
