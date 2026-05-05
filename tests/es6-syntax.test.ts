import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('ES6+ 语法支持测试', () => {
  it('默认参数', async () => {
    const vueContent = `
<template>
  <div @tap="(e = {}) => { console.log(e) }"></div>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const x = ref(0)
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('console.log(e)')
  })

  it('剩余参数', async () => {
    const vueContent = `
<template>
  <div @tap="(...args) => { console.log(args) }"></div>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const x = ref(0)
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('console.log(args)')
  })

  it('类方法调用', async () => {
    const vueContent = `
<template>
  <div @tap="() => { instance.method() }"></div>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const instance = ref({ method: () => {} })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('__vmsProxyRefs.instance.method()')
  })

  it('Promise链式调用', async () => {
    const vueContent = `
<template>
  <div @tap="() => { promise.then(v => result = v).catch(e => error = e) }"></div>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const promise = ref(Promise.resolve(1))
const result = ref(null)
const error = ref(null)
</script>
`
    const { js, error: compileError } = await compileVueContent(vueContent)
    expect(compileError).toBeNull()
    expect(js).toContain('__vmsProxyRefs.promise.then')
    expect(js).toContain('__vmsProxyRefs.result = v')
    expect(js).toContain('__vmsProxyRefs.error = e')
  })

  it('Symbol使用', async () => {
    const vueContent = `
<template>
  <div @tap="() => { const sym = Symbol('key'); console.log(sym) }"></div>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const x = ref(0)
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain("const sym = Symbol('key')")
    expect(js).toContain('console.log(sym)')
  })

  it('Map/Set操作', async () => {
    const vueContent = `
<template>
  <div @tap="() => { myMap.set(key, value); mySet.add(item) }"></div>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const myMap = ref(new Map())
const mySet = ref(new Set())
const key = ref('k')
const value = ref('v')
const item = ref('i')
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('__vmsProxyRefs.myMap.set(__vmsProxyRefs.key, __vmsProxyRefs.value)')
    expect(js).toContain('__vmsProxyRefs.mySet.add(__vmsProxyRefs.item)')
  })
})
