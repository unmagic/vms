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

| 特性 | 说明 | 替代方案 |
|------|------|---------|
| `v-model` | 双向绑定 | 使用 `:value` + `@input` 手动实现 |
| `defineModel` | 编译宏 | 使用 `props` + `emit` 手动实现 |
| `useTemplateRef` | 组合式函数 | 使用小程序 `selectComponent` API |
| `v-bind="obj"` | 整体绑定对象 | 暂无支持计划 |
| `defineSlots` | 编译宏 | 不支持 |
| 作用域插槽 | 插槽数据回传 | 难度大，排期优先级低 |
| `<transition>` | 过渡组件 | 不支持 |
| `<keep-alive>` | 缓存组件 | 不支持 |
| `<Teleport>` | 传送组件 | 不支持 |
| `<component :is>` | 动态组件 | 暂不支持 |
| `v-html` | 原始 HTML | 不支持 |
| `useSlots` | 组合式函数 | 不支持 |
| `v-once` / `v-memo` | 渲染优化 | 不支持 |

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
  "pages": [
    "pages/index/Index"
  ]
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

| 特性 | 处理方式 |
|------|---------|
| `?.` 可选链 | 自动降级为条件表达式 |
| `void 0` | 自动替换为 `undefined` |
| `$` 标识符 | 自动替换为 `_` |
| 箭头函数、模板字符串 | 自动降级 |

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
