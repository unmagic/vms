# VMS 运行时验证清单（微信开发者工具模拟器）

静态产物审查能发现「产物是否合法」，但无法回答「运行起来是否正确」。
本清单记录需要**真实模拟器**才能验证的项，供后续改动回归时复查。

## 语法测试场（推荐入口）

示例项目内置了一个可直接点选测试的**语法测试场** tab（tabBar 第 4 项「测试场」）：

- 首页：`src/pages/playground/PlaygroundIndex.vue` —— 列出 8 个语法块
- 各块页面：`src/playground/pages/<block>/*.vue`（独立子包）
- 覆盖：① v-model ② 事件绑定 ③ 列表渲染 ④ 表达式与 WXS 降级
  ⑤ 条件渲染 ⑥ 组件通信与插槽 ⑦ 计算属性 ⑧ 样式绑定

**用法**：进入「测试场」→ 点任意卡片进入该块 → 在模拟器中直接交互
（输入框、按钮）→ 观察页面上的实时取值。

**注意**：作用域插槽需要 `glassEasel: true`（已在 `example/vms.config.js` 开启，
要求基础库 ≥ 3.8.12；示例项目 `libVersion` 为 3.15.0）。

> ⚠️ **作用域插槽在本环境的已知限制（2026-09-14 实测）**
>
> 即使满足上述要求，模拟器中作用域插槽的数据仍取不到值（渲染为空）。
> 已用**手工书写的原生 glass-easel 示例**（逐字照抄官方文档的
> `<slot item="{{it}}"` + `<view slot:item>`）做对照，**同样为空**——
> 说明属模拟器/基础库环境限制，**不是 VMS 转译问题**，VMS 产物与官方文档一致。
>
> 排查时另注意：`project.private.config.json`（**gitignored**）会覆盖
> `project.config.json` 的 `libVersion`。本机该文件值为 `2.27.3`，
> 而 `dynamicSlots` 要求 ≥ 3.8.12。可用
> `automation_runtime_info --action systemInfo` 查看实际 `SDKVersion`。

## 前置

```bash
wechatide -c <clientName> check_wechatide_status --skill-version <ver>   # 门禁
wechatide -c <clientName> open_project_window --project <abs>/vms/example
```

注意：示例项目 `project.config.json` 的 `miniprogramRoot` 指向 `dist/dev`，
因此需先以 **dev 模式**构建（`node ../bin/index.js dev`，并保持 watcher 存活）——
仅跑 `build`（输出 `dist/prod`）会导致模拟器报 `no found app.json`。

## 已验证项（2026-09-14）

| 项                          | 方法                                                                  | 结果                                                            |
| --------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------- | ------- |
| 小程序能否启动              | `automation_runtime_info --action currentPage`                        | ✅ 正常，落地首页                                               |
| 三个主 tab 页               | `automation_navigate --action switchTab`                              | ✅ 均可导航                                                     |
| 多个分包页                  | `automation_navigate --action navigateTo`                             | ✅ 均可导航                                                     |
| JS 运行时错误               | `get_simulator_console --command 'grep -inE "TypeError                | ReferenceError                                                  | is not a function"'` | ✅ 0 条 |
| VMS 编译告警                | `get_simulator_console --command 'grep -iE "\[vms\]"'`                | ✅ 0 条                                                         |
| 页面 DOM 渲染               | `automation_viewport_action --action screenshot`                      | ✅ 正常显示                                                     |
| `ref` 是否正确解包进 data   | `automation_evaluate` 读取 `getCurrentPages()[n].data`                | ✅ 值为 string/array/object，非 Ref 对象                        |
| `<block>` 是否为虚拟节点    | `automation_page_action --action querySelectorAll --selector 'block'` | ✅ 返回空数组（无 DOM 存在）                                    |
| 控件选择器可用性（对照）    | 同上，selector 用 `view` / `input` / `.form-label`                    | ✅ 均能命中                                                     |
| **事件处理器函数能否存活**  | `automation_evaluate` 读 `data` 中 `typeof v === 'function'` 的键     | ✅ 首页 7 个处理器均为 `function`（VMS 的核心桥接机制成立）     |
| **状态是否已解包**          | `automation_evaluate` 读各键的 `typeof`                               | ✅ 为 `string` / `array` / `object`，**不是** Ref 对象          |
| `__vmsRenderState` 是否外泄 | 同上，检查 `data` 中的 `__vms*` 键                                    | ✅ 渲染态未出现在 `data` 中（未污染模板数据）                   |
| **事件桥接端到端**          | `automation_element_action --action tap` 点真实元素                   | ✅ 点卡片头部 → 首页跳转到账单页；`navigateBack` 后页栈正确复原 |
| 交互过程无报错              | 上述操作后查 console                                                  | ✅ 0 条 JS 错误                                                 |
| **WXS polyfill 运行时**     | 导航到使用 `__vmsWXSUtils.filter` 的页面                              | ✅ 正常渲染，无 WXS 相关报错                                    |

### v-model 运行时验证（临时探针页，2026-09-14）

示例项目**未使用 `v-model`**，因此该特性此前只有单元测试、无运行时验证。
本轮建临时页面实测四种形态后已删除，结论：

| 形态                             | 方法                                     | 结果                                        |
| -------------------------------- | ---------------------------------------- | ------------------------------------------- |
| 基础 `v-model="text"`            | 输入 `hello-vmodel`，读 `p.data.text`    | ✅ `"hello-vmodel"`                         |
| 模板联动                         | 读 `.probe-echo` / `.probe-len` 元素文本 | ✅ `echo:hello-vmodel` / `len:12`           |
| 嵌套 `v-model="form.name"`       | 输入 `nested-val`，读 `p.data.form.name` | ✅ `"nested-val"`                           |
| 修饰符 `v-model.trim`            | 输入 `"  spaced  "`，读 `p.data.trimmed` | ✅ `"spaced"`（前后空格已去除）             |
| **v-for 内 `v-model="it.name"`** | 输入后读 `p.data.items`                  | ✅ 仅目标项变化：`["changed-in-vfor", "b"]` |

v-for 场景的 setter 产物：

```js
__fun_3(e) { const { a: [i] } = e.currentTarget.dataset; const it = __vmsProxyRefs.items[i]; it.name = e.detail.value }
```

即 **dataset 索引 → 数组定位 → 赋值**，与 WXML 中 `data-a="{{[i]}}"` 配套；
运行时确认索引定位准确（**未误改其它项**）。

> 工具边界：选择器**不支持 `nth-child`**（返回 MCP_TOOL_ERROR）；
> 命中多个元素时 `input` 作用于第一个。探针页与 `app.json` 改动已还原。

### 与既有文档的呼应

`docs/微信小程序自定义组件函数传参验证结论.md`（2026-04-23，模拟器 + 真机）
记录了三条结论，其中"函数能通过 property 传递"是 VMS 事件桥接的前提。
本轮实测从**编译产物**侧再次确认了这一点：首页 `data` 中的 7 个事件处理器
均为可调用的 `function`。两份结论互相印证。

## 已知工具边界

- 页面级 `querySelectorAll` **不穿透自定义组件**：查询组件内部的 class
  （如 tdesign 的 `.t-input__placeholder`）返回空数组，这不代表样式未生效。
  类似 `:deep()` 这类跨组件样式的验证需另找手段（如组件内查询）。
- `automation_runtime_info` 在模拟器**尚未编译完成**时会超时；
  先等待或先 `simulator_refresh` 再重试。
- **开发者工具会改写 `example/project.config.json`**（开窗后 `setting.condition`
  由 `true` 变为 `false`，并在文末去掉换行）。这是工具自身行为，不是 VMS 的问题，
  但会让 `example` 仓库出现意外改动。跑完模拟器后建议：
  `git -C vms/example checkout -- project.config.json`

## 维护提示

每轮自动化回归（vitest / verify-artifacts）**不覆盖**本清单——它需要开发者工具
与人工授权。建议在以下时机手动跑一遍：

- 改动模板代码生成（`src/template/**`）后
- 改动运行时解包逻辑（`vue-mini` 的 `deepToRaw` / `proxyRefs`）后
- 引入或升级基础库前
