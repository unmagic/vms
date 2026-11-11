---
name: vms
description: 使用 VMS (Vue Mini SFC) 工具开发微信小程序的完整指南。涵盖 Vue 3 Composition API、TypeScript、事件绑定、v-for、v-show、响应式数据、组件通信、插槽等核心用法，以及常见问题和最佳实践。Use when developing WeChat Mini Program with VMS, writing Vue SFC with @unmagic/vue-mini, or debugging template compilation issues.
license: MIT
metadata:
  author: github.com/unmagic
  version: '0.1.6'
---

# Vue Mini SFC 微信小程序开发指南

## 工具简介

**Vue Mini SFC**（简称 **VMS**）允许你使用 Vue 3 `<script setup lang="ts">` 语法开发微信小程序，自动编译为小程序原生代码。

**版本：** 0.1.6 | **仓库：** github.com/unmagic/vms

**要求：**

- **必须使用 TypeScript** - SFC 文件必须以 `<script setup lang="ts">` 编写
- Vue 3 Composition API + `<script setup>`
- 运行时：`@unmagic/vue-mini >= 1.0.3`
- Node.js >= 22

**输出：** 微信小程序原生代码（WXML + JS + WXSS + JSON）

## 项目结构

```
src/
├── pages/           # 页面
├── components/      # 组件
├── subXXX/          # 分包
├── api/             # API 接口
├── stores/          # Pinia 状态管理
├── utils/           # 工具函数
├── composition/     # 组合式函数
├── app.ts           # 应用入口（编译为 app.js）
├── app.json         # 小程序全局配置
└── app.wxss         # 全局样式
```

## CLI 命令

```bash
# 安装
pnpm add -D @unmagic/vms

# 开发模式（文件监听 + 增量编译）
vms dev

# 生产构建
vms build

# 生产构建 + 上传小程序
vms build --upload
```

## 配置文件

在项目根目录创建 `vms.config.js`，支持 `export default` 或 `export const config = ...` 两种写法：

```js
// vms.config.js
export default {
  wx: {
    appid: 'your-appid',
    privateKeyPath: '/path/to/private.key',
    name: 'your-name',
    email: 'your@email.com',
    version: '1.0.0',
    description: '项目描述',
  },
  sourceDir: 'src', // 源码目录（默认 src）
  outputDir: 'dist', // 输出目录（默认 dist）
  alias: { '@': './src' }, // 路径别名（默认 @ → ./src）
  component: {
    // 第三方组件匹配（可选）
    prefix: 'td-',
    pathPrefix: 'tdesign-miniprogram/',
  },
  copyOnly: [], // 跳过 Babel 直接复制的文件（如 ['big.js', 'ec-canvas/']）

  // 启用 glass-easel 组件框架（默认 false）
  // 作用域插槽依赖该开关（dynamicSlots）；要求基础库 >= 3.8.12
  glassEasel: false,
}
```

## 推荐开发流程

1. 使用 `vms dev` 启动开发模式
2. 微信开发者工具打开 `dist/dev` 目录
3. 修改 `.vue` 文件，保存后自动编译
4. 在微信开发者工具中查看效果
5. 使用 `vms build` 生产构建，输出到 `dist/prod`

## 基础语法

### 1. 页面/组件定义

**注意：** 所有 Vue API 必须从 `@unmagic/vue-mini` 导入，不要从 `vue` 导入。

```vue
<script setup lang="ts">
import { ref, computed, onLoad } from '@unmagic/vue-mini'

// 响应式数据
const count = ref(0)
const double = computed(() => count.value * 2)

// 方法
function increment() {
  count.value++
}

// 生命周期
onLoad(() => {
  console.log('页面加载')
})
</script>

<template>
  <div class="container">
    <text>{{ count }}</text>
    <text>{{ double }}</text>
    <button @tap="increment">+1</button>
  </div>
</template>
```

### 2. 事件绑定

**推荐使用 `@tap`** - 小程序原生点击事件，无需转换，性能更好。

#### 简单事件（推荐）

```vue
<!-- 无参函数直接绑定 -->
<button @tap="onSubmit">提交</button>

<!-- 有参函数 -->
<button @tap="onSubmit(formData)">提交</button>
```

#### 箭头函数（用于简单逻辑）

```vue
<!-- 访问事件参数 -->
<input @input="(e) => onInput(e.value)" />

<!-- 多个参数 -->
<button @tap="(e) => onClick(item, e)">点击</button>
```

#### 事件修饰符

| 修饰符          | 编译结果         | 说明              |
| --------------- | ---------------- | ----------------- |
| `.stop`         | `catch:`         | 阻止事件冒泡      |
| `.mut`          | `mut-bind:`      | 互斥事件绑定      |
| `.capture`      | `capture-bind:`  | 捕获阶段监听      |
| `.capture-stop` | `capture-catch:` | 捕获阶段+阻止冒泡 |

```vue
<button @tap.stop="onTap">阻止冒泡</button>
<button @tap.mut="onTap">互斥点击</button>
<button @tap.capture="onTap">捕获阶段</button>
<button @tap.capture-stop="onTap">捕获并阻止</button>
```

#### 事件参数处理规则

| 绑定方式                           | 参数处理             | 使用场景               |
| ---------------------------------- | -------------------- | ---------------------- |
| `@tap="onTap"`                     | 原样传递完整事件对象 | 需要访问事件完整信息时 |
| `@tap="(value) => onTap(value)"`   | 自动加 `.detail`     | 只需要事件值时         |
| `@tap="($event) => onTap($event)"` | 原样传递             | 需要完整事件对象时     |

**注意：** 箭头函数中非 `$event` 的参数会自动从 `event.detail` 取值，不要手动写 `.detail`。

#### 复杂表达式（已支持）

```vue
<!-- 箭头函数执行多条语句 -->
<button
  @tap="
    () => {
      doA()
      doB()
    }
  "
>点击</button>

<!-- 条件表达式 -->
<button @tap="() => (isEdit ? update() : create())">保存</button>

<!-- 对象方法调用 -->
<button @tap="() => form.validate().then(submit)">提交</button>
```

**注意：** 虽然支持复杂表达式，但为了代码可读性，复杂逻辑仍建议提取为方法。

#### v-for 中的事件

```vue
<!-- 访问当前项 -->
<div v-for="item of list" :key="item.id" @click="onSelect(item)">
  {{ item.name }}
</div>

<!-- 访问当前项和索引 -->
<div v-for="(item, index) of list" :key="item.id" @click="onSelect(item, index)">
  {{ item.name }}
</div>
```

**注意：** v-for 中使用内联箭头函数时，编译器会智能判断是否需要创建局部引用，只传递 index 优化性能。

### 3. v-for 循环

```vue
<!-- 基础用法 -->
<div v-for="item of items" :key="item.id">{{ item.name }}</div>

<!-- 嵌套循环 -->
<div v-for="group of groups" :key="group.id">
  <div v-for="item of group.items" :key="item.id" @click="item.onClick">
    {{ item.name }}
  </div>
</div>

<!-- 带方法的循环项 -->
<script setup>
const items = ref([{ name: 'Item 1', onClick: () => console.log('clicked') }])
</script>
<template>
  <div v-for="item of items" :key="item.name" @click="item.onClick">
    {{ item.name }}
  </div>
</template>
```

#### :key 规则

- 简单属性路径（如 `item.id`）→ 提取属性名作为 key
- 纯标识符（如 `index`）→ 保留原名
- 嵌套路径（如 `item.data.id`）→ 回退到 `*this` 并发出警告

#### 变量命名规则（嵌套 v-for）

小程序中内层 `wx:for` 的 index 会遮蔽外层的同名 index。VMS 需要把各级索引
通过 `data-*` 传回事件处理函数，因此**嵌套层级之间不能复用同一个 index 变量名**：

```vue
<!-- 正确：各级 index 使用不同名称 -->
<view v-for="(row, rowIndex) in rows" :key="row.id">
  <view v-for="(cell, cellIndex) in row.cells" :key="cell.id">
    <input v-model="cell.text" />
  </view>
</view>

<!-- 编译结果：data-a="{{[rowIndex,cellIndex]}}" -->
<!-- 处理函数：const { a: [rowIndex, cellIndex] } = e.currentTarget.dataset -->

<!-- 错误：两级都叫 index，编译期报错 -->
<view v-for="(row, index) in rows">
  <view v-for="(cell, index) in row.cells">...</view>
</view>
```

- **只写一个 index** 时无需改名：未显式命名的层级会自动生成唯一名称
  （如 `_child_0_index`），与外层不冲突
- **并列（非嵌套）**的多个 v-for 可以都叫 index，互不影响

> 编译后 WXML 使用 `data-a="{{[一级索引, 二级索引]}}"` 携带多级索引，
> 事件处理函数按序解构后逐级解引用（如 `cell.text = e.detail.value`）。
>
> **取值位置随事件源不同**：原生表单标签取 `e.detail.value`；自定义组件
> （含本组件自身的 `defineModel`）取 **`e.detail`**——子组件经
> `triggerEvent(name, value)` 传值时，微信把第二个参数**整体**作为 detail。

#### 解构式 v-for

支持对象/数组解构，解构变量在编译期会被改写为 `item` 的属性访问，
因此**可以安全地用于 `v-model`、事件参数与 `:class` 等场景**：

```vue
<view v-for="({ id, name }, index) in list" :key="id">
  <input v-model="name" />
</view>
<!-- 编译结果：value="{{item.name}}"，setter 写回 item.name -->

<view v-for="{ user: { name } } in list" :key="name">
  <input v-model="name" />
</view>
<!-- 嵌套路径：value="{{item.user.name}}" -->

<view v-for="([a, b], i) in pairs" :key="i">
  <input v-model="b" />
</view>
<!-- 数组下标：value="{{item[1]}}" -->
```

> WXML 中不存在解构变量名，全部落到 `wx:for` 默认的 `item` 上。
> 若外层解构变量被内层的同名 item 遮蔽，会编译报错，请为内层指定 `wx:for-item`。

### 4. 条件渲染

```vue
<!-- v-if / v-else -->
<div v-if="isLoading">加载中...</div>
<div v-else>内容</div>

<!-- v-show -->
<div v-show="isVisible">显示/隐藏</div>

<!-- template + v-if（编译为 block） -->
<template v-if="showContent">
  <div>内容1</div>
  <div>内容2</div>
</template>
<!-- 编译后：<block wx:if="{{showContent}}">...</block> -->
```

### 5. 响应式数据

```vue
<script setup>
import { ref, computed, watch } from '@unmagic/vue-mini'

const count = ref(0) // ref
const double = computed(() => count.value * 2) // computed

watch(count, (newVal, oldVal) => {
  // watch
  console.log('count changed:', oldVal, '->', newVal)
})
</script>
```

### 6. :class 绑定

VMS 支持完整的 Vue `:class` 语法，通过 WXS 辅助函数实现。

```vue
<!-- 对象语法 -->
<div :class="{ active: isActive, disabled: isDisabled }"></div>

<!-- 数组语法 -->
<div :class="[baseClass, extraClass]"></div>

<!-- 数组 + 对象混合 -->
<div :class="[baseClass, { active: isActive }]"></div>

<!-- 模板字符串 -->
<div :class="`item-${index}`"></div>

<!-- 三元表达式 -->
<div :class="isActive ? 'active' : 'inactive'"></div>

<!-- 静态 + 动态 -->
<div class="static-class" :class="dynamicClass"></div>
```

**编译原理：** 动态 class 通过自动生成的 WXS 函数处理，该函数会合并所有 class 源并返回最终的 class 字符串。父组件传入的 class 也会被自动注入。

### 7. :style 绑定

VMS 支持完整的 Vue `:style` 语法。

```vue
<!-- 对象语法（camelCase 自动转 kebab-case） -->
<div :style="{ color: 'red', fontSize: '14px' }"></div>

<!-- 数组语法 -->
<div :style="[baseStyles, overridingStyles]"></div>

<!-- 字符串语法 -->
<div :style="'color:red;font-size:14px'"></div>

<!-- 模板字符串 -->
<div :style="`color:${color}`"></div>
```

**注意：** `camelCase` 属性名会自动转换为 `kebab-case`（如 `fontSize` → `font-size`）。WXS 兼容性由编译器自动处理。

### 8. v-model 双向绑定

支持原生表单标签与自定义组件的 `v-model` / `v-model:xxx`，包括 `v-for` 场景。

```vue
<!-- 原生标签 -->
<input v-model="text" />
<switch v-model="on" />
<textarea v-model="content" />

<!-- 自定义组件（默认 modelValue，可指定参数名） -->
<MyComp v-model="title" />
<MyComp v-model:title="title" />

<!-- v-for 内按索引回写 -->
<view v-for="(item, index) in list" :key="item.id">
  <input v-model="item.name" />
</view>
```

**支持的原生标签与事件映射：**

| 标签                     | 绑定属性  | 监听事件   |
| ------------------------ | --------- | ---------- |
| `input` / `textarea`     | `value`   | `input`    |
| `switch`                 | `checked` | `change`   |
| `slider`                 | `value`   | `changing` |
| `picker` / `picker-view` | `value`   | `change`   |
| `radio-group`            | `value`   | `change`   |

**修饰符：**

| 修饰符    | 行为                                                                            |
| --------- | ------------------------------------------------------------------------------- |
| `.number` | setter 内转数字（空字符串保持为空串）                                           |
| `.trim`   | setter 内 `String.prototype.trim()`                                             |
| `.lazy`   | **暂不支持**：VMS 未实现 Vue 的 `modelModifiers` 传递，写了不会生效，故编译报错 |

> `.number` 与 `.trim` 可组合使用；编译顺序固定为**先 trim 再转数字**，
> 与 Vue 一致，例如 `v-model.number.trim="v"` 输入 `" 3 "` 得到数字 `3`。

> **修饰符适用范围**：`.trim` 与 `.number` 只对**字符串值**有意义，
> 因此仅 `input` / `textarea` 与自定义组件可用。
> `switch`（boolean）、`slider` / `picker`（number）使用这两个修饰符会编译报错——
> 对 boolean/number 调用 `.trim()` 会抛 TypeError，`.number` 则会把 boolean 静默转成 1/0。

**与显式事件共存：** `v-model` 生成的 setter 与用户显式写的同名事件会**合并执行**
（先回写数据，再调用用户回调），不会互相覆盖：

```vue
<input v-model="a" @input="onIn" />
<!-- 编译结果：bind:input 指向桥接函数，内部依次调用回写 setter 与 onIn -->
```

**编译期校验（会直接报错，不会静默生成错误代码）：**

| 非法用法                             | 报错原因                                      |
| ------------------------------------ | --------------------------------------------- |
| `v-model="a + b"`                    | 绑定目标必须是变量或成员表达式                |
| `v-model`（无值）                    | 缺少绑定值                                    |
| `v-model="'lit'"` / `{ a: 1 }` `123` | 不可写目标（非变量）                          |
| `v-model="'a'.length"` / `fn().x`    | 成员表达式的根必须是变量                      |
| `v-model="wx"` / `console`           | 全局变量不参与 `__vmsProxyRefs`，不可双向绑定 |
| `v-model="prop"`                     | `defineProps` 解构出的 props 是只读的         |
| `v-model="index"`                    | `v-for` 索引变量不可写                        |
| `v-model:[key]`                      | 动态参数无法在编译期确定属性/事件名           |
| `checkbox` / `radio` 上的 `v-model`  | `detail.value` 为数组，语义不匹配             |
| `<form v-model>`                     | 未映射的原生标签                              |
| `v-model.foo`                        | 未知修饰符                                    |

### 9. defineModel 编译宏

子组件用 `defineModel` 声明可双向绑定的属性，配合父组件 `v-model` / `v-model:xxx` 使用：

```vue
<script setup lang="ts">
// 默认 prop 名 modelValue
const model = defineModel<string>()

// 自定义 prop 名，配合父组件 v-model:title
const title = defineModel<string>('title')

// 带默认值
const count = defineModel<number>({ default: 0 })

const rename = () => {
  title.value = 'new' // 触发 update:title 事件回传父组件
}
</script>
```

**编译结果：** `defineModel` 被编译为 `customRef`——`get` 读 `__vmsProps.xxx`，`set` 调用 `triggerEvent('update:xxx', value)`，并自动注册对应的 `properties` 项。

该变量在组件内可直接用于 `v-model`（如 `<input v-model="title" />`）：
写入经 `__vmsProxyRefs` 解包到 `customRef.value`，由 `customRef` 的 setter
触发 `update` 事件回传父组件，**不会**直接写 `__vmsProps`。

**限制：** 只支持 `defineModel()`、`defineModel('name')`、`defineModel({ default: value })` 形式；`get`/`set` 转换器等 options 会编译报错（宏调用被移除，不会残留 `ReferenceError`）。

属性名支持 kebab-case（如 `defineModel('user-name')`），配合父组件
`v-model:user-name` 使用，编译产物以字符串键注册、以计算成员访问：

```js
properties: { "user-name": { type: null } }
// getter: __vmsProps["user-name"]
// setter: triggerEvent("update:user-name", value)
```

## 插槽

### 已支持

- **默认插槽**
- **具名插槽**
- **多子节点插槽**
- 自动添加 `multipleSlots: true` 配置

```vue
<!-- 子组件定义插槽 -->
<template>
  <div>
    <slot></slot>
    <!-- 默认插槽 -->
    <slot name="header"></slot>
    <!-- 具名插槽 -->
  </div>
</template>

<!-- 父组件使用 -->
<template>
  <ChildComponent>
    <div>默认插槽内容</div>
    <!-- 默认插槽 -->
    <template #header>
      <!-- 具名插槽 -->
      <div>头部内容</div>
    </template>
    <template #content>
      <!-- 多子节点 -->
      <span>内容1</span>
      <span>内容2</span>
    </template>
  </ChildComponent>
</template>
```

### 作用域插槽

支持作用域插槽（`<slot :item="item" />` + `<template #item="{ item }">`），也支持在 `v-for` 内混用外层循环变量与槽变量。

> **必须开启 glass-easel**：作用域插槽基于 glass-easel 的 `dynamicSlots` 能力实现，需在 `vms.config.js` 中设置 `glassEasel: true`（要求小程序基础库 >= 3.8.12）。
> 未开启时编译不报错，但作用域数据不会传递到插槽内容。默认插槽与具名插槽不依赖该开关。

```vue
<!-- 子组件：导出数据 -->
<template>
  <view v-for="(item, index) in items" :key="item.id">
    <slot name="row" :item="item" :index="index" />
  </view>
</template>

<!-- 父组件：接收数据（槽变量不会进入父组件 data） -->
<MyList>
  <template #row="{ item, index }">
    <text>{{ index }}-{{ item.name }}</text>
  </template>
</MyList>
```

### 编译结果（对照 glass-easel 规范）

```vue
<!-- 子组件：在 v-for 中导出数据 -->
<view v-for="(item, index) in items" :key="item.id">
  <slot name="row" :item="item" :index="index" />
</view>
```

```html
<!-- 编译结果：具名 + 作用域属性并存 -->
<view wx:for="{{items}}" wx:key="id">
  <slot name="row" item="{{item}}" index="{{index}}" />
</view>
```

```vue
<!-- 父组件接收 -->
<MyList>
  <template #row="{ item, index }">
    <text>{{ item.name }}</text>
  </template>
</MyList>
```

```html
<!-- 编译结果：slot="row" 定向插入 + slot:xxx 接收数据 -->
<MyList>
  <text slot="row" slot:item slot:index>{{item.name}}</text>
</MyList>
```

- 具名插槽输出 `slot="<name>"`；默认插槽不输出该属性
- 接收数据输出 `slot:xxx`；需别名时输出 `slot:xxx="alias"`
- 接收入口须与 `<slot>` 出口的绑定属性名一一对应（`:item` → `slot:item`）

### 插槽限制

- **插槽内容必须使用标签包裹**，不能直接写文本
- 空插槽会被替换为注释节点
- 作用域插槽需开启 `glassEasel`，且基础库 >= 3.8.12
- **不支持动态插槽名**（`v-slot:[name]`）：小程序 slot 名须在编译期确定，使用会编译报错
- **槽数据在父组件中只读**：不能对插槽变量本身或其派生数据使用 `v-model`，
  包括经 `v-for` 间接写入的情况（如 `<template #row="{ items }">` 内
  `v-for="it in items"` + `v-model="it.name"`）。这类写法会编译报错，
  需要修改时请在子组件内更新源数据，或先同步到父组件的 `ref`

### template 节点转 block 规则

- 带 `v-if`/`v-for` 的 `<template>` → `<block>`
- 不带指令的 `<template>` → 直接展开子节点，不生成 `<block>`

## 微信小程序 API

### 导航

```vue
<script setup>
function navigateToPage() {
  wx.navigateTo({ url: '/pages/detail/DetailIndex' })
}
function redirectToPage() {
  wx.redirectTo({ url: '/pages/home/HomeIndex' })
}
function navigateBack() {
  wx.navigateBack()
}
</script>
```

### 数据请求

```vue
<script setup>
import { ref, onLoad } from '@unmagic/vue-mini'

const data = ref(null)

onLoad(async () => {
  const res = await wx.request({ url: 'https://api.example.com/data' })
  data.value = res.data
})
</script>
```

### 存储

```vue
<script setup>
wx.setStorageSync('key', value)
const value = wx.getStorageSync('key')
wx.removeStorageSync('key')
</script>
```

## 组件通信

### 函数传递（需包裹在 fun 对象中）

由于小程序限制，传递给子组件的函数必须包裹在 `fun` 对象中：

```vue
<!-- 父组件 -->
<script setup>
import { ref } from '@unmagic/vue-mini'
const title = ref('标题')
const events = ref({
  fun: {
    onConfirm: () => console.log('确认'),
    onCancel: () => console.log('取消'),
  },
})
</script>

<template>
  <ChildComponent :title="title" :request="events" />
</template>

<!-- 子组件 -->
<script setup>
const { title, request } = defineProps<{
  title: string
  request: { fun: { onConfirm: () => void; onCancel: () => void } }
}>()

function handleConfirm() {
  request.fun.onConfirm()
}
</script>
```

### 页面跳转传参

**方式 1：defineProps（推荐）**

```vue
<script setup lang="ts">
const { id } = defineProps<{ id: string }>()
console.log(id)
</script>
```

**方式 2：onLoad**

```vue
<script setup>
import { onLoad } from '@unmagic/vue-mini'

function goToDetail(item) {
  wx.navigateTo({ url: `/pages/detail/DetailIndex?id=${item.id}` })
}

onLoad((options) => {
  console.log(options.id)
})
</script>
```

## 生命周期

**重要：** 所有生命周期都从 `@unmagic/vue-mini` 导入。`<script setup>` 在 `lifetimes.attached` 阶段执行。

### 页面组件生命周期

| VMS 生命周期        | 小程序原生方法              | 执行时机             |
| ------------------- | --------------------------- | -------------------- |
| `setup`             | `lifetimes.attached`        | 页面实例创建         |
| `onLoad`            | `methods.onLoad`            | 页面加载，可获取参数 |
| `onShow`            | `methods.onShow`            | 页面显示             |
| `onReady`           | `methods.onReady`           | 页面初次渲染完成     |
| `onHide`            | `methods.onHide`            | 页面隐藏             |
| `onUnload`          | `methods.onUnload`          | 页面卸载             |
| `onPullDownRefresh` | `methods.onPullDownRefresh` | 下拉刷新             |
| `onReachBottom`     | `methods.onReachBottom`     | 上拉触底             |
| `onPageScroll`      | `methods.onPageScroll`      | 页面滚动             |
| `onShareAppMessage` | `methods.onShareAppMessage` | 转发分享             |
| `onShareTimeline`   | `methods.onShareTimeline`   | 分享到朋友圈         |

### 自定义组件生命周期

| VMS 生命周期 | 小程序原生           | 执行时机       |
| ------------ | -------------------- | -------------- |
| `setup`      | `lifetimes.attached` | 组件实例创建   |
| `onReady`    | `lifetimes.ready`    | 组件布局完成   |
| `onMove`     | `lifetimes.moved`    | 组件位置变化   |
| `onDetach`   | `lifetimes.detached` | 组件从页面移除 |

**限制：** 自定义组件（非页面）中不能使用 `onLoad`/`onUnload`，请改用 `onReady`/`onDetach`。

### 组件中监听所在页面生命周期

| VMS 生命周期 | 小程序原生             | 执行时机         |
| ------------ | ---------------------- | ---------------- |
| `onShow`     | `pageLifetimes.show`   | 所在页面显示     |
| `onHide`     | `pageLifetimes.hide`   | 所在页面隐藏     |
| `onResize`   | `pageLifetimes.resize` | 所在页面尺寸变化 |

## 限制说明

### 不支持的 Vue 特性

**下表所有项均为「编译报错」：写了会立即失败并给出替代方案，不会静默出错。**
（`v-html`、`checkbox`/`radio` 的 v-model、`.prevent` 等均已如此处理，可放心依赖该行为。）

| 特性                              | 说明                                                   | 行为       | 替代方案                                                                                          |
| --------------------------------- | ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------- |
| `defineSlots`                     | 编译宏                                                 | 编译报错   | 小程序无插槽类型声明机制，可直接删除                                                              |
| `withDefaults`                    | 编译宏                                                 | 编译报错   | 用响应式 Props 解构默认值（Vue 3.5+）                                                             |
| `v-html`                          | 原始 HTML                                              | 编译报错   | `<rich-text nodes="{{...}}" />`                                                                   |
| `v-text`                          | 文本内容                                               | 编译报错   | `<text>{{ value }}</text>`                                                                        |
| `v-once` / `v-memo`               | 渲染优化                                               | 编译报错   | 小程序无需此优化，直接移除                                                                        |
| `v-cloak`                         | 防闪烁                                                 | 编译报错   | 小程序无此问题，直接移除                                                                          |
| Vue 内置组件                      | `<Teleport>` `<Transition>` `<KeepAlive>` `<Suspense>` | 编译报错   | 见各项替代方案；小写变体同样报错                                                                  |
| `<component :is>`                 | 动态组件                                               | 编译报错   | 改用 `wx:if`/`wx:elif` 按条件渲染                                                                 |
| 组合式函数                        | `useTemplateRef`, `useSlots` 等                        | 类型报错\* | 不支持                                                                                            |
| `v-bind="obj"`                    | 整体绑定对象                                           | 编译报错   | WXML 无法展开对象；逐个绑定 `:id="obj.id"`                                                        |
| `v-on="handlers"`                 | 整体绑定事件                                           | 编译报错   | WXML 无法展开对象；逐个绑定 `@tap="h.tap"`                                                        |
| `.prevent` / `.self` / `.once` 等 | 事件修饰符                                             | 编译报错   | 小程序事件无对应语义；见错误信息。`.stop`/`.mut`/`.capture`/`.capture-stop`/`.raw` **有映射可用** |
| `checkbox` / `radio` 的 v-model   | 事件值类型不匹配                                       | 编译报错   | `detail.value` 是数组；改用 `:checked` + 事件                                                     |

\* 组合式函数由 `@unmagic/vue-mini` 的类型声明覆盖：TypeScript 报
`has no exported member`。VMS 编译器不做 API 白名单校验。

### 命名注意事项

**props 属性名建议不要以 `data` 开头**（`data-` 是小程序 `dataset` 的保留前缀，VMS 编译器会自动生成 `data-a`、`data-b` 等属性用于传递 v-for 索引等数据，可能产生冲突）：

| 不推荐       | 推荐                       |
| ------------ | -------------------------- |
| `dataList`   | `list`, `items`, `records` |
| `dataType`   | `type`, `category`, `kind` |
| `dataSource` | `source`, `origin`, `from` |

### WXS 环境限制（编译器已自动处理）

模板中的动态表达式会被编译为 WXS（WeiXin Script），WXS 不支持以下语法，VMS 编译器会自动降级：

- 可选链 `?.` → 降级为条件判断
- `void 0` → 替换为 `undefined`
- `Array.isArray()` → 替换为类型检查
- 箭头函数 → 转换为普通函数
- 模板字符串 → 转换为字符串拼接
- `$` 变量名 → 替换为 `_`（避免与 WXS 内置冲突）

## 常见问题

### Q1: 模板中直接使用 wx 报错

在模板中直接使用 `wx` 会出现 TypeScript 错误。请在 script 中声明函数：

```vue
<script setup>
function navigateToDetail() {
  wx.navigateTo({ url: '/pages/detail' })
}
</script>

<template>
  <button @tap="navigateToDetail">跳转</button>
</template>
```

### Q2: 内联箭头函数的 .detail 处理

```vue
<!-- 正确：自动从 event.detail 取值 -->
<input @input="(value) => onInput(value)" />

<!-- 错误：会变成 e.detail.detail -->
<input @input="(e) => onInput(e.detail.value)" />

<!-- 需要完整事件对象时用 $event -->
<button @tap="($event) => onTap($event.currentTarget.dataset)">点击</button>
```

### Q3: v-for 中访问父级变量

```vue
<template>
  <div v-for="group of groups" :key="group.name">
    <div v-for="item of group.items" :key="item.name" @tap="onSelect(group, item)">
      {{ group.name }} - {{ item.name }}
    </div>
  </div>
</template>
```

### Q4: 首次渲染前 undefined 导致 TypeError

`@unmagic/vue-mini` 数据初始化时 undefined 值可能导致首次渲染前 WXS 抛出 TypeError。确保响应式数据在使用前有合理的初始值。

## 调试技巧

1. **查看编译输出** - 检查 `dist/dev/` 目录下的生成文件
2. **使用微信开发者工具** - 查看控制台输出和页面结构
3. **检查响应式数据** - 在开发者工具 AppData 面板查看
4. **查看 WXML** - 确认模板正确编译
5. **查看 WXS** - 动态 class/style 会生成 `<wxs>` 标签，检查生成逻辑

## 编译器架构（简要）

```
CLI 层 (cli.ts)        → 构建流程控制、文件监听、依赖扫描
    ↓
转换层 (transformer.ts) → 协调三路转换，输出 .wxml/.js/.wxss/.json
    ↓
模板层 (template/)      → Vue 模板 → WXML，管道式转换器
    ├── nodeProps/clazz.ts   → :class 处理（WXS 生成）
    ├── nodeProps/style.ts   → :style 处理
    ├── nodeProps/event.ts   → 事件处理器
    ├── nodeProps/slot.ts    → 插槽转译
    ├── expression.ts        → 表达式降级（babel）
    └── wxsPolyfill.ts       → WXS polyfill
    ↓
脚本层 (script/)        → script setup → defineComponent
    ├── macro/              → defineProps/defineEmits/defineExpose
    └── collectImports.ts   → 依赖收集
```

**核心技术：** `@vue/compiler-sfc` 解析 + `@babel/core` 转换 + `rolldown` 打包
