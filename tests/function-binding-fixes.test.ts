import { describe, expect, it } from 'vitest'
import { compileVueContent } from './test-utils'

// 修复验证:函数绑定场景的 6 类缺陷

describe('fix1: update expression handler', () => {
  it('@tap="count++" 生成可用的桥接函数', async () => {
    const { js, wxml, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
</script>
<template><button @tap="count++">{{ count }}</button></template>`)
    expect(error).toBeNull()
    expect(wxml).toMatch(/bind:tap="__fun_\d+"/)
    expect(js).toContain('__vmsProxyRefs.count++')
  })
})

describe('fix1b: unsupported form now throws', () => {
  it('@tap="obj?.method" 报编译错误而非空事件', async () => {
    const { error } = await compileVueContent(`<script setup lang="ts">
const obj = { method: () => {} }
</script>
<template><button @tap="obj?.method">x</button></template>`)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('暂不支持的事件处理表达式')
  })
})

describe('fix2: member callee on ref', () => {
  it('@tap="obj.method()" callee 改写为 __vmsProxyRefs.obj', async () => {
    const { js, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const obj = ref({ method: (e: unknown) => {} })
</script>
<template><button @tap="obj.method()">x</button></template>`)
    expect(error).toBeNull()
    expect(js).toContain('__vmsProxyRefs.obj.method(__vms_event)')
  })
})

describe('fix2b: import callee not rewritten', () => {
  it('@tap="router.back()" import 变量保持原样', async () => {
    const { js, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
import router from '@/utils/router'
</script>
<template><button @tap="router.back()">x</button></template>`)
    expect(error).toBeNull()
    expect(js).toContain('router.back(__vms_event)')
    expect(js).not.toContain('__vmsProxyRefs.router')
  })
})

describe('fix3: short-expr rewrites optional chain vars', () => {
  it('@tap="flag && save(user?.id)" user 被改写', async () => {
    const { js, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const flag = ref(true)
const user = ref<{ id: number } | null>({ id: 1 })
const save = (id: number) => {}
</script>
<template><button @tap="flag && save(user?.id)">x</button></template>`)
    expect(error).toBeNull()
    expect(js).toContain('__vmsProxyRefs.flag && __vmsProxyRefs.save(__vmsProxyRefs.user?.id)')
  })
})

describe('fix3b: computed with optional chain rewrites vars', () => {
  it(':title="fmt(user?.name)" user 被改写', async () => {
    const { js, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref<{ name: string } | null>({ name: 'a' })
const fmt = (s: string) => s
</script>
<template><view :title="fmt(user?.name)">x</view></template>`)
    expect(error).toBeNull()
    expect(js).toContain('__vmsProxyRefs.fmt(__vmsProxyRefs.user?.name)')
  })
})

describe('fix4: object literal arg with import var', () => {
  it('@tap="onTap({ fmt: formatDate })" import 变量直接引用', async () => {
    const { js, error } = await compileVueContent(`<script setup lang="ts">
import { formatDate } from '@/utils/date'
const onTap = (o: { fmt: (d: Date) => string }) => {}
</script>
<template><button @tap="onTap({ fmt: formatDate })">x</button></template>`)
    expect(error).toBeNull()
    expect(js).toContain('fmt: formatDate')
    expect(js).not.toContain('__vmsProxyRefs.formatDate')
  })
})

describe('fix5: member callee with index arg in v-for', () => {
  it('@tap="logger.log(index)" data-a 传索引且 dataset 解构', async () => {
    const { js, wxml, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1 }])
const logger = { log: (v: number) => {} }
</script>
<template><view v-for="(item, index) in list" :key="item.id" @tap="logger.log(index)">{{ item.id }}</view></template>`)
    expect(error).toBeNull()
    expect(wxml).toContain('data-a="{{[index]}}"')
    expect(js).toMatch(/const \{\s+a: \[index\]\s+\} = __vms_event\.currentTarget\.dataset/)
    expect(js).toContain('__vmsProxyRefs.logger.log(index)')
  })
})

describe('fix6: short-expr declares v-for item', () => {
  it('@tap="item.active && log(item.id)" item 被声明为局部变量', async () => {
    const { js, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, active: true }])
const log = (v: number) => {}
</script>
<template><view v-for="(item, index) in list" :key="item.id" @tap="item.active && log(item.id)">{{ item.id }}</view></template>`)
    expect(error).toBeNull()
    expect(js).toMatch(/const item = __vmsProxyRefs\.list\[index\]/)
    expect(js).toContain('item.active && __vmsProxyRefs.log(item.id)')
  })
})

describe('fix7: no dataKey collision between handler kinds', () => {
  it('同一节点混用内联箭头与直接调用,data 键不重复', async () => {
    const { wxml, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1 }])
const log = (v: number) => {}
</script>
<template>
  <view v-for="(item, index) in list" :key="item.id" @tap="() => log(item.id)" @longpress="log(index)">{{ item.id }}</view>
</template>`)
    expect(error).toBeNull()
    expect(wxml).toContain('data-a=')
    expect(wxml).toContain('data-b=')
    expect(wxml).toMatch(/bind:tap="__fun_\d+"/)
    expect(wxml).toMatch(/bind:longpress="__fun_\d+"/)
  })
})

describe('regression: baseline behaviors intact', () => {
  it('@tap="increment" 裸标识符仍走 this[key] 注入', async () => {
    const { wxml, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
const increment = () => { count.value++ }
</script>
<template><button @tap="increment">{{ count }}</button></template>`)
    expect(error).toBeNull()
    expect(wxml).toContain('bind:tap="increment"')
  })

  it('@tap="onTap(item.id, index)" 直接调用带参仍正确', async () => {
    const { js, wxml, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1 }])
const onTap = (id: number, i: number) => {}
</script>
<template><view v-for="(item, index) in list" :key="item.id" @tap="onTap(item.id, index)">{{ item.id }}</view></template>`)
    expect(error).toBeNull()
    expect(wxml).toContain('data-a="{{[index]}}"')
    expect(js).toMatch(/const item = __vmsProxyRefs\.list\[index\]/)
    expect(js).toContain('onTap(item.id, index)')
  })

  it('v-for item 成员调用 @tap="item.onTap(item.id)" 仍正确', async () => {
    const { js, wxml, error } = await compileVueContent(`<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, onTap: (id: number) => {} }])
</script>
<template><view v-for="(item, index) in list" :key="item.id" @tap="item.onTap(item.id)">{{ item.id }}</view></template>`)
    expect(error).toBeNull()
    expect(wxml).toContain('data-a="{{[index]}}"')
    expect(js).toMatch(/const item = __vmsProxyRefs\.list\[index\]/)
    expect(js).toContain('item.onTap(item.id)')
  })
})
