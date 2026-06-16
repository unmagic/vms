import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('内联事件处理器 - v-for 场景', () => {
  it('单个 v-for，修改对象属性', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { if (item.active) { item.count++ } }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([
  { name: '项目1', count: 0, active: true }
])
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('data-a="{{[index]}}"')
    expect(js).toMatch(/const\s*{\s*a:\s*\[index\]\s*}\s*=\s*__vms_event\.currentTarget\.dataset/)
    expect(js).toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('if (item.active)')
    expect(js).toContain('item.count++')
  })

  it('单个 v-for，只读取属性', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { if (item.active) { selectedId = item.id } }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1', id: 1, active: true }])
const selectedId = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('if (item.active)')
    expect(js).toContain('__vmsProxyRefs.selectedId = item.id')
  })

  it('使用 1 次，不创建引用', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { item.count++ }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1', count: 0 }])
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).not.toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('__vmsProxyRefs.list[index].count++')
  })

  it('基础类型自增，不创建引用', async () => {
    const vueContent = `
<template>
  <div v-for="(num, index) of numbers" @tap="() => { num++ }">
    {{ num }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const numbers = ref([1, 2, 3])
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).not.toContain('const num = __vmsProxyRefs.numbers[index]')
    expect(js).toContain('__vmsProxyRefs.numbers[index]++')
  })

  it('重新赋值 item，不创建引用', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { item = newItem }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1' }])
const newItem = ref({ name: '新项目' })
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).not.toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('__vmsProxyRefs.list[index] = __vmsProxyRefs.newItem')
  })

  it('基础类型只读，创建引用', async () => {
    const vueContent = `
<template>
  <div v-for="(num, index) of numbers" @tap="() => { console.log(num); selectedNum = num }">
    {{ num }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const numbers = ref([1, 2, 3])
const selectedNum = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('const num = __vmsProxyRefs.numbers[index]')
    expect(js).toContain('console.log(num)')
    expect(js).toContain('__vmsProxyRefs.selectedNum = num')
  })

  it('嵌套 v-for', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list">
    <div v-for="(child, childIndex) of item.children" @tap="() => { if (child.active) { child.count++; item.totalCount++ } }">
      {{ child.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([
  { 
    children: [{ name: '子项1', count: 0, active: true }],
    totalCount: 0
  }
])
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('data-a="{{[index,childIndex]}}"')
    expect(js).toMatch(
      /const\s*{\s*a:\s*\[index,\s*childIndex\]\s*}\s*=\s*__vms_event\.currentTarget\.dataset/,
    )
    expect(js).toContain('const child = __vmsProxyRefs.')
    expect(js).toContain('if (child.active)')
    expect(js).toContain('child.count++')
  })

  it('混合使用（有重新赋值），不创建引用', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { item.count++; item = newItem }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1', count: 0 }])
const newItem = ref({ name: '新项目', count: 0 })
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).not.toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('__vmsProxyRefs.list[index].count++')
    expect(js).toContain('__vmsProxyRefs.list[index] = __vmsProxyRefs.newItem')
  })

  it('v-for 中使用外部变量和 v-for 变量混合', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { if (item.id === selectedId) { item.selected = !item.selected; updateCount++ } }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1', id: 1, selected: false }])
const selectedId = ref(1)
const updateCount = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('if (item.id === __vmsProxyRefs.selectedId)')
    expect(js).toContain('item.selected = !item.selected')
    expect(js).toContain('__vmsProxyRefs.updateCount++')
  })

  it('v-for 下的函数调用，传参数', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="onClick(name, age, item, index, otherFun(otherName))"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1 }])
const name = ref('张三')
const age = ref(20)
const otherName = ref('李四')
function onClick(n: string, a: number, itm: any, idx: number, other: string) {
  console.log(n, a, itm, idx, other)
}
function otherFun(n: string) {
  return n
}
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(wxml).toContain('data-a=')
    expect(js).toMatch(/onClick/)
  })

  it('v-for 中函数内部声明与 v-for 变量同名的局部变量', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { const item = { id: 999, name: '临时项' }; console.log(item.name); tempItem = item }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1' }])
const tempItem = ref(null)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toMatch(/const item = {\s*id: 999/)
    expect(js).toContain('console.log(item.name)')
    expect(js).toContain('__vmsProxyRefs.tempItem = item')
  })

  it('v-for 中使用块作用域隔离同名变量', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { console.log(item.id); { const item = { id: 999 }; console.log(item.id); tempItem = item }; console.log(item.id) }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ name: '项目1', id: 1 }])
const tempItem = ref(null)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toMatch(/const\s*{\s*a:\s*\[index\]\s*}\s*=\s*__vms_event\.currentTarget\.dataset/)
    expect(js).toContain('console.log(item.id)')
    expect(js).toContain('__vmsProxyRefs.tempItem = item')
  })

  it('嵌套 v-for 中声明与外层变量同名的局部变量', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list">
    <div v-for="(child, childIndex) of item.children" @tap="() => { const item = { id: 999 }; console.log(item.id); child.parent = item }">
      {{ child.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([
  { 
    children: [{ name: '子项1', parent: null }]
  }
])
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toMatch(
      /const\s*{\s*a:\s*\[index,\s*childIndex\]\s*}\s*=\s*__vms_event\.currentTarget\.dataset/,
    )
    expect(js).toMatch(/const item = {\s*id: 999/)
    expect(js).toContain('console.log(item.id)')
    expect(js).toMatch(/\.parent = item/)
  })
})

describe('内联事件处理器 - 直接赋值表达式', () => {
  it('简单布尔赋值', async () => {
    const vueContent = `
<template>
  <t-button @tap="visibleRef = true">
    显示
  </t-button>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const visibleRef = ref(false)
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toContain('function __fun_')
    expect(js).toContain('(__vms_event)')
    expect(js).toContain('__vmsProxyRefs.visibleRef = true')
  })

  it('条件表达式赋值', async () => {
    const vueContent = `
<template>
  <t-button @tap="isLoading ? errorMsg = '加载中' : successMsg = '完成'">
    状态切换
  </t-button>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isLoading = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toContain('function __fun_')
  })

  it('数值运算赋值', async () => {
    const vueContent = `
<template>
  <button @tap="count = count + 1">
    增加
  </button>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toContain('function __fun_')
    expect(js).toContain('__vmsProxyRefs.count = __vmsProxyRefs.count + 1')
  })

  it('v-for 中的直接赋值', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="item.selected = true">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([
  { name: '项目1', selected: false }
])
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('data-a="{{[index]}}"')
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toMatch(/const\s*{\s*a:\s*\[index\]\s*}\s*=\s*__vms_event\.currentTarget\.dataset/)
    expect(js).toContain('__vmsProxyRefs.list[index].selected = true')
  })

  it('v-for 中多次使用 item 时创建局部引用', async () => {
    const vueContent = `
<template>
  <div v-for="(item, index) of list" @tap="() => { item.selected = !item.selected; console.log(item.name) }">
    {{ item.name }}
  </div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([
  { name: '项目1', selected: false }
])
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('data-a="{{[index]}}"')
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toMatch(/const\s*{\s*a:\s*\[index\]\s*}\s*=\s*__vms_event\.currentTarget\.dataset/)
    expect(js).toContain('const item = __vmsProxyRefs.list[index]')
    expect(js).toContain('item.selected = !item.selected')
    expect(js).toContain('console.log(item.name)')
  })
})
