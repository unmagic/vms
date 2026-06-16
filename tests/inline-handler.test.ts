import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('内联事件处理器 - 基础场景', () => {
  it('简单 if 赋值（无参数）', async () => {
    const vueContent = `
<template>
  <t-button @tap="() => { if (canResend) { showResendModal = true } }">
    重新发送
  </t-button>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const canResend = ref(true)
const showResendModal = ref(false)
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toContain('function __fun_')
    expect(js).toContain('(__vms_event)')
    expect(js).toContain('__vmsProxyRefs.canResend')
    expect(js).toContain('__vmsProxyRefs.showResendModal = true')
  })

  it('多条语句', async () => {
    const vueContent = `
<template>
  <t-button @tap="() => { console.log('clicked'); showModal = true; count++ }">
    点击
  </t-button>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const showModal = ref(false)
const count = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain("console.log('clicked')")
    expect(js).toContain('__vmsProxyRefs.showModal = true')
    expect(js).toContain('__vmsProxyRefs.count++')
  })

  it('局部变量声明', async () => {
    const vueContent = `
<template>
  <t-button @tap="() => { const message = '操作成功'; showToast = true; toastMessage = message }">
    显示提示
  </t-button>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const showToast = ref(false)
const toastMessage = ref('')
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain("const message = '操作成功'")
    expect(js).toContain('__vmsProxyRefs.showToast = true')
    expect(js).toContain('__vmsProxyRefs.toastMessage = message')
  })

  it('带参数的内联函数', async () => {
    const vueContent = `
<template>
  <t-button @tap="(e) => { console.log(e); handleSubmit(e) }">
    提交
  </t-button>
</template>

<script setup lang="ts">
function handleSubmit(e: any) {
  console.log('submit', e)
}
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('function __fun_')
    expect(js).toContain('(__vms_event)')
    expect(js).toContain('const e = __vms_event.detail')
    expect(js).toContain('console.log(e)')
    expect(js).toContain('__vmsProxyRefs.handleSubmit(e)')
  })

  it('$event 参数（不添加 .detail）', async () => {
    const vueContent = `
<template>
  <div @tap="($event) => { console.log($event.detail); handleClick($event) }"></div>
</template>

<script setup lang="ts">
function handleClick(e: any) {
  console.log('click', e)
}
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('function __fun_')
    expect(js).toContain('(__vms_event)')
    expect(js).toContain('console.log(__vms_event.detail)')
    expect(js).toContain('__vmsProxyRefs.handleClick(__vms_event)')
    expect(js).not.toContain('const $event = __vms_event.detail')
  })

  it('解构参数', async () => {
    const vueContent = `
<template>
  <div @tap="({ name }) => { console.log(name); handleClick(name) }"></div>
</template>

<script setup lang="ts">
function handleClick(name: string) {
  console.log('click', name)
}
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toMatch(/const\s*{\s*name\s*}\s*=\s*__vms_event\.detail/)
    expect(js).toContain('console.log(name)')
    expect(js).toContain('__vmsProxyRefs.handleClick(name)')
  })
})

describe('内联事件处理器 - 函数调用', () => {
  it('简单函数引用', async () => {
    const vueContent = `
<template>
  <div @tap="onClick"></div>
</template>

<script setup lang="ts">
function onClick() {
  console.log('clicked')
}
</script>
`
    const { wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="onClick"')
  })

  it('函数调用，不传参数', async () => {
    const vueContent = `
<template>
  <div @tap="onClick()"></div>
</template>

<script setup lang="ts">
function onClick() {
  console.log('clicked')
}
</script>
`
    const { wxml, js } = await compileVueContent(vueContent)
    expect(wxml).toMatch(/bind:tap="(onClick|__fun_\d+)"/)
    if (wxml.includes('__fun_')) {
      expect(js).toMatch(/return\s+onClick\(__vms_event\)/)
    }
  })

  it('函数调用，传参数', async () => {
    const vueContent = `
<template>
  <div @tap="onClick(name, age)"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const name = ref('张三')
const age = ref(20)
function onClick(n: string, a: number) {
  console.log(n, a)
}
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toContain('__vmsProxyRefs.name')
    expect(js).toContain('__vmsProxyRefs.age')
    expect(js).toMatch(/return\s+onClick\(/)
  })
})

describe('内联事件处理器 - 高级语法', () => {
  it('三元表达式', async () => {
    const vueContent = `
<template>
  <div @tap="() => { status = isActive ? 'active' : 'inactive' }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const status = ref('')
const isActive = ref(true)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain("__vmsProxyRefs.status = __vmsProxyRefs.isActive ? 'active' : 'inactive'")
  })

  it('逻辑运算符', async () => {
    const vueContent = `
<template>
  <div @tap="() => { isValid && handleSubmit() }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isValid = ref(true)
function handleSubmit() {}
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('__vmsProxyRefs.isValid && __vmsProxyRefs.handleSubmit()')
  })

  it('模板字符串', async () => {
    const vueContent = `
<template>
  <div @tap="\`() => { message = \\\`Hello, \\\${userName}!\\\` }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const message = ref('')
const userName = ref('张三')
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('message')
    expect(js).toContain('userName')
  })

  it('try-catch 语句', async () => {
    const vueContent = `
<template>
  <div @tap="() => { try { result = riskyOperation() } catch (error) { errorMessage = error.message } }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const result = ref(null)
const errorMessage = ref('')
function riskyOperation() { return 'ok' }
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('try {')
    expect(js).toContain('catch (error)')
  })

  it('for 循环', async () => {
    const vueContent = `
<template>
  <div @tap="() => { for (let i = 0; i < items.length; i++) { total += items[i].price } }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ price: 10 }])
const total = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('for (let i = 0; i < __vmsProxyRefs.items.length; i++)')
  })

  it('空函数体', async () => {
    const vueContent = `
<template>
  <div @tap="() => {}"></div>
</template>

<script setup lang="ts">
</script>
`
    const { js, wxml } = await compileVueContent(vueContent)
    expect(wxml).toContain('bind:tap="__fun_')
    expect(js).toContain('function __fun_')
  })

  it('return 语句', async () => {
    const vueContent = `
<template>
  <div @tap="() => { if (!isValid) return; handleSubmit() }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const isValid = ref(true)
function handleSubmit() {}
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('if (!__vmsProxyRefs.isValid) return')
  })

  it('复合赋值运算符', async () => {
    const vueContent = `
<template>
  <div @tap="() => { count += 1; total -= amount }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const count = ref(0)
const total = ref(100)
const amount = ref(10)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('__vmsProxyRefs.count += 1')
    expect(js).toContain('__vmsProxyRefs.total -= __vmsProxyRefs.amount')
  })

  it('解构赋值', async () => {
    const vueContent = `
<template>
  <div @tap="() => { const { name, age } = userInfo; const [first, second] = items; selectedName = name; selectedItem = first }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const userInfo = ref({ name: '张三', age: 20 })
const items = ref([1, 2, 3])
const selectedName = ref('')
const selectedItem = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toMatch(/const\s*{\s*name,\s*age\s*}\s*=\s*__vmsProxyRefs\.userInfo/)
    expect(js).toMatch(/const\s*\[first,\s*second\]\s*=\s*__vmsProxyRefs\.items/)
  })

  it('async/await', async () => {
    const vueContent = `
<template>
  <div @tap="async () => { loading = true; try { const result = await fetchData(); data = result } finally { loading = false } }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const loading = ref(false)
const data = ref(null)
async function fetchData() {
  return { value: 'test' }
}
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('async function __fun_')
  })

  it('展开运算符', async () => {
    const vueContent = `
<template>
  <div @tap="() => { newArray = [...oldArray, newItem]; newObject = { ...oldObject, newKey: newValue } }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const oldArray = ref([1, 2, 3])
const newArray = ref([])
const newItem = ref(4)
const oldObject = ref({ a: 1 })
const newObject = ref({})
const newValue = ref(2)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('newArray')
    expect(js).toContain('newObject')
  })

  it('可选链', async () => {
    const vueContent = `
<template>
  <div @tap="() => { value = user?.profile?.name; result = data?.items?.[0] ?? defaultItem }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref({ profile: { name: '张三' } })
const data = ref({ items: [1, 2, 3] })
const value = ref('')
const result = ref(null)
const defaultItem = ref(0)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('user?.profile?.name')
  })

  it('箭头函数作为参数', async () => {
    const vueContent = `
<template>
  <div @tap="() => { items.forEach((item) => { item.selected = true }); filtered = list.filter((x) => x.active) }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const items = ref([{ selected: false }])
const list = ref([{ active: true }])
const filtered = ref([])
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('items.forEach')
    expect(js).toContain('filtered')
  })

  it('计算属性访问', async () => {
    const vueContent = `
<template>
  <div @tap="() => { value = obj[key]; obj[dynamicKey] = newValue }"></div>
</template>

<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const obj = ref({ a: 1, b: 2 })
const key = ref('a')
const dynamicKey = ref('b')
const value = ref(0)
const newValue = ref(3)
</script>
`
    const { js } = await compileVueContent(vueContent)
    expect(js).toContain('obj[')
  })
})
