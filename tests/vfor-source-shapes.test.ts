import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * v-for 源表达式的产物形态。
 *
 * 说明：v-for 的 source 位于 **WXML 绑定**而非桥接函数中，
 * 因此 setup ref 在此处**不经过** __vmsProxyRefs，而是：
 *  - 纯引用/成员访问 → 直接绑定 {{local}} / {{local.items}}，由 setData 解包 ref
 *  - 含方法调用/条件等需降级的表达式 → 编译为 WXS 函数，变量以**参数**传入
 * 全局与 import 变量在 WXS 中作为自由变量或参数，行为一致。
 */
describe('v-for 源表达式的产物形态', () => {
  const compile = (src: string) =>
    compileVueContent(
      [
        '<template><view v-for="(it, i) in ' + src + '" :key="i">{{ it }}</view></template>',
        '<script setup lang="ts">',
        "import { ref } from '@unmagic/vue-mini'",
        'const local = ref([1])',
        'const other = ref([2])',
        "const key = ref('k')",
        'const flag = ref(true)',
        '</script>',
      ].join('\n'),
    )

  it('纯引用直接绑定，不包装 __vmsProxyRefs', async () => {
    const r = await compile('local')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('wx:for="{{local}}"')
    expect(r.wxml).not.toContain('__vmsProxyRefs')
  })

  it('成员访问直接绑定', async () => {
    const r = await compile('local.items')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('wx:for="{{local.items}}"')
  })

  it('含方法调用时降级为 WXS 并把变量作为参数传入', async () => {
    const r = await compile('local.filter((x) => x)')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('wms_wxs.__wxs_0(local)')
    // 变量以参数形式出现，而非 __vmsProxyRefs 属性访问
    expect(r.wxml).not.toContain('__vmsProxyRefs')
  })

  it('三元表达式把所有分支变量作为参数传入', async () => {
    const r = await compile('flag ? local : other')
    expect(r.error).toBeNull()
    expect(r.wxml).toContain('__wxs_0(flag, local, other)')
  })
})
