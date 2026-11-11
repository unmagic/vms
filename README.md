# VMS (Vue Mini SFC)

<p align="center">基于 Vue 3 的微信小程序单文件组件编译器，让你用 <code>&lt;script setup lang="ts"&gt;</code> 开发小程序。</p>

## 简介

**VMS** (Vue Mini SFC) 是一个构建工具，允许你使用 Vue 3 单文件组件（SFC）语法开发微信小程序。它将 `.vue` 文件编译为微信小程序原生代码（WXML + JS + WXSS + JSON），在保持 Vue 开发体验的同时，输出高性能的小程序代码。

运行时依赖 [`@unmagic/vue-mini`](https://github.com/unmagic/vms-vue-mini) —— 一个专为 VMS 深度优化的 Vue 3 小程序框架。

## 功能特性

- **Vue 3 SFC** - 完整的 `<script setup lang="ts">` + `<template>` + `<style>` 支持
- **响应式绑定** - 自动收集 `ref` / `reactive` / `computed`，注入到小程序数据系统
- **模板表达式** - 支持模板中的函数调用、方法访问、复杂表达式
- **Class / Style 绑定** - 支持 `:class` 和 `:style` 的响应式绑定（通过 WXS）
- **条件与列表渲染** - 支持 `v-if` / `v-else-if` / `v-else` 和 `v-for`
- **事件处理** - 支持内联事件处理器、参数传递、修饰符（如.stop）
- **插槽系统** - 支持默认插槽、具名插槽
- **第三方组件** - 支持原生小程序组件和 npm 组件库
- **分包支持** - 自动识别主包与独立分包，处理依赖复制
- **开发体验** - 文件监听、增量编译、错误代码帧定位

## 暂不支持（待完成）

以下 Vue 特性目前尚未支持，将在后续版本中逐步实现：

**下表所有项均为「编译报错」：写了会立即编译失败并给出替代方案，不会静默失效。**
（唯一的例外是 TypeScript 类型层面的报错，见下方 \* 说明。）

| 特性                            | 说明            | 行为       | 替代方案                                                                                                                |
| ------------------------------- | --------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `useTemplateRef`                | 组合式函数      | 类型报错\* | 使用小程序 `selectComponent` API                                                                                        |
| `useSlots`                      | 组合式函数      | 类型报错\* | 不支持                                                                                                                  |
| `defineSlots`                   | 编译宏          | 编译报错   | 小程序无插槽类型声明机制，可直接删除                                                                                    |
| `withDefaults`                  | 编译宏          | 编译报错   | 使用响应式 Props 解构默认值（Vue 3.5+ 推荐）                                                                            |
| `v-html`                        | 原始 HTML       | 编译报错   | `<rich-text nodes="{{...}}" />`                                                                                         |
| `v-text`                        | 文本内容        | 编译报错   | `<text>{{ value }}</text>`                                                                                              |
| `v-once` / `v-memo`             | 渲染优化        | 编译报错   | 小程序无需该优化，直接移除                                                                                              |
| `v-cloak`                       | 防闪烁          | 编译报错   | 小程序无此问题，直接移除                                                                                                |
| `<Teleport>`                    | 传送组件        | 编译报错   | 把内容直接写在目标位置                                                                                                  |
| `<Transition>`                  | 过渡组件        | 编译报错   | CSS `transition`/`animation` 或 `wx.createAnimation`                                                                    |
| `<KeepAlive>`                   | 缓存组件        | 编译报错   | 用 `wx:if` 配合状态保持                                                                                                 |
| `<Suspense>`                    | 异步组件        | 编译报错   | VMS 为同步编译，可直接移除                                                                                              |
| `<component :is>`               | 动态组件        | 编译报错   | 改用 `wx:if`/`wx:elif` 按条件渲染                                                                                       |
| 内置组件小写变体                | `<teleport>` 等 | 编译报错   | 同上（与 Vue 的 `isCoreComponent` 判定一致）                                                                            |
| `v-bind="obj"`                  | 整体绑定对象    | 编译报错   | WXML 无法展开对象，请逐个绑定 `:id="obj.id"`                                                                            |
| `v-on="handlers"`               | 整体绑定事件    | 编译报错   | WXML 无法展开对象，请逐个绑定 `@tap="h.tap"`                                                                            |
| `.prevent` `.`self` `.`once` 等 | 事件修饰符      | 编译报错   | 小程序事件无对应语义；见错误信息中的替代方案（`.stop`/`.mut`/`.capture`/`.capture-stop`/`.raw` **有映射，可正常使用**） |

\* 组合式函数由 `@unmagic/vue-mini` 的类型声明覆盖：TypeScript 会在编译期报
`has no exported member`。VMS 编译器不重复做 API 白名单校验——那会与运行时
演进失配，且属重复实现类型检查。

### v-model 双向绑定（已支持）

支持原生表单标签（`input`/`textarea`/`switch`/`picker`/`slider`/`picker-view`/`radio-group`）和自定义组件的 `v-model` / `v-model:xxx`，包括 v-for 场景（通过 dataset 索引回写）：

```vue
<input v-model="text" />
<MyComp v-model:title="title" />
<input v-for="(item, index) in list" :key="item.id" v-model="item.name" />
```

支持的修饰符：`.number`（转数字）、`.trim`（去首尾空格），二者仅对 `input` / `textarea` 等字符串值标签及自定义组件有效。

> **`.lazy` 暂不支持**：Vue 通过 `modelModifiers` 把修饰符传给子组件，由子组件决定何时 emit；VMS 尚无等价机制，父组件无法告知子组件延迟同步。因此 `.lazy` 目前会**编译报错**（而非静默忽略），原生标签与自定义组件均报错。如需延迟同步，请在子组件内部选择合适的时机触发 `update` 事件。

> **限制**：`checkbox` / `checkbox-group` / `radio` 不支持 v-model（其 `detail.value` 是数组，与单值绑定语义不匹配），请使用 `:checked` + 事件手动处理。

> **事件取值位置**：原生表单标签的 `v-model` 从 `e.detail.value` 取值；
> **自定义组件**（含 `defineModel`）从 **`e.detail`** 取值——子组件通过
> `triggerEvent(name, value)` 传值时，微信把第二个参数整体作为 detail。
> 二者由编译器自动区分，无需手写处理。

### defineModel 编译宏（已支持）

子组件通过 `defineModel` 声明双向绑定属性（默认 prop 名为 `modelValue`，可传入自定义名），配合父组件的 `v-model` / `v-model:xxx` 使用：

```vue
<script setup lang="ts">
const title = defineModel<string>('title')
const rename = () => {
  title.value = 'new'
}
</script>
```

### 插槽（默认 / 具名 / 作用域，含 v-for 场景）

支持默认插槽、具名插槽和作用域插槽，可在 v-for 内向外层变量与插槽变量混合取值。

> **注意**：作用域插槽基于 glass-easel 的 `dynamicSlots` 能力实现，需要在 `vms.config.js` 中开启 `glassEasel: true`（并要求基础库 >= 3.8.12），否则作用域插槽的数据传递不会生效。默认插槽与具名插槽无此依赖。

## 安装

```bash
npm install -D @unmagic/vms
# 或
pnpm add -D @unmagic/vms
```

## CLI 命令

安装后在项目目录下直接执行：

```bash
# 开发模式（文件监听 + 增量编译）
vms dev

# 生产构建
vms build

# 生产构建并上传小程序
vms build --upload
```

## 配置

在项目根目录创建 `vms.config.js`

```js
export default {
  // 微信小程序上传配置
  wx: {
    appid: 'your-appid',
    privateKeyPath: '/path/to/private.key',
    name: 'your-name',
    email: 'your@email.com',
    version: '1.0.0',
    description: '项目描述',
  },

  // 源码目录（默认 'src'）
  sourceDir: 'src',

  // 输出目录（默认 'dist'）
  outputDir: 'dist',

  // 路径别名
  alias: {
    '@': './src',
  },

  // 第三方组件匹配（可选）
  component: {
    prefix: 't-',
    pathPrefix: 'tdesign-miniprogram',
  },

  // 跳过 Babel 编译直接复制的文件规则
  copyOnly: [],

  // 启用 glass-easel 组件框架（可选，默认 false）
  // 需要微信基础库 >= 3.8.12；作用域插槽依赖此开关（dynamicSlots 能力）
  glassEasel: false,
}
```

## 快速开始

### 1. 创建应用入口

```ts
// src/app.ts
import { createApp, onAppShow } from '@unmagic/vue-mini'

createApp({
  setup(options) {
    console.log('App Launched!', options)

    onAppShow((opts) => {
      console.log('App Show!', opts)
    })
  },
})
```

### 2. 创建页面

```vue
<!-- src/pages/index/Index.vue -->
<script setup lang="ts">
import { ref, computed } from '@unmagic/vue-mini'

const count = ref(0)
const double = computed(() => count.value * 2)

const increment = () => {
  count.value++
}
</script>

<template>
  <view class="container">
    <text>Count: {{ count }}</text>
    <text>Double: {{ double }}</text>
    <button @click="increment">+1</button>
  </view>
</template>

<style>
.container {
  padding: 20px;
}
</style>
```

### 3. 注册页面

```json
// src/app.json
{
  "pages": ["pages/index/Index"]
}
```

### 4. 启动开发

```bash
vms dev
```

编译输出到 `dist/` 目录，可直接使用微信开发者工具打开。

## AI 开发助手（Agent Skill）

VMS 项目内置了 AI Skill 文件，可配置到你的 AI 编程助手（如 Qoder、Cursor 等支持 Skill/Rule 的工具）中，让 AI 更准确地理解和生成 VMS 代码。

### 获取 Skill

Skill 文件位于 VMS 仓库的 [`skills/vms/SKILL.md`](https://github.com/unmagic/vms/blob/main/skills/vms/SKILL.md)。

```bash
# 安装 vms skill
npx skills add https://github.com/unmagic/vms/blob/main/skills/vms/SKILL.md

```

配置后，AI 助手在协助你在使用 VMS 编写微信小程序项目代码时，会自动遵循 Skill 中的语法规范和最佳实践。

### Skill 内容涵盖

- VMS 基础语法（`<script setup lang="ts">`、事件绑定、`v-for`、`v-show`）
- 响应式数据（`ref`、`computed`、`watch`）
- Class / Style 绑定规则
- 插槽使用与限制
- 组件通信（函数传递、页面跳转传参）
- 生命周期对照表
- 已知限制与替代方案
- 常见问题和调试技巧

## 已知限制

### WXS 环境兼容性

VMS 生成的 WXS 代码运行在微信小程序的 WXS 环境中，该环境有以下限制，编译器会自动处理：

| 特性                 | 处理方式               |
| -------------------- | ---------------------- |
| `?.` 可选链          | 自动降级为条件表达式   |
| `void 0`             | 自动替换为 `undefined` |
| `$` 标识符           | 自动替换为 `_`         |
| 箭头函数、模板字符串 | 自动降级               |

### 首次渲染与 undefined

组件初始化时部分响应式变量可能为 `undefined`。建议：

- 在 `setup` 中设置合理的初始值
- 或在模板中使用 `?.` 可选链

```vue
<!-- 推荐 -->
<view :class="{ active: user?.isAdmin }">

<!-- 不推荐：可能因 undefined 报错 -->
<view :class="{ active: user.isAdmin }">
```

## 项目结构示例

```
project/
├── src/                   # 源代码目录
│   ├── pages/             # 页面
│   ├── components/        # 组件
│   ├── subXXX/            # 分包
│   ├── app.ts             # 应用入口
│   ├── app.json           # 小程序配置
│   └── app.wxss           # 全局样式
├── dist/                  # 编译输出目录
├── vms.config.js          # VMS 配置
└── package.json
```

## 相关项目

- [`@unmagic/vue-mini`](https://github.com/unmagic/vms-vue-mini) - VMS 配套的运行时框架
- [Vue Mini](https://github.com/vue-mini/vue-mini) - 原版的 Vue 3 小程序框架

## 许可证

[MIT](https://opensource.org/licenses/MIT)

Copyright (c) 2026-present Liu Biao
