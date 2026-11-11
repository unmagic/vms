import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

/**
 * v-model / defineModel 支持测试
 *
 * defineModel<T>() 编译为 customRef（get 读 __vmsProps.xxx，set triggerEvent('update:xxx')），
 * v-model 指令编译为属性绑定 + setter 桥接函数。
 */

describe('defineModel 宏', () => {
  it('1.1 无参数 defineModel：注册 modelValue 属性 + customRef', async () => {
    const vueContent = `
<template>
  <view>{{ model }}</view>
</template>
<script setup lang="ts">
const model = defineModel<string>()
const update = () => { model.value = 'x' }
</script>
`
    const { js, json, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    // properties 注册 modelValue
    expect(js).toContain('modelValue')
    // customRef 生成：get 读 props，set triggerEvent
    expect(js).toContain('customRef')
    expect(js).toContain('return __vmsProps.modelValue')
    expect(js).toContain('__vmsContext.triggerEvent("update:modelValue", __vms_value)')
    // 原 defineModel 调用被移除
    expect(js).not.toContain('defineModel')
    // json 里 component 配置正常生成
    expect(json?.component).toBe(true)
  })

  it('1.2 带参数 defineModel("title")：注册 title 属性', async () => {
    const vueContent = `
<template>
  <view>{{ title }}</view>
</template>
<script setup lang="ts">
const title = defineModel<string>('title')
</script>
`
    const { js, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(js).toContain('return __vmsProps.title')
    expect(js).toContain('__vmsContext.triggerEvent("update:title", __vms_value)')
    expect(js).not.toContain('defineModel')
  })

  it('1.3 customRef 从 @unmagic/vue-mini 导入', async () => {
    const vueContent = `
<template>
  <view>{{ model }}</view>
</template>
<script setup lang="ts">
const model = defineModel<number>()
</script>
`
    const { js, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(js).toMatch(/import\s*{[^}]*customRef[^}]*}\s*from\s*["']@unmagic\/vue-mini["']/)
  })

  it('1.4 defineModel 变量在模板插值中使用', async () => {
    const vueContent = `
<template>
  <view>{{ model }}</view>
</template>
<script setup lang="ts">
const model = defineModel<string>()
</script>
`
    const { wxml, js, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    // 模板插值直接使用变量名
    expect(wxml).toContain('{{model}}')
    // 变量进入渲染状态供模板取值
    expect(js).toContain('model')
  })
})

describe('v-model 指令（原生标签）', () => {
  it('2.1 input v-model：value 绑定 + bind:input 桥接', async () => {
    const vueContent = `
<template>
  <input v-model="text" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const text = ref('')
</script>
`
    const { js, wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('value="{{text}}"')
    expect(wxml).toMatch(/bind:input="__fun_\d+"/)
    // setter 桥接：把 e.detail.value 写回变量
    expect(js).toMatch(/__vmsProxyRefs\.text = __vms_event\.detail\.value/)
  })

  it('2.2 switch v-model：checked 绑定 + bind:change', async () => {
    const vueContent = `
<template>
  <switch v-model="on" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const on = ref(false)
</script>
`
    const { js, wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('checked="{{on}}"')
    expect(wxml).toMatch(/bind:change="__fun_\d+"/)
    expect(js).toMatch(/__vmsProxyRefs\.on = __vms_event\.detail\.value/)
  })

  it('2.3 textarea v-model', async () => {
    const vueContent = `
<template>
  <textarea v-model="content" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const content = ref('')
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('value="{{content}}"')
    expect(wxml).toMatch(/bind:input="__fun_\d+"/)
  })
})

describe('v-model 指令（组件）', () => {
  it('3.1 v-model="t"：modelValue 属性 + bind:update:modelValue', async () => {
    const vueContent = `
<template>
  <MyComp v-model="t" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const t = ref('x')
</script>
`
    const { js, wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('modelValue="{{t}}"')
    expect(wxml).toMatch(/bind:update:modelValue="__fun_\d+"/)
    // 组件事件：triggerEvent 的第二参数整体成为 e.detail，故直接取 e.detail
    expect(js).toMatch(/__vmsProxyRefs\.t = __vms_event\.detail\b/)
  })

  it('3.2 v-model:title="t"：title 属性 + bind:update:title', async () => {
    const vueContent = `
<template>
  <MyComp v-model:title="t" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const t = ref('x')
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('title="{{t}}"')
    expect(wxml).toMatch(/bind:update:title="__fun_\d+"/)
  })

  it('3.3 绑定 props 变量报错（只读不可写）', async () => {
    const vueContent = `
<template>
  <MyComp v-model:title="name" />
</template>
<script setup lang="ts">
const { name } = defineProps<{ name: string }>()
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('props')
  })
})

describe('v-model 与 v-for 结合', () => {
  it('4.1 v-for 内 v-model="item.name"：data-a 传索引 + dataset 解构', async () => {
    const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <input v-model="item.name" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, name: '' }])
</script>
`
    const { js, wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('value="{{item.name}}"')
    expect(wxml).toMatch(/bind:input="__fun_\d+"/)
    expect(wxml).toContain('data-a="{{[index]}}"')
    // setter 内从 dataset 取索引，声明 item 局部常量后按链赋值
    expect(js).toMatch(/const \{\s+a: \[index\]\s+\} = __vms_event\.currentTarget\.dataset/)
    expect(js).toMatch(/const item = __vmsProxyRefs\.list\[index\]/)
    expect(js).toContain('item.name = __vms_event.detail.value')
  })

  it('4.2 嵌套 v-for 内 v-model', async () => {
    const vueContent = `
<template>
  <view v-for="(group, gi) in groups" :key="group.id">
    <view v-for="(item, ii) in group.children" :key="item.id">
      <input v-model="item.value" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const groups = ref([{ id: 1, children: [{ id: 1, value: '' }] }])
</script>
`
    const { js, wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('data-a="{{[gi,ii]}}"')
    expect(js).toMatch(/const \{\s+a: \[gi, ii\]\s+\} = __vms_event\.currentTarget\.dataset/)
    // 外层 item 声明为局部常量，内层 item 基于外层解析
    expect(js).toMatch(/const group = __vmsProxyRefs\.groups\[gi\]/)
    expect(js).toMatch(/const item = group\.children\[ii\]/)
    expect(js).toContain('item.value = __vms_event.detail.value')
  })
})

describe('v-model 非法用法报错', () => {
  it('5.1 绑定非变量表达式报编译错误', async () => {
    const vueContent = `
<template>
  <input v-model="a + b" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref(1)
const b = ref(2)
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('v-model')
  })

  it('5.2 缺少绑定值报编译错误', async () => {
    const vueContent = `
<template>
  <input v-model />
</template>
<script setup lang="ts">
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('v-model')
  })

  // 回归：fallbackParse 解析失败时曾返回 t.identifier(content)，
  // 会把字面量伪装成合法标识符，生成 `__vmsProxyRefs.'lit' = ...` 语法错误代码
  it.each([
    ['字符串字面量', `v-model="'lit'"`],
    ['数字字面量', 'v-model="123"'],
    ['对象字面量', 'v-model="{ a: 1 }"'],
    ['函数调用', 'v-model="fn()"'],
  ])('5.3 不可写目标（%s）报编译错误', async (_name, directive) => {
    const vueContent = `
<template>
  <input ${directive} />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref(1)
const fn = () => 1
</script>
`
    const { js, error } = await compileVueContent(vueContent)

    expect(error).not.toBeNull()
    // 不得产出语法非法的赋值代码
    expect(js).not.toMatch(/__vmsProxyRefs\.'/)
  })

  // 回归：'a'.length 是合法 MemberExpression，但根不是标识符，
  // 曾生成 `'a'.length = ...`，编译期不报错、运行时赋值失败
  it.each([
    ['成员访问的根是字面量', `v-model="'a'.length"`],
    ['成员访问的根是调用', 'v-model="fn().x"'],
  ])('5.4 不可写成员目标（%s）报编译错误', async (_name, directive) => {
    const vueContent = `
<template>
  <input ${directive} />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref(1)
const fn = () => ({ x: 1 })
</script>
`
    const { error } = await compileVueContent(vueContent)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('不可写入')
  })

  // 回归：全局变量会被 shouldSkip 排除在 __vmsProxyRefs 之外，
  // 但曾允许作为 v-model 目标，生成的 setter 引用未定义的 __vmsProxyRefs
  it.each(['wx', 'console'])('5.5 全局变量 %s 不可作为 v-model 目标', async (globalName) => {
    const vueContent = `
<template>
  <input v-model="${globalName}" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref(1)
</script>
`
    const { js, error } = await compileVueContent(vueContent)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('全局变量')
    // 不得产出引用未定义 __vmsProxyRefs 的 setter
    expect(js).not.toContain('__vmsProxyRefs')
  })

  it('5.6 合法目标不受校验影响', async () => {
    const vueContent = `
<template>
  <input v-model="user.profile.name" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const user = ref({ profile: { name: '' } })
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('value="{{user.profile.name}}"')
  })
})

describe('v-model 修饰符', () => {
  it('6.1 原生标签 .lazy 报错（小程序无 change 事件）', async () => {
    const vueContent = `
<template>
  <input v-model.lazy="text" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const text = ref('')
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('不支持 v-model.lazy')
  })

  // 回归（两阶段）：
  // 1) .lazy 曾把监听事件改写成 change:update:modelValue，但小程序组件只触发
  //    update:modelValue，绑定永远收不到事件；
  // 2) 改为"保持事件名不变"后，产物与不写 .lazy 完全一致——修饰符被静默忽略。
  // Vue 通过 modelModifiers 把修饰符传给子组件，VMS 无等价机制，
  // 因此正确做法是明确报错，而不是产出与预期不符的代码。
  it('6.1b 组件 .lazy：明确报错（不静默忽略）', async () => {
    const vueContent = `
<template>
  <MyComp v-model.lazy="t" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const t = ref('')
</script>
`
    const { error } = await compileVueContent(vueContent)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('lazy')
    expect(error!.message).toContain('modelModifiers')
  })

  it('6.1c 具名组件 .lazy：同样报错', async () => {
    const vueContent = `
<template>
  <MyComp v-model:title.lazy="t" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const t = ref('')
</script>
`
    const { error } = await compileVueContent(vueContent)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('lazy')
  })

  it('6.1d 组件不加 .lazy 时正常生成 update 绑定', async () => {
    const vueContent = `
<template>
  <MyComp v-model="t" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const t = ref('')
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('modelValue="{{t}}"')
    expect(wxml).toMatch(/bind:update:modelValue="__fun_\d+"/)
    expect(wxml).not.toContain('change:update')
  })

  it('6.2 .number：setter 内转数字（空串不转）', async () => {
    const vueContent = `
<template>
  <input v-model.number="num" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const num = ref(0)
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain(
      '__vmsProxyRefs.num = __vms_event.detail.value === "" ? "" : +__vms_event.detail.value',
    )
  })

  it('6.3 .trim：setter 内去首尾空格', async () => {
    const vueContent = `
<template>
  <input v-model.trim="text" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const text = ref('')
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toContain('__vmsProxyRefs.text = __vms_event.detail.value.trim()')
  })

  // 回归：修饰符曾按 .number → .trim 顺序应用，生成 (+value).trim()，
  // 对任何非空输入都会抛 TypeError（数字没有 trim 方法）。
  // Vue 的 vModelText 是先 trim 再 number。
  it('6.3b .number.trim：先 trim 再转数字，不得生成 (+value).trim()', async () => {
    const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <input v-model.number.trim="item.v" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, v: '' }])
</script>
`
    const { js, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(js).toContain(
      'item.v = __vms_event.detail.value.trim() === "" ? "" : +__vms_event.detail.value.trim()',
    )
    // 反序产物：对非空值抛 TypeError
    expect(js).not.toContain(').trim()')
  })

  it('6.3c .trim.number 与 .number.trim 书写顺序无关，产物一致', async () => {
    const make = (directive: string) => `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <input ${directive} />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1, v: '' }])
</script>
`
    const a = await compileVueContent(make('v-model.number.trim="item.v"'))
    const b = await compileVueContent(make('v-model.trim.number="item.v"'))

    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    const extract = (js: string) => js.match(/item\.v = [^;]+/)?.[0]
    expect(extract(a.js)).toBe(extract(b.js))
    expect(extract(a.js)).toContain('.trim()')
  })

  // 回归：.trim 在非字符串值上会抛 TypeError（boolean/number 没有 trim 方法），
  // .number 会把 switch 的 boolean 静默转成 1/0。Vue 同样只在文本类
  // 输入（text/textarea）上应用这两个修饰符。
  it.each([
    ['switch', '<switch v-model.trim="v" />', 'const v = ref(false)', 'boolean'],
    ['slider', '<slider v-model.trim="v" />', 'const v = ref(0)', 'number'],
    [
      'picker',
      '<picker v-model.trim="v" :range="r" />',
      'const v = ref(0)\nconst r = ref([])',
      'number',
    ],
  ])('6.3d <%s> 上 .trim 报编译错误（值为 %s）', async (tag, template, decl, _type) => {
    const { error } = await compileVueContent(`
<template>
  ${template}
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
${decl}
</script>
`)

    expect(error).not.toBeNull()
    expect(error!.message).toContain(tag)
    expect(error!.message).toContain('trim')
  })

  it('6.3e switch 上 .number 报编译错误（避免 boolean 被转成 1/0）', async () => {
    const { error } = await compileVueContent(`
<template>
  <switch v-model.number="on" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const on = ref(false)
</script>
`)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('switch')
    expect(error!.message).toContain('number')
  })

  it('6.3f input/textarea 与自定义组件仍可正常使用 .trim/.number', async () => {
    const input = await compileVueContent(`
<template>
  <input v-model.trim="s" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const s = ref('')
</script>
`)
    expect(input.error).toBeNull()
    expect(input.js).toContain('.trim()')

    const textarea = await compileVueContent(`
<template>
  <textarea v-model.number.trim="s" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const s = ref('')
</script>
`)
    expect(textarea.error).toBeNull()

    const component = await compileVueContent(`
<template>
  <MyInput v-model.number="n" />
</template>
<script setup lang="ts">
import MyInput from './MyInput.vue'
import { ref } from '@unmagic/vue-mini'
const n = ref(0)
</script>
`)
    expect(component.error).toBeNull()

    const plainSwitch = await compileVueContent(`
<template>
  <switch v-model="on" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const on = ref(false)
</script>
`)
    expect(plainSwitch.error).toBeNull()
  })

  it('6.4 未知修饰符报编译错误', async () => {
    const vueContent = `
<template>
  <input v-model.foo="a" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const a = ref(1)
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('不支持修饰符 .foo')
  })
})

describe('defineModel 参数校验', () => {
  it('7.1 { default: 0 } 注册属性默认值', async () => {
    const vueContent = `
<template>
  <view>{{ count }}</view>
</template>
<script setup lang="ts">
const count = defineModel<number>({ default: 0 })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(js).toMatch(/modelValue: \{\s+type: null,\s+value: 0\s+\}/)
    expect(js).not.toContain('defineModel')
  })

  it('7.2 不支持的 options（get/set 转换器）报编译错误且不残留宏调用', async () => {
    const vueContent = `
<template>
  <view>{{ m }}</view>
</template>
<script setup lang="ts">
const m = defineModel<string>({ get: (v: string) => v })
</script>
`
    const { js, error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('defineModel')
    // 宏调用被移除，不产生运行时 ReferenceError
    expect(js).not.toContain('defineModel')
  })
})

describe('v-model 目标与标签校验', () => {
  it('8.1 checkbox 不支持 v-model（detail.value 是数组）', async () => {
    const vueContent = `
<template>
  <checkbox v-model="on" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const on = ref(false)
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('checkbox')
    expect(error!.message).toContain('数组')
  })

  it('8.2 radio 不支持 v-model', async () => {
    const vueContent = `
<template>
  <radio v-model="pick" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const pick = ref('')
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('radio')
  })

  it('8.3 v-model 绑定 v-for 索引变量报错', async () => {
    const vueContent = `
<template>
  <view v-for="(item, index) in list" :key="item.id">
    <input v-model="index" />
  </view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const list = ref([{ id: 1 }])
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('索引变量')
  })

  it('8.4 未映射的原生标签报错而非走组件约定（slider 支持,用 form 验证）', async () => {
    const vueContent = `
<template>
  <form v-model="data" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const data = ref('')
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('form')
    expect(error!.message).toContain('不支持 v-model')
  })

  it('8.5 slider 正常映射 changing 事件', async () => {
    const vueContent = `
<template>
  <slider v-model="val" />
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const val = ref(0)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('value="{{val}}"')
    expect(wxml).toMatch(/bind:changing="__fun_\d+"/)
  })

  it('8.6 动态参数 v-model:[key] 报编译错误', async () => {
    const vueContent = `
<template>
  <MyComp v-model:[key]="a" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const key = ref('title')
const a = ref('')
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('动态参数')
    // 不得静默产出错误属性（旧行为会绑定成 key="{{a}}"）
    expect(wxml).not.toContain('key="{{a}}"')
  })

  it('8.7 静态参数 v-model:title 不受动态参数校验影响', async () => {
    const vueContent = `
<template>
  <MyComp v-model:title="a" />
</template>
<script setup lang="ts">
import MyComp from './MyComp.vue'
import { ref } from '@unmagic/vue-mini'
const a = ref('')
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)

    expect(error).toBeNull()
    expect(wxml).toContain('title="{{a}}"')
    expect(wxml).toMatch(/bind:update:title="__fun_\d+"/)
  })
})
