# VMS 项目优化点清单

> 本文档记录 VMS (Vue Mini Program SFC) 项目的待优化问题和改进建议。
> 最后更新：2026-09-14（复核 P1/P2 状态，同步实际代码指标）

---

## 优先级说明

| 优先级 | 标识     | 说明                                                 |
| ------ | -------- | ---------------------------------------------------- |
| 🔴 P0  | 必须修复 | 影响功能正确性、导致内存泄漏或影响实际使用的严重问题 |
| 🟠 P1  | 应该优化 | 影响可维护性、性能或有显著改进空间的问题             |
| 🟡 P2  | 技术债务 | 可接受但值得改进的设计问题或底层优化                 |

---

## 🔴 P0 - 必须修复

### P0-1: `pageComponentCache` 缓存一致性问题

- **位置**: `src/cli.ts:43`
- **问题**: `app.json` 变更后 `pagePaths` 会重新加载，但 `pageComponentCache` 缓存不会自动清理，导致返回陈旧结果
- **影响**: 修改 `app.json` 添加/删除页面后，`isPageComponent()` 可能返回错误结果
- **建议**: 在 `app.json` 变更时清空缓存
- **状态**: ✅ 已修复（2026-05-05）

**修复内容**：

1. 添加 `clearAllCaches()` 函数清空所有缓存（`pageComponentCache`、`pathCache`、`pagePaths`）
2. 在 `change` 事件处理器中检测 `app.json` 变更并自动调用 `clearAllCaches()`
3. 清空后重新调用 `loadPagePaths()` 加载最新页面路径

### P0-2: `pathCache` 缓存一致性问题

- **位置**: `src/cli.ts:200`
- **问题**: 同 `pageComponentCache`，`app.json` 变更后可能返回陈旧路径
- **影响**: 同上
- **建议**: 在 `app.json` 变更时清理
- **状态**: ✅ 已修复（2026-05-05）

**修复内容**：

- `clearAllCaches()` 函数中包含 `pathCache.clear()`
- `app.json` 变更时自动清空

### P0-3: `handleDefineProps` 未处理带默认值的赋值解构

- **位置**: `src/script/scopeAnalyzer.ts:150-165`
- **说明**: **已在别处处理**。默认值解构的实际处理在 `src/script/macro/props.ts:39-50` 中完成
- **原因**: `scopeAnalyzer.ts` 中的 `handleDefineProps` 用于作用域分析，而实际的 props 解构处理（包括默认值）在 `macro/props.ts` 的 `dealMacroProps` 函数中
- **状态**: ✅ 已在 `macro/props.ts` 中处理，无需在 `scopeAnalyzer.ts` 中重复处理

---

## 🟠 P1 - 应该优化

### P1-1: `eventProcessor.ts` 文件过大

- **位置**: `src/template/nodeProps/eventProcessor.ts`
- **问题**: 文件有 1,341 行，职责过多（事件处理、表达式解析、辅助函数等）
- **影响**: 可维护性差，代码导航困难
- **建议**: 按功能拆分为：
  - `eventProcessor.ts` - 主流程
  - `eventHelpers.ts` - 辅助函数（已有部分，可扩展）
  - `expressionParser.ts` - 表达式解析逻辑
- **状态**: ✅ 已拆分为 4 个文件（eventProcessor.ts 759行 + eventHelpers.ts 581行 + variableCollector.ts 199行 + inlineHandler.ts 484行）

### P1-2: `checkSlotsUsage` 使用字符串搜索

- **位置**: `src/script/index.ts:33`
- **问题**: 使用 `includes('slot')` 或 `includes('Slot')` 进行字符串匹配，可能误判
- **示例**: 如果模板中有 `<slot>` 以外的包含 "slot" 的字符串（如注释、动态内容），会误判
- **建议**: 使用 Vue 编译器生成的 AST 检查是否有 slot 节点
- **状态**: ✅ 已修复（改为基于 AST 的迭代式遍历，精确匹配 `tag === 'slot'`，同时避免深层模板递归爆栈）

### P1-3: `as any` 类型断言仍有 26 处

- **位置**: 分散在多个文件中
  - `src/template/index.ts`: 5 处
  - `src/template/tools.ts`: 8 处
  - `src/utils/tools.ts`: 4 处
  - 其他文件: 9 处
- **问题**: 过度使用 `as any` 会失去 TypeScript 的类型保护
- **建议**: 逐步用正确类型替换，特别是工具函数中的返回值类型
- **状态**: ✅ 已清理完成（从 25 处降到 0 处）

### P1-4: `ensureCoreImport` 重复遍历 importAST

- **位置**: `src/script/index.ts:34-65`
- **问题**: 第一次遍历检查是否存在，第二次遍历查找现有导入，可能重复扫描
- **建议**: 合并为单次遍历
- **状态**: ✅ 已合并为单次遍历

### P1-5: `scopeAnalyzer.ts` 中多个查询函数模式重复

- **位置**: `src/script/scopeAnalyzer.ts:261-277`
- **问题**: `isPropsVariable`、`isMacroVariable`、`isImportVariable`、`isGlobalVariableInScope` 函数模式相似
- **建议**: 可以合并为一个通用的查询函数，或统一返回变量的完整信息
- **状态**: ✅ 评估后保留现有 API（函数简洁清晰，合并反而降低可读性）

---

## 🟡 P2 - 技术债务

### P2-1: `replacePropsAccessInFunction` 手写 AST 遍历

- **位置**: `src/script/index.ts:614-653`
- **问题**: 使用 `VISITOR_KEYS` 手写遍历，而非 `@babel/traverse`
- **说明**: 当前实现已经使用 `VISITOR_KEYS` 进行了优化，但仍然是手写遍历
- **建议**: 评估是否可以用 `@babel/traverse` 替代（需要考虑性能）
- **状态**: ✅ 已优化（使用 VISITOR_KEYS）

### P2-2: `reparseBodyAsAST` 中的序列化/反序列化

- **位置**: `src/template/nodeProps/eventProcessor.ts:47-56`
- **问题**: 将 AST 序列化为代码字符串，再重新解析，有性能开销
- **说明**: 这是为了获取完整的 scope 信息，但有改进空间
- **建议**: 研究是否可以直接修改 AST 而不需要重新解析
- **状态**: 📋 技术债

### P2-3: `globalWhitelist.ts` 黑名单机制

- **位置**: `src/utils/globalWhitelist.ts`
- **问题**: 使用黑名单（排除某些全局变量），可能遗漏新的全局 API
- **建议**: 改用白名单机制，明确声明哪些全局变量可用
- **状态**: ✅ 已改为白名单（`GLOBAL_WHITELIST`，仅列出小程序运行时实际存在的全局标识符与 ECMAScript 内置对象，不包含 Web / DOM / Node.js 专属 API）

### P2-4: 错误恢复使用默认 AST

- **位置**: `src/script/index.ts:86-98`
- **问题**: 当 Babel 解析失败时，生成一个空的 AST 继续运行，可能导致后续错误难以追踪
- **建议**: 考虑是否应该直接抛出错误，或在错误恢复时添加更明显的警告
- **状态**: 📋 设计讨论

### P2-5: `as any` 类型断言（详细列表）

- **位置**: 各文件
- **说明**: 以下是具体的 `as any` 使用位置（共 0 处，已全部清理）

| 文件                               | 行数  | 主要位置           |
| ---------------------------------- | ----- | ------------------ |
| `src/template/index.ts`            | 0     | 已使用具体类型替换 |
| `src/template/nodeProps/clazz.ts`  | 0     | 已使用具体类型替换 |
| `src/template/nodeProps/slot.ts`   | 0     | 已使用具体类型替换 |
| `src/template/propTransformers.ts` | 0     | 已使用具体类型替换 |
| `src/template/tools.ts`            | 0     | 已使用具体类型替换 |
| `src/utils/babelTraverse.ts`       | 0     | 已使用具体类型替换 |
| `src/utils/errorHandler.ts`        | 0     | 已使用具体类型替换 |
| `src/utils/tools.ts`               | 0     | 已使用具体类型替换 |
| **合计**                           | **0** |                    |

---

## 已解决的问题

| 编号          | 描述                                        | 解决方案                      |
| ------------- | ------------------------------------------- | ----------------------------- |
| ~~P0-1 (旧)~~ | `replacePropsAccessInFunction` 手写遍历 AST | 已使用 `VISITOR_KEYS` 优化    |
| ~~P1-4 (旧)~~ | `batchProcess` 不是真并发池                 | 已使用 `Promise.all` 分批处理 |
| ~~清理~~      | `as any` 从 87 处降到 26 处                 | 逐步替换为正确类型            |
| ~~P1-3~~      | `as any` 从 26 处降到 0 处                  | 使用类型增强和具体类型替换    |
| ~~P1-4~~      | `ensureCoreImport` 重复遍历                 | 合并为单次遍历                |
| ~~P1-1~~      | `eventProcessor.ts` 过大                    | 拆分为 4 个文件               |

---

## 关键数据

| 指标            | 数值                                   |
| --------------- | -------------------------------------- |
| 总代码行数      | 10,133 行（`src/`）                    |
| 最大单文件      | `cli.ts` (885 行)                      |
| `as any` 数量   | 0 处                                   |
| 全局缓存 Map    | 2 个（pageComponentCache、pathCache）  |
| 缓存一致性问题  | ✅ 已修复（P0-1/P0-2）                 |
| P0-3 默认值处理 | ✅ 已在 `macro/props.ts` 中处理        |
| 待优化 P1 问题  | 0 个（全部完成或评估后保留）           |
| 技术债 P2 问题  | 2 个（P2-2 重解析开销、P2-4 错误恢复） |

---

## 建议修复顺序

1. **优先级 1**: P2-4 - 解析失败时的错误恢复策略（当前静默使用空 AST，易掩盖真实编译错误）
2. **优先级 2**: 拆分 `cli.ts`（885 行，构建/watch/上传/Babel 混在同一文件）
3. **优先级 3**: P2-2 - 消除 `reparseBodyAsAST` 的序列化-重解析开销
4. **优先级 4**: 为 `glassEasel` / 作用域插槽补充端到端构建断言

> P0 与 P1 问题均已清零，历史修复记录见下方"已修复问题"。

---

_本文档由 AI 在分析代码后自动生成，记录了项目中的优化点和技术债务。_

---

## 已修复问题

### 2026-05-05

✅ **P0-1**: `pageComponentCache` 缓存一致性问题

- 添加 `clearAllCaches()` 函数（清理 `pageComponentCache`、`pathCache`、`pagePaths`）
- `app.json` 变更时自动清空缓存并重新加载页面路径

✅ **P0-2**: `pathCache` 缓存一致性问题

- 集成到 `clearAllCaches()` 函数中

✅ **P0-1 (旧)**: `replacePropsAccessInFunction` 手写遍历 AST

- 改用 `VISITOR_KEYS` 实现

✅ **P1-4 (旧)**: `batchProcess` 不是真并发池

- 已使用 `Promise.all` 分批处理

✅ **清理**: `as any` 从 87 处降到 26 处

**说明**：P0-3（默认值解构）已在 `src/script/macro/props.ts:39-50` 中处理，无需重复处理。

### 2026-06-16

✅ **P1-3**: `as any` 类型断言清理（从 25 处降到 0 处）

- 添加 Vue 编译器核心类型扩展（`__vmsCodegenNode`、`vForInfoList`）
- 使用具体类型替换所有 `as any`（`ElementNode`、`RootNode`、`TextNode`、`CommentNode` 等）
- 修复 lint 警告（未使用的类型导入）

✅ **P1-4**: `ensureCoreImport` 合并为单次遍历

- 将两次 `importAST` 遍历合并为一次循环
- 先查找 vue-mini import 并检查 specifier 是否存在，再决定追加或新建

✅ **P1-1**: `eventProcessor.ts` 拆分评估

- 当前已拆分为 4 个文件（eventProcessor.ts 759行 + eventHelpers.ts 581行 + variableCollector.ts 199行 + inlineHandler.ts 484行）
- 主文件 759 行合理，无需进一步拆分

✅ **P1-5**: `scopeAnalyzer.ts` 查询函数评估

- 保留现有 API（函数简洁清晰，合并反而降低可读性）

### 2026-09-14

✅ **校验加固**: `verify-artifacts` 新增 WXML 表达式检查（并补上它自身的首个测试）

- **动机**: 前几轮修的 `+` / `**` / `>>>` 这三个缺陷，**产物校验器完全看不到**——
  它检查了 WXS 内容、WXML 结构、JS 合法性，却从不检查 **WXML 表达式语法**。
  因此这类问题只能靠真机发现。本轮把这个盲区补上。
- **新增检查（3 条）**: WXML 表达式中不得出现
  | 形式 | 微信编译器报错 |
  | ---- | -------------- |
  | 一元 `+` | unexpected token + |
  | `**` | unexpected token \* |
  | `>>>` | unexpected token > |
  - 三者均**整个页面无法加载**；编译器应改由 WXS 求值
- **防误报设计（重要）**: WXML 支持 `+ - * / % << >> & | ^ ===` 与一元 `! - ~ !!`，
  这些都**不能**报。「一元 +」的判定限定为"表达式以 + 开头"，
  以免把 `a + b`、`'x' + a`、`fn(a) + b` 这类合法拼接误判
  - 已构造 19 个合法表达式逐一验证**零误报**
- **真机对照确认**: 用含 3 个非法 + 1 个合法（`<<`）的样例运行，
  恰好报出 3 个问题、放行合法项
- **补上校验器自身的测试**: `tests/verify-artifacts-wxml-expr.test.ts`（22 个用例）
  - 该脚本此前**没有任何单元测试**，我的新检查若写错不会被发现
  - 3 个"必须报告" + 18 个"不得误报" + 1 个 strict 退出码
  - 已注入验证：把检查文案改为禁用后，3 个"必须报告"用例**确实失败**
- **真实产物**: 扫描 **1686** 个 WXML 表达式，`--strict` 通过
  ✅ **Bug 修复**: `**` 与 `>>>` 同样让整个页面编译失败

- **发现方式**: 把上一轮"枚举 → 真机逐项验证"的方法**系统化**：
  先用编译器把 20 个表达式分类为 DIRECT / WXS，再对 **全部 DIRECT 项**一次性真机验证
  （而不是只测碰巧想到的几个）
- **WXML 不支持的运算符（实测）**:
  | 运算符 | 微信编译器报错 | 处理 |
  | ------ | -------------- | ---- |
  | `**`（幂） | `unexpected token '*'` | **改走 WXS** |
  | `>>>`（无符号右移）| `unexpected token '>'` | **改走 WXS** |
  | 一元 `+`（round 83 已修） | `unexpected token '+'` | 改走 WXS |
  - 三者后果相同且严重：**整个页面无法加载**，而非单个字段为空
- **对照实测（WXML 均支持，保持 DIRECT）**:
  `<<` `>>` `%` `&` `|` `^` `*` `/` 二进制 `+` `===`、一元 `!` `-` `~` `!!`
- **修复**: `isComplexExpression` 的 BinaryExpression 分支对
  `operator === '**' || operator === '>>>'` 返回 true（与一元 `+` 同一处理方式）
- **真机 A/B 复验**:
  | 模板 | 修复前 | 修复后 |
  | ---- | ------ | ------ |
  | `{{ num ** 2 }}` | 整页无法加载 | **4** ✅ |
  | `{{ num >>> 1 }}` | 整页无法加载 | **1** ✅ |
  | `{{ num << 1 }}`（对照） | 4 ✅ | 4 ✅ 不变 |
  | `{{ num ^ 1 }}`（对照） | 3 ✅ | 3 ✅ 不变 |
  - `**` 被 Babel 降级为 `Math.pow(num, 2)`（WXS 中 Math.pow 是官方支持的）
- **影响面**: 真实项目模板中**零处**使用（已扫描源码与产物确认）
- **回归测试**: 新增 `tests/wxml-unsupported-operators.test.ts`（17 个用例：
  5 个必须走 WXS、12 个必须保持 DIRECT，防止过度转译）
  - 已注入验证：移除路由后测试**确实失败**（非假校验）
    ✅ **Bug 修复**: 一元 `+` 让整个页面编译失败（WXML 不支持一元加号）

- **发现方式**: 上一轮探测中偶然看到 `unexpected token '+'`，本轮专门排查
- **现象**: 模板写 `{{ +str }}` 时，产物原样输出到 WXML，微信编译器报
  `Bad value with message: unexpected token '+'`，
  **整个页面无法加载**（不是该表达式为空，而是整页白屏）
- **逐项实测（WXML 表达式解析器）**:
  | 运算符 | WXML 是否支持 | 处理 |
  | ------ | ------------- | ---- |
  | 一元 `+` | ❌ 报 unexpected token | **改走 WXS** |
  | 一元 `-` / `!` / `~` / `!!` | ✅ | 保持 DIRECT |
  | 二进制 `+` | ✅ | 保持 DIRECT |
  | `===` | ✅ | 保持 DIRECT |
  - 且 WXS 中一元 `+` 合法（实测 `+str` → 7），因此只需换求值位置
- **修复**: `isComplexExpression` 对 `operator === '+'` 返回 true，
  使一元 `+` 走 WXS 函数生成路径（与 `typeof` 同一处理方式）
- **真机 A/B 复验**:
  | 模板 | 修复前 | 修复后 |
  | ---- | ------ | ------ |
  | `{{ +str }}` | 整页无法加载 | **7** ✅ |
  | `{{ +str + 1 }}` | 整页无法加载 | **8** ✅ |
  | `{{ -num }}` | `-1.5` ✅ | `-1.5` ✅ 不变 |
  | `{{ !flag }}` | `false` ✅ | `false` ✅ 不变 |
- **影响面**: 真实项目模板中**零处**使用一元 `+`（已扫描并确认），属潜在缺陷；
  但它的后果比其他缺值问题严重得多——**整页白屏**而非单个字段为空
- **回归测试**: 新增 `tests/unary-plus-wxs.test.ts`（8 个用例：
  3 个一元 + 必须走 WXS、4 个其它一元运算符保持 DIRECT、1 个二进制 + 不受影响）
  - 已注入验证：移除路由后测试**确实失败**（非假校验）
    ✅ **Bug 修复（6 类静态方法）+ 自捕获 1 处新引入缺陷**: WXS 缺失的静态方法

- **发现方式**: 用静态分析确认编译器对模板中静态方法的**路由覆盖**，
  再逐个真机验证；而非逐个方法碰运气
- **修复的 6 类（此前全部被原样输出到 WXS，真机渲染为空）**:
  | 模板写法 | polyfill | 真机结果 |
  | -------- | -------- | -------- |
  | `Object.keys(obj)` | `objectKeys` | 空 → **2** ✅ |
  | `Object.values(obj)` | `objectValues` | 空 → **2** ✅ |
  | `Array.isArray(arr)` | `arrayIsArray` | 空 → **Y** ✅ |
  | `Number.parseInt` | `numberParseInt` | 空 → **7** ✅ |
  | `Number.parseFloat` | `numberParseFloat` | 空 → **1.5** ✅ |
  | `Math.trunc/sign/log2/log10/cbrt/hypot` | `mathXxx` | 空 → **4 / -1 / …** ✅ |
  - `Math.floor/max`、全局 `parseInt/parseFloat` 等官方已有的**不改写**（防过度 polyfill）
- **自捕获的新缺陷（重要）**: 我最初把 `arrayIsArray` 写成
  `ctor === 'Array' || ctor === Array`（为兼容 Node 测试）。
  但 WXS **没有 Array 全局**，对**非数组对象**求值到 `ctor === Array` 会抛错——
  `Array.isArray({a:1})` 返回空值。而这恰恰是 isArray 最需要判断的情况。
  - 是**上一轮新增的静态校验**抓到了它（报 `Array` 出现在非法位置），
    真机复验：`Array.isArray({a:1})` 空 → 修复后 **N** ✅
  - 修复：只比较 `constructor === 'Array'` 字符串
  - **教训**: 为让单元测试（跑在 Node）通过而引入的环境适配，
    可能正好破坏真机行为——Node 有 Array/Object，WXS 没有
- **过程中排除的一个误判**: 我曾怀疑 `Number(x)` 函数调用在 WXS 中不可用，
  但隔离测试证明它**可用**（`Number('7')` → 7，`typeof Number` → function），
  真正的失败来自我探测页里的单引号/反引号转义问题。故 `Number()` 未做改写
- **回归测试**: 新增 `tests/wxs-static-methods.test.ts`（17 个用例：
  11 个走 polyfill、5 个官方方法不改写、1 个 arrayIsArray 语义断言）
  - 已注入验证：删掉 `keys` 注册后测试**确实失败**（不是假校验）
    ✅ **Bug 修复（2 个）+ 校验加固**: polyfill 自身的 WXS 非法全局用法

- **发现方式**: 写了一个静态分析脚本，把 `wxsUtils.wxs` 里所有**既非本地声明、
  也非 WXS 官方全局**的自由标识符列出来（上一轮 `Object.keys` 就是这类），
  从而系统性地找出同类问题，而不是逐个方法去真机试
- **Bug 4**: `assignKey` 用 `Object.defineProperty` 保留 `__proto__` 键，
  但 WXS **没有 Object 全局**（实测 `typeof Object.defineProperty` 直接抛错，
  因为在 undefined 上取属性）→ `Object.fromEntries` 处理 `__proto__` 键时失败
  - **修复**: 加 `typeof Object !== 'undefined'` 短路（typeof 对未声明标识符安全，
    短路后不会求值 `Object.defineProperty`）——Node 环境保留原型保护，
    WXS 环境安全退化为普通赋值
  - 真机：`Object.fromEntries([['__proto__',9],['x',7]]).x` 修复前为空 → 修复后 **7** ✅
- **Bug 5**: `padStart` / `padEnd` 用 `String(padString)` 转字符串，
  但 WXS **没有 String 全局**（round 75 已实测）→ **两个方法整体失效**
  - **修复**: 新增 `toWxsString`，用 `'' + value` 触发 ToString
  - 真机：`'7'.padStart(3, 0)` 空 → **`007`** ✅；`'x'.padStart(5, 'ab')` 空 → **`ababx`** ✅
- **校验加固（重要）**: 新增 `tests/wxs-polyfill-globals.test.ts`，用 AST 静态分析
  断言 polyfill 只使用 WXS 官方全局。**并且验证了这个校验本身真的有效**——
  注入一句 `Object.keys(o)` 后测试确实失败（最初写成"文件里出现一次 typeof 就整体放过"，
  注入了却测不出来，属假校验，已改为逐使用点判断）
- **新增能力**: 为 `walk` 增加 parent 参数，使"某标识符是否处于 typeof 之下"可判定
  ✅ **Bug 修复（3 个，均静默失效）**: Object.keys 依赖 + :style 对象变量/数组变量

- **发现方式**: 继续按官方《WXS 语法参考》做**系统性差集审计**，
  这次针对静态方法（Object / Math / Number / Array / String）与 `:style`
- **环境事实（模拟器逐个实测）**:
  | 表达式 | 结果 |
  | ------ | ---- |
  | `typeof Math` / `JSON` / `Number` | object / object / function ✅ 存在 |
  | `typeof Object` / `Array` / `String` | **undefined**（均不存在） |
  | `for...in` | 编译报 `Unexpected token` |
  | `try/catch` | 不支持（整个 WXS 文件白屏） |
- **Bug 1**: polyfill 的 `objectEntries` / `objectAssign` / `styleToString`
  内部调用 **`Object.keys`**，而 WXS 无 `Object` → 三者**全部静默返回空**。
  真机：`Object.entries(obj).length` → 空；`Object.assign({},obj).a` → 空
  - **修复**: `getOwnKeys` 改用 `JSON.stringify` + 文本扫描取键，
    键经 `JSON.parse` 还原转义。真机复验：entries=1、assign.color=`#07c160` ✅
  - 期间踩坑：初版用 `try/catch` 兜底 → **WXS 不支持**，整页白屏；
    已移除（`JSON.stringify` 产出的片段必然合法，无需兜底）
- **Bug 2**: `:style="objVar"`（对象变量）原样输出 `style="{{objVar}}"`，
  对象被塞进字符串属性 → 样式静默失效（实测黑色）
  - **修复**: `:style` 强制走 WXS 并经 `styleToString` 转换
    （字符串原样返回、对象转 `k:v;k:v`，两种类型都安全）
  - 为此给 `getTemplateNodeProp` 增加 `forceWxs` 参数，并补上
    "简单标识符的 `exp.ast` 为 null" 时的解析分支
- **Bug 3**: `extractVariablesFromExpressionAST` 无 `ArrayExpression` 分支，
  导致 `[objVar, ...]` 内的变量不被提取为 WXS 形参：
  产物为 `function () { ... objVar ... }`，函数体引用未定义变量
  - **修复**: `collectVariablesFromAST` 增加 `ArrayExpression` 分支
  - 真机复验：`:style="[objVar, 'font-weight:bold']"` → `rgb(7,193,96)` ✅
- **真机 A/B 汇总**:
  | 场景 | 修复前 | 修复后 |
  | ---- | ------ | ------ |
  | `Object.entries(obj).length` | 0 | 1 ✅ |
  | `Object.assign({}, obj).color` | 空 | `#07c160` ✅ |
  | `:style="objVar"` | `rgb(0,0,0)` | `rgb(7,193,96)` ✅ |
  | `:style="[objVar, ...]"` | 失效 | `rgb(7,193,96)` ✅ |
  | `:style="strVar"`（对照） | ✅ | ✅ 不变 |
- **同步更新 1 处旧断言**: `class-style.test.ts` 的 "4.2 简单变量 style"
  原先断言产物含 `{{inlineStyle}}`——正是被修复的 bug 行为，已改为断言 `styleToString`
- **加固校验**: `wxs-es6-string-methods.test.ts` 的兼容性检查新增
  `try/catch` 与 `for...in` 两条规则（本轮两者各踩一次）
- **回归测试**: 新增 `tests/wxs-object-and-style.test.ts`（5 个用例）
  ✅ **Bug 修复（2 个，均属静默失效）**: ES6 字符串方法缺失 polyfill + polyfill 永不更新

- **发现方式**: 按官方《WXS 语法参考 · 数据类型》的 string/array 方法清单，
  与 `WXS_POLYFILL_REGISTRY` 做**系统性差集审计**
- **Bug 1**: `startsWith` / `endsWith` / `repeat` 既不在官方 WXS 方法清单里、
  也没登记进 polyfill，被**原样输出到 WXS** → 真机渲染为**空字符串**
  - 实测对照: `endsWith` → 空；`repeat` → 空；`startsWith` → 空；
    而 `includes` / `padStart`（已登记）→ 正常；`slice`（官方支持）→ 正常
  - **修复**: `wxsUtils.wxs` 补 3 个实现 + registry 登记 3 条。
    真机复验: `endsWith=true`、`repeat=abab`、`startsWith('b',1)=true`
- **Bug 2（更隐蔽，修 Bug 1 时才暴露）**: `copyPolyfillFiles` 在目标目录已存在时
  **直接 return 跳过复制** → polyfill 的改动**永远进不了 dist**。
  表现为"改了 polyfill、产物却没变"，极易误判为"修复无效"
  - **修复**: 改为 `fs.copy(..., { overwrite: true })`
- **审计结论（其余 8 个 ES6+ 方法未修）**: `fill` / `keys` / `values` /
  `copyWithin` / `toSorted` / `toReversed` / `toSpliced` / `groupBy`
  同样会静默失值。**本次不改**，因为：
  1. 真实项目**模板中零使用**（`keys`/`values` 仅用于 script 的 `Object.keys`，属 JS 环境）
  2. 部分（`toSorted`/`groupBy` 等）为 ES2023+，小程序环境普遍不可用
  3. 按"先确认转译产物能否在小程序环境正确运行"的原则，无需求不盲目补齐
- **回归测试**: 新增 `tests/wxs-es6-string-methods.test.ts`（7 个用例：
  3 个方法走 polyfill、带参/position、`repeat` 字面量、
  `slice/indexOf/toUpperCase` 对照不走 polyfill、
  polyfill 文件本身不含 WXS 不支持构造——注释已剥离）

🔍 **调查（未修改代码）**: 作用域插槽真机取值为空——结论是**模拟器环境限制**，非编译器问题

- **现象**: 测试场 ⑦ 作用域插槽的真机渲染为 `row: item= index=`（两个值都空）
- **调查过程**（逐步排除，全部用真机实测）:
  1. 两种写法对照：同名 `#row="{ item, index }"` 与别名 `#row="{ item: it }"` → **都为空**
  2. 对照官方语法：手写 `<view slot:item slot:index>` → 仍为空
  3. 核对 glass-easel 官方文档（`guide/zh_CN/interaction/slot.md`）:
     `dynamicSlots` 需**组件**声明，接收方用 `slot:item`，**VMS 产物与官方示例一致**
  4. 子组件 `dynamicSlots: true` **已正确生成**，`glassEasel: true` 也已开启
  5. 发现 `project.private.config.json`（gitignored）把基础库钉在 **2.27.3**，
     而文档要求 **>= 3.8.12** → 改为 3.15.0，实测 SDK 升到 **3.17.3** → 仍为空
  6. **决定性对照**：手工编写**完全不经 VMS** 的原生 glass-easel 示例
     （逐字照抄官方文档：`<slot item="{{it}}" index="{{i}}">` + `<view slot:item slot:index>`）
     → **同样为空**
- **结论**: 连官方原生写法在本环境都不生效，说明是**模拟器/基础库环境限制**，
  **不是 VMS 转译缺陷**。VMS 生成的 WXML 与官方文档完全一致，故**不改动编译器**
- **顺带核实**: `transformer.ts` 对"用了作用域插槽但未开 glassEasel"已有明确告警，
  机制正确；本次因已开启而无告警，符合预期
- **环境记录**: 排查中把 `project.private.config.json` 临时改为 3.15.0，
  已**还原为原值 2.27.3**（该文件 gitignored，属用户本地配置）

✅ **Bug 修复（高影响）**: 组件 `v-model` / `defineModel` 把 `undefined` 写回父组件

- **发现方式**: 给测试场补上**真正的** `defineModel` 场景时（原先 ⑥ 只是本地
  v-model，标注为 defineModel 属**误标**），真机实测发现父组件的值被清空
- **根因**: 两类事件源的 `detail` 形态不同，但编译器**一律**按原生标签生成
  `e.detail.value`：
  | 事件源 | 值的位置 |
  | ------ | -------- |
  | 原生表单标签 | `e.detail.value`（`{ value: '...' }`） |
  | 自定义组件 | **`e.detail` 就是值本身** |
  依据：子组件经 `context.triggerEvent(name, value)` 传值，微信把**第二个参数
  整体**作为 detail。
- **实测证据（模拟器）**: `emit('raw','RAW_VALUE')` → `e.detail === "RAW_VALUE"`；
  `emit('wrapped',{value:'X'})` → `e.detail === {value:'X'}`。
  项目内既有代码同样按 `e.detail` 读取（`SubJoinConfigSecondIndex.vue`
  的 `updateIdCardFaceUrl: faceUrl = e.detail`）
- **修复**: 按标签类型区分取值位置（`resolveNewValueExpression`）
  - 组件（含 `t-` 前缀）→ `e.detail`
  - 原生标签 → `e.detail.value`（不变）
  - `.trim` / `.number` 同步改为作用于正确的值
- **真机 A/B 复验**:
  | | 父组件 parentTitle |
  | -- | ------------------ |
  | 修复前 | `undefined` ❌ |
  | 修复后 | `由子组件设置 1789399016295` ✅ |
  且父组件 → 子组件 props、本地 v-model 输入框的值**同步正确**
- **影响面**: 真实项目 **0 处**组件 v-model（16 处全在测试场），属潜在缺陷，
  但那是文档化的一等特性，且用户第 2 轮明确要求 `defineModel` 正确转译
- **同步更新 4 处旧断言**: `v-model.test.ts` / `v-model-event-merge.test.ts` /
  `spec-conformance.test.ts` 中的组件用例原先断言 `detail.value`，
  属于把 bug 写进了预期，已改为 `detail`
- **回归测试**: 新增 `tests/vmodel-detail-shape.test.ts`（8 个用例：
  组件默认/具名/`t-` 前缀、原生 input/textarea/switch/slider 对照、
  以及两种形态下的 `.trim`/`.number`）

✅ **运行时验证（完整覆盖）**: 测试场 8 个块逐一核对渲染值与交互

- **方法**: 延续"逐块核对真机渲染值 + 真实点击"的方式，把剩余块全部走完
- **结果（全部通过）**:
  | 块 | 核对内容 | 结果 |
  | -- | -------- | ---- |
  | 列表渲染 | 嵌套 v-for `0.0=a0`、解构 `1 / 张三`、**计算成员 `map[id] = v`** | ✅ |
  | 条件渲染 | v-else-if、v-if+v-for、三元、**v-show 语义** | ✅ |
  | 事件绑定 | 方法引用、**传参 `固定参数 / 42`**、**\@tap.stop 不通冒泡**、**全局变量 `9 / <ts>`** | ✅ |
  | 计算属性 | **链式级联**（count→double→quadruple）、条件 computed | ✅ |
  | 样式绑定 | 对象/数组/三元语法、:style 对象与拼接、WXS 求值类名 | ✅ |
- **关键交互实测**（不只是"能渲染"，而是"行为正确"）:
  - **`.stop` 阻止冒泡**: 点内层按钮 → `innerCount=1` 而 `outerCount=0` ✅
  - **v-if vs v-show 语义差异**: 切换 `show` 后 v-if 内容消失、v-show 内容保留 ✅
  - **computed 级联**: 点一次 `count+=1` → `double 0→2`、`quadruple 0→4`、`等级 低→中` ✅
  - **样式响应式**: 切换后 `.active` 移除，实测背景由绿变 `rgb(255,255,255)` ✅
  - **事件内全局变量**: `Math.max` + `Date.now()` 正常（第 33 轮修复的运行时复验）✅
- **结论**: 除前两轮已修的 `String/Boolean` 与裸宏调用外，**测试场各块未再发现新缺陷**

✅ **Bug 修复**: 裸调用 `defineProps`/`defineEmits`/`defineModel` 静默产出错误产物

- **发现方式**: 继续按"逐块核对渲染值"的方式检查测试场，发现「组件通信」
  块的子组件标题为空。追查源码发现我在测试场里写了**裸调用**形式
- **根因**: 阶段1 只在 `VariableDeclaration` 中收集宏，
  `ExpressionStatement` 仅处理 `defineExpose`/`defineOptions`。
  裸写的 `defineProps<{...}>()` 因此被**静默跳过**，后果是双重的：
  1. `properties` 未生成 → 产物 `return { title }` 引用**未声明变量**
  2. 该调用**原样保留**（含 TS 泛型）→ 产物是**非法 JavaScript**
- **修复**: 对裸调用直接编译报错，并给出两种正确写法
  （`const props = defineProps(...)` 或解构 `const { x } = ...`）
- **真机验证（A/B）**:
  - 裸调用 → 子组件标题**为空**、页面渲染 0 个元素
  - 改为赋值形式后 → 标题正确渲染 `子组件: 来自父组件的标题`
- **顺带澄清一处误判**: 我曾以为"模板中裸用 prop 名（`{{ title }}`）会失值"，
  但 A/B 实测表明**只要宏被正确赋值，裸用 prop 名可以正常渲染**
  （VMS 的 `setup` 返回里同时给出 `title` 与 `props`）。
  故"必须写 `props.title`"的推论**不成立**，未据此改动编译器或文档
- **回归测试**: 新增 `tests/bare-macro-call.test.ts`（6 个用例：
  三个宏各自报错、错误信息含两种正确写法、赋值/解构对照不受影响）

✅ **Bug 修复**: WXS 中 `String()` / `Boolean()` 静默产出空值（测试场直接暴露）

- **发现方式**: 用刚建好的**语法测试场**逐个核对渲染值，发现
  `String = ` 那一行**是空的**——而同区块的 `Number = 43` 正常
- **实测确认（模拟器逐项隔离）**:
  | 表达式 | 渲染结果 | 结论 |
  | ------ | -------- | ---- |
  | `Number('42')` | `42` | ✅ 可用 |
  | `parseInt('7x')` | `7` | ✅ 可用 |
  | `isNaN('x')` | `true` | ✅ 可用 |
  | `String(123)` | **（空）** | ❌ 失值 |
  | `Boolean(1)` | **（空）** | ❌ 失值 |
  隔离验证：只保留 `Number/parseInt` 时页面正常渲染 2 行；
  加入 `String/Boolean` 后整页渲染 **0 个元素**
- **依据**: 官方《WXS 语法参考 · 基础类库》列出的 Global 方法仅有
  `parseInt / parseFloat / isNaN / isFinite / decodeURI / decodeURIComponent
/ encodeURI / encodeURIComponent`——**既无 String 也无 Boolean**
- **修复**: `sanitizeWxsAst` 中改写为等价 WXS 写法
  - `String(x)` → `'' + x`（拼接触发 ToString）
  - `Boolean(x)` → `!!x`（双重取反触发 ToBoolean）
  - 无参形式 `String()` → `''`、`Boolean()` → `false`
  - `Number` 实测可用，**不做改写**
- **真机复验**: 修复后 `String(123)` 渲染 **123**、`Boolean(1)` 渲染 **true**
- **影响面**: 真实项目中的 `String(...)` 均出现在 script（JS 环境，合法），
  **未出现在模板表达式中**，故属潜在缺陷
- **回归测试**: 新增 `tests/wxs-global-functions.test.ts`（8 个用例：
  两种改写与无参形式、`Number/parseInt/isNaN/isFinite` 对照不改写）

✅ **新增**: 示例项目内置「语法测试场」——可点选的真机测试入口（用户要求）

- **需求**: 增加一个 tab 页，把要测试的语法**按大块列出**，点击进入新页面
  测试该块场景，在微信开发者工具中验证
- **实现**:
  | 项 | 内容 |
  | -- | ---- |
  | tab 页 | `pages/playground/PlaygroundIndex`（tabBar 第 4 项「测试场」） |
  | 子包 | `playground/pages/<block>/*`（8 个块，避免撑大主包） |
  | 图标 | 自绘 81×81 PNG（normal 灰 / active 绿），无第三方依赖 |
  | 块页面 | v-model / 事件 / 列表 / 表达式与 WXS / 条件 / 组件与插槽 / 计算属性 / 样式 |
- **覆盖的场景**（按用户第 2 轮明确要求，重点覆盖 v-for 与临时变量）:
  - v-model：基础、嵌套对象、trim、number、textarea、
    **v-for 内 item 属性回写**、**嵌套 v-for 两级索引回写**
  - 列表：基础/对象数组/嵌套 v-for/**解构 v-for**/**解构+计算成员索引**/
    自定义索引名/数字源/字符串源/v-if 共存
  - 事件：方法引用/传参/内联箭头（用 v-for 变量）/stop 修饰符/全局变量/索引传参
  - 表达式：可选链/模板字符串/方法调用降级/内置对象/三元逻辑/数组方法 polyfill
- **编译期发现并修正的两处自身错误**（体现编译器报错质量）:
  1. 具名插槽内直接写文本 → 编译器报
     "插槽footer下需使用div等标签元素作为子节点"，已改为 div
  2. 使用作用域插槽但未开启 glassEasel → 编译器给出明确告警与开启方法；
     已在 example/vms.config.js 开启（libVersion 3.15.0 满足 >=3.8.12）
- **模拟器实测（全部通过）**:
  - 测试场 tab 正常渲染，8 个块卡片齐全
  - 点卡片可进入对应块页；8 个块页面**全部可加载**
  - **v-model 索引回写实测**: 在第 1 个 v-for 输入框输入 CHANGED →
    运行时 items[0].name 变为 CHANGED 且 items[1].name 保持 b
  - 全流程 **0 条 JS 运行时错误**
- **产物校验**: verify:artifacts:strict 通过（受检量随测试场增长：
  156 个 JS、102 个 WXML、102 个 WXSS、102 个 .vue 四件套）
- **一处自我纠正**: 首版用 `JSON.parse/stringify` 改写 `app.json`，
  把原有的单行数组全部展开为多行，产生 **66 增 11 删** 的无关 diff。
  已还原为**手工最小改动**（仅追加 3 处：主包页面、子包、tabBar 项），
  最终 **21 增 1 删**——避免为新增功能制造大量格式噪音

✅ **Bug 修复**: 编译错误被重复打印两次（各带一份完整堆栈）

- **发现方式**: 在模拟器中主动写入一个**语法错误的 .vue**，
  观察 watcher 的输出——同一次编译打印了 **2 份**完全相同的错误报告，
  每份都含完整堆栈
- **与代码注释矛盾**: `cli.ts` 的 catch 明确写着
  _"transformer.ts 内部已调用 handleCompileError…此处不重复打印"_，
  说明设计意图是**只打印一次**
- **根因**: 打印发生了两处，且都不在 `cli.ts`：
  1. `scopeAnalyzer.ts` 的 `analyzeScriptScope` 捕获语法错误后
     **既打印又 rethrow**
  2. `transformer.ts` 捕获后又调用一次 `handleCompileError`
     → 同一错误被输出两次
- **修复**: `analyzeScriptScope` 改为**只规范化错误并抛出，不打印**，
  把展示职责唯一地交给上层。`filePath` 形参保留（签名稳定）并标注为
  有意未使用
- **验证（修复前 → 修复后）**: 写同一个语法错误文件，
  错误报告数 **2 → 1**，堆栈数 **2 → 1**；
  报告质量不变（仍含完整 SFC 片段与 code frame 定位）
- **回归测试**: 新增 `tests/scope-analyzer-error-output.test.ts`（3 个用例：
  抛错但不打印、合法脚本正常返回、传入 filePath 也不打印）
- **顺带澄清**: 该崩溃与 `app.json` 变更无关——早前观察到的
  `ENOENT unlink dist/dev/app.json` 是**我强制 kill watcher 导致重建中断**
  的副产物，非产品缺陷（正常编辑 `app.json` 时 watcher 工作正常，已实测）

✅ **运行时验证**: `v-model` 四种形态真机实测（此前只有单元测试）

- **动机**: `v-model` 是用户明确要求"必须按小程序规范转译"的特性，
  但**示例项目从未使用它**——即它只有单元测试，**从未在真实运行环境中验证过**。
  编译器单测只能证明"产物形式正确"，无法证明"运行起来真的能双向绑定"
- **方法**: 临时建探针页（4 种形态）→ 模拟器真实输入 → 读运行时 `data`
  → 验证后**完整删除探针与 `app.json` 改动**（示例仓库已恢复原状）
- **实测结论（全部通过）**:
  | 形态 | 输入 | 运行时可读值 |
  | ---- | ---- | ------------ |
  | 基础 `v-model="text"` | `hello-vmodel` | `text === "hello-vmodel"` ✅ |
  | 模板联动 | 同上 | `.probe-echo` 显示 `echo:hello-vmodel`、`len:12` ✅ |
  | 嵌套 `v-model="form.name"` | `nested-val` | `form.name === "nested-val"` ✅ |
  | `v-model.trim` | `"  spaced  "` | `trimmed === "spaced"`（空格已去）✅ |
  | **v-for 内 `v-model="it.name"`** | 改第 1 项 | `items === ["changed-in-vfor","b"]` ✅ **仅目标项变化** |
- **最后一项是用户重点关注的场景**（v-for + 临时变量）。产物 setter 为
  `const { a: [i] } = e.currentTarget.dataset; __vmsProxyRefs.items[i].name = e.detail.value`，
  运行时确认 **dataset 索引定位准确、未误改其它项**
- **顺带发现并还原的一处副作用**: 微信开发者工具开窗时会改写
  `example/project.config.json`（`setting.condition` 由 `true` 变 `false`，
  并去掉文末换行）。已还原并写入文档提示

✅ **运行时验证（交互级）**: 真实点击驱动事件桥接，端到端确认

- **本轮新增的验证深度**: 上轮只做到"读取运行时状态"，本轮做到
  **用真实点击触发业务逻辑**——这是最接近用户实际使用的验证
- **实测过程**:
  1. 点首页 `.income-card__header`（其 WXML 为 `bind:tap="onIncomeCardTap"`）
  2. 页面从 `pages/revenueAggregation/RevenueAggregationIndex`
     **跳转**到 `subHome/pages/bill/income/IncomeBillIndex`
  3. `navigateBack` 后 `pageStack` **正确复原**为单页
  4. 全程 console **0 条 JS 错误**
- **证明了什么**: VMS 的 `bind:tap` → 桥接函数 → 业务处理器 →
  `wx.navigateTo` 整条链路在实践中可用——不只是"函数存在于 data"，
  而是**真的能触发、真的能产生业务效果**
- **WXS polyfill 运行时确认**: 导航到使用 `__vmsWXSUtils.filter` 的
  `ProfitAnalysisIndex`，页面正常渲染、无 WXS 相关报错
  （此前只验证过 polyfill 的**单元行为**，未验证过它在真实 WXML 环境中的执行）
- **沉淀**: `docs/RUNTIME-VERIFICATION.md` 增加 3 行——
  事件桥接端到端、交互无报错、WXS polyfill 运行时

✅ **核查（无缺陷）+ 沉淀校验**: 源码 ↔ 产物映射完整性双向验证

- **方法（延续上轮差分思路）**: 不做逐项审查，而是比对**源码树**与**产物树**，
  让"不一致"自己浮现
- **正向（无漏编译）**: 92 个 `.vue` **全部产出完整四件套**
  （`.js`/`.wxml`/`.wxss`/`.json`），无缺件；
  392 个可处理源文件（排除 `.d.ts`）**全部有对应产物**
- **反向（无孤儿产物）**: 221 个非 npm 的 `.js` 与 711 个非 npm 产物
  **全部能追溯到源文件**，唯一例外是 `project.config.json`（本就是生成的）
- **顺带确认的两项行为**:
  - 15 个 `.DS_Store`（macOS 元数据）**未被复制**进产物（0 个）
  - `.d.ts` 类型声明文件正确**不产出**到产物
- **过程中的自我纠错**: 首版检查脚本用错 `path.relative` 的基准目录，
  产生 1079 条假阳性（把 `miniprogram_npm/tdesign/.../action-sheet.json`
  截断成 `action-sheet.json`）。修正基准后归零。
  这又一次印证：**校验器本身必须先被校验**
- **沉淀**: `verify-artifacts.mjs` 新增第 8 项检查——源码↔产物映射完整性，
  双向检查"四件套缺件"与"孤儿产物"（92 个 `.vue` 受检），
  已用合成样例验证两种失败模式均能被捕获

✅ **Bug 修复**: `project.config.json` 字段名大小写错误，产物多出无意义字段

- **发现方式**: 对比 dev / prod 两个产物目录（774 个结构性产物中 773 个
  **逐字节相同**，唯一差异是 `project.config.json`），顺藤摸瓜
- **现象**: 产物中出现 `"projectName": "undefined-dev"` /
  `"undefined-prod"`——字段多余且值毫无意义
- **根因**: 官方《项目配置文件》定义字段名为**全小写** `projectname`，
  而代码写作驼峰 `config.projectName = config.projectName + '-prod'`：
  1. 源文件里没有 `projectName`，读取得到 `undefined`
  2. 字符串拼接把 `undefined` 转成 `"undefined"`
  3. 结果新增了一个**官方不认识的**驼峰字段，同时正确的
     `projectname` 未加后缀（保持 `"store-bill"`）
- **修复**: 改用 `config.projectname`；并在源文件未配置时退回
  目录名兜底，杜绝 `undefined-*` 再次出现
- **产物对比（修复前 → 修复后）**:
  | | 修复前 | 修复后 |
  | -- | ------ | ------ |
  | `projectname` | `"store-bill"`（未加后缀） | `"store-bill-prod"` ✅ |
  | `projectName` | `"undefined-prod"` ❌ | 不存在 ✅ |
- **回归测试**: 新增 `tests/project-config-name.test.ts`（4 个用例：
  prod/dev 产物的字段正确性与无驼峰残留、缺配置时的兜底逻辑）

✅ **运行时验证（系统性扩展）**: 多页面 + 核心契约实测，并沉淀为可复用清单

- **多页面端到端**: 实测 6 个页面（3 个主 tab + 4 个分包页，含使用
  `:deep()` 与 `v-for` 的页面）均正常导航与渲染；
  JS 运行时错误 **0 条**、VMS 编译告警 **0 条**
- **核心契约实测**（`automation_evaluate` 读运行时 `data`）:
  | 契约 | 结果 |
  | ---- | ---- |
  | 事件处理器函数能存活到 `data` | ✅ 首页 7 个处理器均为可调用 `function` |
  | 状态已解包（非 Ref 对象） | ✅ 类型为 string/array/object |
  | `__vmsRenderState` 未外泄到 `data` | ✅ 无 `__vms*` 键 |
- **与既有结论互证**: `docs/微信小程序自定义组件函数传参验证结论.md`
  （2026-04-23，模拟器 + 真机）记录"函数可经 property 传递"，
  本轮从**编译产物**侧再次确认——两份结论互相印证
- **澄清一个工具边界（避免误判）**: 页面级 `querySelectorAll` **不穿透自定义组件**。
  查 tdesign 内部的 `.t-input__placeholder` 返回空数组**不代表样式失效**；
  对照组 `view`/`input`/`.form-label`/`.form-container` 均能命中，
  证明选择器本身可用
- **沉淀**: 新增 `docs/RUNTIME-VERIFICATION.md`——记录前置步骤
  （注意 `project.config.json` 指向 `dist/dev`，必须用 dev 模式构建，
  否则模拟器报 `no found app.json`）、9 个已验证项、
  工具边界与"何时该手动跑一遍"的建议

✅ **里程碑**: 引入微信开发者工具模拟器做**运行时验证**（首次具备端到端验证能力）

- **背景**: 此前 60 余轮的验证手段止于"产物静态审查"——读官方文档 + 扫描产物。
  对 WXML 语义（如 `<block>` 是否产生真实节点）只能推断，无法证实。
  本轮通过 `wechatide-skill` 接入真实模拟器，补上这一环
- **实测流程**: 授权 → 开项目窗口 → 模拟器启动 → 读取 runtime / console /
  截图 / DOM 查询
- **端到端验证成功**: 小程序**正常启动并渲染**首页
  （`currentPage: pages/revenueAggregation/RevenueAggregationIndex`），
  console 中 API 调用返回成功、无 VMS 相关报错。这是首次确认**编译产物的运行时正确性**
- **解决一个纯文档无法定论的问题**（第 61 轮遗留）:
  `<template>` 上的 class/style 是否生效？
  - 文档只能说明 `<block>` 是"虚拟块"
  - **模拟器实测**: `querySelectorAll('block')` 返回**空数组**，
    而 `querySelectorAll('view')` 正常返回元素 → 证实 `<block>` 无 DOM 存在，
    其上的 class/style 确实无效
- **据此修复**: `transformTemplateClass` 对**用户手写**的 `<template class>`
  给出编译告警（不含自动注入的根节点 class——用户无从移走，告警无指导意义）。
  真实项目未出现该写法，告警数为 0，无误伤
- **过程中一个有价值的多余发现**: 首版告警对 `v-for` 的 `<template>` 误报，
  测试立刻暴露——追查发现 VMS 会为**非页面组件的根节点自动注入
  `class`/`style`**（父组件 class 透传）。这既解释了误报，
  也说明该自动注入在根为 `<template>` 时同样落到 `<block>` 上
- **新增测试**: `tests/template-class-warning.test.ts`（5 个用例）

✅ **Bug 修复**: 8 个无小程序语义的事件修饰符由静默忽略改为编译报错

- **现象**: `.prevent` / `.self` / `.once` / `.passive` / `.exact` /
  `.left` / `.right` / `.middle` 此前被**静默忽略**——产物看起来正常，
  但行为缺失（`.prevent` 不阻止默认行为、`.once` 会重复触发）。
  原有代码只识别 `.stop`/`.mut`/`.capture`/`.capture-stop`/`.raw`，
  其余修饰符既不处理也不报错
- **判定依据**: 小程序事件系统为 `bind`/`catch`/`mut-bind`/`capture-*`，
  没有"默认行为"、"只触发一次"、"鼠标按键"等概念，**无法提供等价语义**
- **修复**: 新增 `UNSUPPORTED_EVENT_MODIFIERS` 表并逐项给出替代方案
  （如 `.once` → 在处理器内加标志位保证只执行一次）
- **一次性用尽**: 穷举 13 个 Vue 事件修饰符，确认 5 个有映射（保持可用）、
  8 个无映射（改为报错），无遗漏
- **回归测试**: `tests/event-modifiers.test.ts` 扩充至 21 个用例
  （5 个有映射的映射结果、8 个报错、组合修饰符、错误信息内容、无修饰符对照）
- **里程碑**: 至此「不支持的 Vue 特性」表中**已无"静默忽略"项**——
  所有列出的不支持特性都会在编译期报错。文档相应更新：
  删去"静默忽略"图例，明确说明下表所有项均会编译报错

✅ **Bug 修复**: `v-bind="obj"` / `v-on="handlers"` 静默丢弃全部属性与事件

- **现象**: `<view v-bind="attrs">` 产出 `<view class="class">` ——
  **所有动态属性被丢弃**，元素看起来完全正常但不带任何属性；
  `v-on="handlers"` 同理，产出元素**完全不可交互**。两者均**不报任何错**
- **根因**: WXML 没有"把对象展开为多个属性/事件"的机制，编译器无法转换，
  但旧实现既不转换也不报错，直接丢弃
- **修复**: 在 `transformUnsupportedDirective` 中拦截**无参数**的
  `v-bind` 与 `v-on`，抛出带替代方案（逐个绑定）的 `CompileError`。
  **有参数的写法（`:id="x"`、`@tap="go"`）不受任何影响**
- **回归测试**: 新增 `tests/object-binding-rejection.test.ts`（6 个用例：
  两种整体绑定报错、组件上的整体绑定、`:attr`/\@tap/\@tap.stop 三种对照）
- **文档同步**: README 与 SKILL 中这两项由「静默忽略」改为「编译报错」；
  `docs-behavior-sync.test.ts` 相应更新（该测试**首先发现了这次行为变更
  与文档不一致**，正是其设计目的）
- **验证**: 真实项目构建通过（434 文件、1826 产物），未使用该写法，无误伤

✅ **修复（校验器）**: dev 构建产物被误报 37 处，校验器此前只支持压缩产物

- **起因**: 四类环境审查完成后，补测此前**从未验证过**的 dev 构建路径
  （`node ../bin/index.js dev`，NODE_ENV=development，输出到 `dist/dev`）
- **dev 构建本身正常**: 产出 1826 个文件（与 prod 一致），
  `tsc` 与功能均无异常；初次运行的 37 条"绑定处理函数未定义"经逐文件核实
  **全部为假阳性**——例如 `onDropdownValueChange` 确实存在，形式为
  `const { onDropdownValueChange } = getDropdownUpdateFun(...)`
- **根因**: 校验器判定处理函数是否定义时只考虑了三种形式：
  `function name(`、`name=`/`name:`、`"name":`。
  **未考虑对象简写**——dev 产物不压缩，处理器常以
  `{ onX, onY }` 或 `const { onX } = ...` 形式出现（无 `:`、无 `=`）
- **修复**: 补上简写形式匹配 `[,{]\s*name\s*[,}]`，并在注释中说明
  两种构建模式的定义形式差异
- **结果**: `dist/prod` 与 `dist/dev` **双双校验通过**（7 项检查全部生效）
- **意义**: 该校验器此前只能在 CI 对压缩产物运行；
  修复后**开发期即可使用**，开发者能在本地构建后发现产物问题，
  而不必等到 CI 阶段
- **说明**: `dist/dev` 为构建产物（gitignored），验证后已清理

✅ **核查（无缺陷）+ 沉淀校验**: WXSS 产物语法全量审查（四类环境审查收尾）

- **审查结果（真实产物，按来源区分）**:
  | 类别 | 数量 | 结果 |
  | ---- | ---- | ---- |
  | WXSS 总数 | 149 | — |
  | VMS 生成（有同名 .vue） | 92 | 干净 |
  | 原样拷贝（原生 .wxss） | 57 | 不属编译器产物 |
- **逐项核对**:
  - `:deep(` / `::v-deep(` / `:slotted(` / `:global(` —— **均为 0**
    （第 37 轮的 `:deep()` 展开修复在全部 92 个产物中确认有效）
  - `[data-v-*]` 残留 —— **0**（scoped 属性选择器已正确剥离）
  - 使用的 CSS 特性：`var(--)` 19 处、`calc()` 17 处、`@media` 1 处、
    `!important` 15 处、`@keyframes` 11 处 —— 均为 WXSS 支持
  - 尺寸单位：`rpx` 2185、`px` 79、`vh` 33、`vw` 6、`rem` 2、`em` 1 —— 标准 CSS 单位
- **沉淀**: `verify-artifacts.mjs` 新增第 7 项检查（WXSS 语法合规性），
  检查 5 类 Vue 专有语法与 scoped 属性选择器残留（92 个文件受检），
  已用合成样例验证该检查确实触发
- **四类环境审查至此收尾**: JS（合法 JS）、WXML（结构合法）、
  WXS（语法 + API + 构造器）、WXSS（语法）均已逐项核对官方能力清单
  并全量扫描真实产物

✅ **核查（无缺陷）+ 沉淀校验**: WXS 产物语法全量审查

- **依据**: 官方《WXS 语法参考 · 语句》列出 WXS 仅支持
  `if` / `switch` / `for` / `while`（及 break/continue），
  函数仅 `function` 声明；《运算符》与《数据类型》同样为 ES5 子集。
  即：箭头函数、`let/const`、`class`、`try/catch`、扩展运算符、
  模板字符串、`async/await`、可选链、空值合并等**均不可用**
- **审查结果（真实产物）**: 扫描 `example/dist/prod` 中
  147 个 WXML 里的 **79 个 WXS 块** → **全部干净，0 处违规**；
  内置 `polyfill/wxsUtils.wxs` 同样干净
- **过程中的一次假阳性（值得记录）**: 首版朴素正则扫描报出
  `subStoreCheckIn/components/PunchManage.wxml` 使用了扩展运算符。
  追查发现命中的是字符串字面量 `'加载中...'` —— **不是语法**。
  这说明扫描器必须先剔除字符串与注释，否则会产生假阳性
  （与之前 `:deep` 检查、矩阵预期同类的"校验器自身需被校验"问题）
- **沉淀**: `verify-artifacts.mjs` 新增第 6 项检查——WXS 语法合规性，
  覆盖 9 类不支持构造，并使用**字符串/注释感知**的 `stripJsLiterals()`。
  已用合成样例双向验证：
  - 10 类不支持构造**全部被捕获**
  - 字符串 `'加载中...'`、注释中的 `=>` 与 `class`、`a === undefined` **均不误报**

✅ **Bug 修复**: WXS 中的 `new Date()` / `new RegExp()` 改写为工厂函数

- **原则**: 「支持 Vue 语法前，先确认转译产物能否在微信小程序环境运行」
- **依据（官方文档，非推断）**:
  - 《WXS 语法参考 · 数据类型》**date** 条目原文：
    _"生成 date 对象需要使用 `getDate` 函数"_
  - 同页 **regexp** 条目：_"生成 regexp 对象需要使用 `getRegExp` 函数"_
  - 《WXS · 基础类库》中 `Date` 仅列出 **parse / UTC / now** 三个属性，
    **不存在构造函数**
  - 即：`Date.now()` 合法，而 `new Date()` 在 WXS 中无法运行
- **现象**: 模板绑定里的 `new Date(t)` 原样进入 WXS
  （`return new Date(t).getTime()`），仅在真机执行到该行时才失败
- **修复**: `sanitizeWxsAst` 中把 `new Date(...)` → `getDate(...)`、
  `new RegExp(...)` → `getRegExp(...)`（仅在 WXS 路径生效）；
  其它构造器（如 `new Object()`）保持不变
- **影响面收窄**: 真实项目中的 `new Date(...)` 均出现在 `setup`/`computed`
  内部（JS 环境，合法），**未出现在模板表达式中**，因此属潜在缺陷而非线上故障
- **回归测试**: 新增 `tests/wxs-constructor-compat.test.ts`（6 个用例：
  两种构造器改写、带参与嵌套、`Date.now()` 与 `new Object()` 对照不误改）
- **新增产物校验**: `verify-artifacts.mjs` 检查 WXS 代码块中的
  `new Date(` / `new RegExp(`（已用合成样例验证该检查确实触发）

✅ **文档同步**: 不支持特性表补充「行为」列，并与实现建立一致性测试

- **问题**: README 与 SKILL 的「不支持的 Vue 特性」表只写"不支持"，
  未区分两种截然不同的行为：
  - **编译报错**（写了立即失败并给出替代方案，不会静默出错）
  - **静默忽略**（不报错但不生效，容易误以为已支持）
    经本轮多轮修复后，表中多项已从"静默"变为"报错"，
    而文档未更新——使用者无法从文档判断风险
- **逐项实测后更新**（非推断）:
  | 类别 | 项 |
  | ---- | -- |
  | 编译报错 | `defineSlots`、`withDefaults`、`v-html`、`v-text`、`v-once`、`v-memo`、`v-cloak`、`<Teleport>`、`<Transition>`、`<KeepAlive>`、`<Suspense>`、`<component :is>`、内置组件小写变体、`checkbox`/`radio` 的 v-model |
  | 类型报错 | `useTemplateRef`、`useSlots` 等组合式函数（TS 报 `has no exported member`） |
  | 静默忽略 | `v-bind="obj"`、`.prevent` 修饰符 |
- **新增回归测试** `tests/docs-behavior-sync.test.ts`（18 个用例）：
  - 14 项「文档标注为编译报错」→ 断言**确实报错**（防止文档写错）
  - 2 项「标注为静默忽略」→ 断言不报错且确实不生效（防止误以为支持）
  - 2 项文档存在性 → 断言 README/SKILL 含「行为」列（防止表格被删改后测试静默失效）
- **同时确认无泄漏**: 产物中无 `/Users/` 绝对路径、无 `dist/dev` 开发路径引用；
  连续两次构建产物 **diff 为 0**（构建具备确定性）

✅ **解决（长期阻塞项）**: 产物校验的 `--strict` 现已可用于 CI

- **背景**: `verify-artifacts.mjs --strict` 因示例项目的
  `UploadCardPicture.wxml` 中 `bind:close="onClose"` 未定义而长期 exit 1，
  导致 CI 无法启用（该问题已挂 20+ 轮）
- **根因澄清（经实测）**: 该文件属于**原生四件套**——源码是
  `UploadCardPicture.wxml` + `.ts`，产物中的 `.wxml` 与源码
  **逐字节相同**（`diff` 确认）。也就是说这是**原生代码自身的缺陷**，
  不属于编译器问题，却被全量扫描一并报告
- **修复**: 新增 `--vms-only` 与 `--src <dir>`，按**文件类型的来源**精确区分：
  | 产物 | 来源 | 判定 |
  | ---- | ---- | ---- |
  | `.wxml`/`.wxss`/`.json` | 同名 `.vue` 存在 → VMS 模板编译 | 校验 |
  | 同上 | 源文件即 `.wxml` → 逐字节拷贝 | 跳过 |
  | `.js` | `.vue`（VMS）或 `.ts`（Babel 转译） | 校验 |
  关键是 `.wxml` **不能只看 `.ts` 是否存在**——原生四件套同样有 `.ts`，
  但 `.wxml` 是拷贝而非编译
- **结果**: `--vms-only --strict` **exit 0**，产物一致性校验通过
  （受检：事件绑定 488、WXS 调用 254、组件引用 388、data-\* 索引 70、
  JS 合法性 146、WXML 结构 92）
- **CI 接入**: 新增 npm 脚本 `verify:artifacts:strict`，可直接用于流水线
- **保留既有行为**: 不带 `--vms-only` 时仍全量报告（含原生代码问题），
  便于排查；仅 `--strict` 的 CI 场景使用精确范围

✅ **核查（无缺陷）**: 真实 WXML 产物结构全量验证（标签配对 / 重复属性）

- **方法**: 对 `example/dist/prod` 中 147 个 WXML 产物（排除 `miniprogram_npm`）
  做结构检查：标签闭合配对、同标签内是否有重复属性
- **结果**: **147/147 全部通过，0 个问题**
- **检查器有效性已自证**: 先用刻意构造的坏样例验证检查逻辑本身有效
  （未配对闭合、未闭合标签、重复 `id` 属性均被捕获，合法样例不误报），
  避免把"检查器静默通过一切"误读为"产物没问题"
- **沉淀**: `scripts/verify-artifacts.mjs` 新增"WXML 结构检查"项
  （统计显示 147 个文件受检），使该结论后续可自动复核

✅ **核查（无缺陷）+ 记录工具陷阱**: 真实产物 JS 合法性全量验证

- **起因**: 上一轮发现 `defineSlots` 会产出含 TS 泛型的非法 JS，于是把
  "产物是否是合法 JS"作为独立一层系统排查：穷举 18 种 TS 语法
  （类型注解、`as` 断言、`!`、`satisfies`、`interface`、泛型函数、
  类型导入等）在 setup 中的产物
- **测试中全部报 BADJS，但这是假象**: 用 Babel **关闭 `typescript` 插件**
  解析测试产物的 `js` 字段时，18 种形态全部解析失败
- **真相（经链路核实）**: `tests/test-utils.ts` 调用 `parseScript`，
  其返回值为 `generate(t.program(programBody)).code`——这是**中间态**，
  尚未经过最终转译。真正剥离 TS 的是后续的 `src/babel.config.ts`
  （`@babel/preset-env` + `@babel/preset-typescript`），在 `cli.ts` 的
  `dealScriptCode` 中执行
- **决定性验证**: 对**真实构建产物** `example/dist/prod` 中 146 个
  VMS 生成的 .js 文件（含 `defineComponent` 者，排除 `miniprogram_npm`）
  用关闭 TS 插件的解析器逐个检查——**146/146 全部合法，0 个非法**
- **结论**: 无缺陷。**但记录一个必须牢记的自测陷阱**：
  > 校验"产物是否合法 JS"时，不能只看测试辅助函数返回的 `js` 字段。
  > 该字段是中间态；必须以真实构建产物（`dist/`）为准，
  > 否则会得到大量假阳性。
  > 这一条与之前记录的 "test-utils 不跑 Babel" 是同一陷阱的完整版

✅ **Bug 修复**: `withDefaults` / `defineSlots` 未实现却静默通过，产出**非法 JavaScript**

- **现象**: 这两个编译宏原先不报错也不被移除，原样留在产物中：
  - `withDefaults(defineProps<...>(), {...})` → setup 内 `withDefaults is not defined`
  - `defineSlots<{...}>()` → **保留了 TS 泛型**，实测
    `new Function('defineSlots<{ d: () => any; }>();')` 抛 **SyntaxError**，
    即产物是非法 JS，小程序连文件都无法加载
- **严重度**: 高于普通运行时错误——语法错误会导致整个模块加载失败
- **修复**: 新增 `assertNoUnsupportedMacro()`，在阶段1遍历中拦截
  `withDefaults` 与 `defineSlots`（含 `TSInstantiationExpression` 形式），
  抛出含替代方案的 `CompileError`
- **回归测试**: 新增 `tests/unsupported-macros.test.ts`（6 个用例：
  两种宏报错与提示、无泛型形式、5 个受支持宏对照）

✅ **Bug 修复**: Vue 内置组件作为未注册自定义组件进入产物，运行时不渲染

- **现象**: `<Teleport>` / `<Transition>` / `<KeepAlive>` / `<Suspense>` /
  `<component :is>` 原样出现在 WXML，且 `usingComponents` 为空对象，
  即被当作**未注册的自定义组件**——小程序不渲染任何内容且不报错
- **与 `v-html` 同类**: README/SKILL 早已列为不支持，编译期却无拦截
- **修复**: 新增 `assertNoBuiltInComponent()`（置于转换器链首位）。
  拦截名单**与 Vue 自身的 `isCoreComponent` 判定对齐**（读取本地
  `@vue/compiler-core` 源码确认），含小写变体：
  `Teleport/teleport`、`Suspense/suspense`、`KeepAlive/keep-alive`、
  `BaseTransition/base-transition`、`Transition`、`TransitionGroup`、
  `transition-group`，以及小写 `component`（动态组件）
- **边界澄清**: **仅小写 `component`** 是动态组件；`<Component>` 与
  用户组件同名情况按普通组件处理（与 Vue 的 `isComponent` 判定一致）
- **回归测试**: 新增 `tests/builtin-components.test.ts`（15 个用例：
  11 个变体报错、原生标签/用户组件/第三方库/大写 Component 对照不误伤）
- **验证**: 真实项目构建通过（434 文件、1826 产物），无误伤

✅ **核查（无缺陷）**: 不存在的 core API 导入由 TypeScript 拦截，编译器不重复校验

- **起因**: 按"产物必须能在小程序环境运行"的原则，穷举 20 个 Vue 宏/API
  在 VMS 中的行为。发现 `onMounted` / `h` / `getCurrentInstance` /
  `useAttrs` / `useSlots` / `useTemplateRef` 均**编译通过且原样透传**为
  `import { onMounted } from '@unmagic/vue-mini'`，
  而运行时（`packages/core/src/index.ts`）与类型声明（`dist/vue-mini.d.ts`）
  **都没有导出这些 API**——小程序中会得到 `undefined`，调用即抛错
- **职责判定（经实测而非推断）**: 在真实项目 `vms/example` 中写入
  `import { ref, onMounted } from '@unmagic/vue-mini'` 后执行 `tsc -p tsconfig.app.json`，
  得到明确错误：
  `TS2305: Module '"@unmagic/vue-mini"' has no exported member 'onMounted'.`
- **结论**: 职责边界正确，**无需修改编译器**
  | 层 | 职责 | 行为 |
  | -- | ---- | ---- |
  | TypeScript + 包类型声明 | 拦截不存在的 API | 准确报错 |
  | VMS 编译器 | 语法 → 小程序产物 | 透传 import |
  若让编译器再维护一份 API 白名单，会与运行时演进失配，
  且属重复实现类型检查
- **验证**: `tsc` 实测确认拦截有效；探针文件与 `tsconfig.app.tsbuildinfo`
  已清理，`vms/example` 工作区恢复原状

✅ **核查（结论：暂不改动）**: `wx:key` 是否应把 `:key="index"` 映射为索引

- **背景**: 按"产物必须符合小程序规范"的原则审查 `:key` 转换时，
  官方文档《WXML 列表渲染》写明：_"wx:key 不能使用数据绑定，
  应直接指定一个字段名字符串"_，且只有 `*this` 一个保留字
- **发现的疑点**: 该表述下 `wx:key="index"` 应被理解为读 **`item.index` 字段**，
  而 Vue 的 `:key="index"` 语义是"用循环索引"。VMS 当前直接把标识符
  原样输出（真实项目产物中有 43 处 `wx:key="index"`）
- **证据冲突（因此不改动）**:
  - 支持"字段名"解释：官方文档原文；文档同时强调 `wx:key` 不能数据绑定
  - 支持"循环索引"解释：腾讯官方组件库 **tdesign-miniprogram 的产物中
    有 39 处 `wx:key="index"`**（另 2 处 `*this`），说明实践中被当索引用
- **结论**: 两种解释各有权威来源，**证据不足以判定**。
  按"语义不确定时不改行为"的原则保持现状，并把歧义写入代码注释，
  供后续拿到渲染器实现或真机验证时再定夺
- **过程中的自省**: 首版尝试直接改成"省略 wx:key + 警告"，
  但这是一次**基于文档单方面解释的行为变更**，且编辑引入语法错误——
  已完整回滚，仅保留注释形式的记录
- **验证**: `tsc --noEmit` 通过；`tests/v-for.test.ts` 与
  `tests/spec-conformance.test.ts` 共 42 个用例全绿，行为未变

✅ **Bug 修复**: style 块的不兼容写法改为编译期报错（原先产出无效 WXSS）

- **原则**: 同上一项——**先判断产物能否在小程序中运行**。以下写法原先静默产出
  无效 WXSS，使用者只看到"样式没生效"：
  | 写法 | 修复前产物 | 后果 |
  | ---- | ---------- | ---- |
  | `<style lang="scss">.a { .b {…} }` | 嵌套语法原样输出 | WXSS 无法解析 |
  | `<style src="./x.css">` | **空字符串** | 样式静默全部丢失 |
  | `color: v-bind(c)` | `v-bind(c)` 原样输出 | 永不生效 |
- **修复**: 新增 `assertStyleIsWxssCompatible()`，对上述三类抛出 `CompileError`
  并说明原因与替代方案（改用标准 CSS / 内联样式 / 动态 class）
- **同时确认无需处理**: 用 13 个探针核对 WXSS 实际支持范围，以下**均受支持**、
  不应误拦——`*`、属性选择器、`+`/`~` 组合器、`:hover`、
  `::before`、`:nth-child()`、`:not()`、`@media`、`@keyframes`、
  `@import`、`!important`
- **回归测试**: 新增 `tests/style-wxss-compat.test.ts`（9 个用例：
  三类报错、标准 CSS / `lang="wxss"` / 常见选择器 / `:deep` 既有行为不变）
- **验证**: 真实项目构建通过（88 个 style 块均为标准 `<style scoped>`，无回归）

✅ **方向修正**: `$` 属性名改为编译为 WXS 合法的计算成员形式

- **原则确认**: 支持 Vue 语法时，**先判断转译后代码能否在微信小程序环境运行**，
  不能一昧照搬 Vue 语义
- **修正内容**: 前一版把 `obj.$value` **原样保留**在 WXS 输出中。但那只是
  把"静默取错值"换成了"在 WXS 里生成 `$` 标识符"——WXS 不支持 `$` 标识符
  （该 sanitizer 存在的原始理由），产物能否运行取决于工具链宽松程度
- **正确做法**: 属性名含 `$` 时编译为**计算成员/字符串键**
  - `obj.$value` → `obj['$value']`
  - `a.$b.$c` → `a['$b']['$c']`
  - `{ $k: 1 }` → `{ '$k': 1 }`
    键名精确不变，且产物中不再出现 `$` 标识符
- **变量名不受影响**: `$flag` → `_flag`（原本就正确）
- **测试更新**: `tests/wxs-dollar-sanitize.test.ts` 原有用例断言的是
  **错误行为**（`expect(wxml).toContain('obj.$value')`），已重写为断言
  WXS 合法形式，并补充对象字面量键的用例
- **新增校验**: `scripts/verify-artifacts.mjs` 增加检查项——
  扫描产物中 WXS 代码块，若出现 `$` 标识符（排除字符串与注释）则报告。
  已用合成样例验证该检查**确实会触发**，非死代码

✅ **Bug 修复**: `v-html` / `v-text` 等指令被静默丢弃，内容彻底丢失

- **现象**: `<view v-html="html"></view>` 产出**空元素**
  （`<view class="class" style="{{style}}" />`），内容全部丢失且**不报任何错**；
  `v-text` 同理。`v-once` / `v-memo` / `v-cloak` 亦被静默忽略
- **矛盾点**: README 与 SKILL 早已把 `v-html` 列在"不支持的 Vue 特性"表中，
  但编译期**没有任何拦截**——文档说不支持、实现却静默产出错误结果，
  这是最难排查的一类问题（产物看起来"正常"，只是内容没了）
- **修复**: 新增 `transformUnsupportedDirective`（置于转换器链首位），
  对 `v-html` / `v-text` / `v-once` / `v-memo` / `v-cloak` 抛出
  `CompileError`，并给出替代方案：
  - `v-html` → 使用 `<rich-text nodes="{{...}}" />`
  - `v-text` → 使用插值 `<text>{{ value }}</text>`
- **v-pre 无需拦截**: 实测确认 Vue 解析器已将其内容转为**文本节点**
  （`{{ raw }}` 保留为字面量而非插值），语义与 Vue 一致，故不入拒绝表
- **回归测试**: 新增 `tests/unsupported-directives.test.ts`（9 个用例：
  5 个指令报错、2 个错误信息含替代方案、v-if/v-show/v-for 与 v-pre 对照不变）
- **验证**: 真实项目构建通过（未使用这些指令，无回归）

✅ **Bug 修复**: `:deep()` 穿透选择器原样输出，WXSS 不支持导致样式静默失效

- **现象**: `:deep(.t-input__content) { color: #333 }` 被**原样**写入 .wxss。
  WXSS 不支持 `:deep()`，微信开发者工具会丢弃整条规则，样式静默不生效。
  真实项目中已存在 **14 处**（AddCostItemIndex / StoreListDescriptionItem / DynamicForm）
- **原因**: `parseStyles` 只处理 scoped 属性选择器（`[data-v-xxx]`）的移除，
  对 Vue scoped CSS 的 `:deep()` / `::v-deep()` 语法没有任何处理
- **修复**: 新增 `unwrapDeepSelectors()` 展开穿透选择器：
  - `:deep(.b)` → `.b`
  - `.content-area :deep(.text)` → `.content-area .text`
  - 同一条规则内多次出现、`::v-deep()` 写法均支持
  - 按字符扫描跳过**字符串字面量与注释**，避免误改
    `content: ":deep(x)"` 这类声明值
- **验证（真实产物）**: `:deep` 在 `dist/prod` 中的出现次数由 **14 → 0**，
  且展开后的选择器正确（`.t-input__content`、`.content-area .content-text` 等）
- **回归测试**: 新增 `tests/style-deep.test.ts`（13 个用例：各类展开形态、
  字符串/注释不被误改、既有 scoped 行为不变）
- **备注**: `lang="scss"` / `<style module>` / `v-bind()` 仍无处理，
  但真实项目未使用；如后续引入需另行支持

✅ **核查（无缺陷）**: v-for 源表达式的产物形态

- **矩阵范围**: 8 种源表达式（纯引用 / 成员访问 / 计算成员 / 方法调用 /
  链式 filter / 三元 / 逻辑兜底 / concat）× 3 类变量（setup ref / 全局 / import）
- **过程中再次修正误判**: 矩阵对 setup ref 报出 7 处 "BAD(nowrap)"，
  追查后确认同样是**预期写错**——`v-for` 的 source 位于 **WXML 绑定**中，
  并非桥接函数，因此 setup ref 在此处本就不经过 `__vmsProxyRefs`：
  - 纯引用/成员访问 → 直接绑定 `{{local}}` / `{{local.items}}`，由 setData 解包 ref
  - 含方法调用/条件等需降级的表达式 → 编译为 WXS，变量以**参数**传入
    （`__wxs_0(flag, local, other)`）
- **核查结果**: 无缺陷。代码按设计工作
- **沉淀测试**: 新增 `tests/vfor-source-shapes.test.ts`（4 个用例）固化四种产物形态

✅ **核查（无缺陷）**: 交叉矩阵扩展到模板指令位置与 v-model 目标

- **方法延续**: 上轮的"改写路径 × 变量类别"矩阵只覆盖事件处理器内部。
  本轮扩展到**模板指令位置**（`v-if` / `v-show` / `:class` / `:style` /
  插值 / `:attr` / `v-for` 源 / computed 参数）与 **v-model 目标**（setup ref /
  v-for item / 嵌套 item / 解构变量）
- **过程中修正的一处误判**: 矩阵最初对模板位置报 7 处 "BAD(nowrap)"，
  追查后确认是**我的预期写错了**——模板位置不经过 `__vmsProxyRefs`，
  而是直接绑定 `{{local}}` 由运行时 `setData` 解包 ref；
  走 WXS 的位置则以**函数参数**形式传入（`__wxs_0(local)`），
  全局变量（如 `Date`）正确地作为自由变量不传参。代码本身是对的
- **核查结果**: 模板指令位置与 v-model 目标**均无缺陷**。具体确认：
  - `item` / `index` 用于 `:class`、`:style`、`v-if` 时保持原名，不包装
  - 嵌套 v-for 的内层 `c` / `ci` 作为 WXS 参数正确传递
  - v-model 在 setup ref / v-for item / 嵌套 item / 解构变量四种目标下
    产物均正确（含多级索引解构与逐级解引用）
- **沉淀测试**: 新增 `tests/vfor-vars-in-directives.test.ts`（4 个用例），
  把"v-for 变量在模板指令中不被包装"固化为回归防线

✅ **Bug 修复**: v-for 的 `index` 作为方法调用基对象时被误注册为组件 data

- **现象**: `<view v-for="(item, index) in list"><button @tap="index.go()">`
  产出的桥接函数为 `return index.go(__vms_event)`，而 `index` **从未声明**；
  同时 `__vmsInternalState` 里多出一项 `{ index }`（引用未声明标识符）。
  实测抛 `index is not defined`
- **原因**: `handleMemberExpressionCallee` 判定"是否 v-for 局部变量"时
  只检查 `vForItemName.has(calleeName)`，**未检查 index 名**，
  于是 `index.go()` 落入"外部变量"分支，被 `addProperty` 注册进组件 data
- **修复**: 判定条件补上 index 名匹配（`getVForIndexName(info) || 'index'`）。
  修复后产物为 `const { a: [index] } = e.currentTarget.dataset; return index.go(e)`，
  WXML 同步输出 `data-a="{{[index]}}"`
- **对照**: `item.go()` 一直正常（走 v-for item 分支，经
  `__vmsProxyRefs.list[index]` 还原局部变量）
- **回归测试**: 新增 `tests/vfor-index-callee.test.ts`（3 个用例：
  `index.go()` 不进入 data、`item.go()` 对照、`index.toString()`）
- **发现方式**: 构建 **改写路径 × 变量类别** 交叉矩阵（7 条路径 × 8 类变量），
  自动比对"是否被包装"与预期，5 个组合命中异常

✅ **Bug 修复**: 表达式体处理器把**全局变量**包装为 `__vmsProxyRefs`，运行时抛错

- **现象**: `<button @tap="() => onX(Date.now())">` 生成
  `onX(__vmsProxyRefs.Date.now())`。`Date` 从未注册进组件 data，
  实测抛 `Cannot read properties of undefined (reading 'now')`
- **影响面**: `Date` / `Math` / `JSON` / `Object` / `console` / `wx` /
  `globalThis` / `Function` / `performance` 等全部全局变量，
  只要出现在**表达式体处理器的调用参数**中就会失效
- **原因**: `eventHelpers.ts` 的 `buildProxyRefsArgument` 处理 Identifier 时
  检查了 import / props / v-for 变量，唯独**缺少 `GLOBAL_WHITELIST` 判断**，
  于是兜底包装成 `__vmsProxyRefs.xxx`。
  同文件的 `rewriteCalleeObject` 与 `inlineHandler.ts` 的
  `rewriteExpressionVars` 都有该判断，仅此分支遗漏
- **路径差异**（诊断关键）:
  | 写法 | 路径 | 修复前 |
  | ---- | ---- | ------ |
  | `() => { return f(Date.now()) }` | `rewriteExpressionVars` | ✅ 正确 |
  | `() => (flag ? f(Date.now()) : 0)` | 条件表达式路径 | ✅ 正确 |
  | `() => f(Date.now())` | `buildProxyRefsArgument` | ❌ 包装错误 |
- **修复**: 该分支补上 `GLOBAL_WHITELIST.has(arg.name)` 判断，命中则原样返回
- **回归测试**: 新增 `tests/global-vars-in-handler.test.ts`（8 个用例：
  `Date.now()` 不被包装、5 个全局对照、块体一致性、普通 ref 仍包装）
- **发现方式**: 对 `GLOBAL_WHITELIST` 做**反向验证**——不看白名单内容是否正确，
  而是构造真实全局表达式，检查产物是否把它当普通变量处理

✅ **Bug 修复**: 计算成员作为调用目标时索引变量未改写（第 6 处同类模式）

- **现象**: `<button @tap="() => a[b]()">`（`b` 为 ref）生成
  `__vmsProxyRefs.a[b](__vms_event)`，`b` 未定义 → `ReferenceError: b is not defined`
- **位置**: `eventHelpers.ts` 的 `rewriteCalleeObject`——处理成员调用 callee 时
  只改写根对象，`property` 原样透传
- **修复**: `computed` 为真时把 `property` 改写为 `__vmsProxyRefs.<prop>`；
  非计算成员的属性名保持原样
- **回归测试**: 新增 `tests/computed-callee.test.ts`（直接 callee、内联箭头包裹）

✅ **核查（无缺陷）**: 未显式处理的表达式类型均显式报错而非静默失效

- **方法**: 穷举 rewriter 未覆盖的节点类型（SequenceExpression、ObjectExpression
  计算键、NewExpression、TaggedTemplate、SpreadElement、嵌套箭头），
  逐一编译并检查产物
- **结果**:
  - `a, b` / `{ [k]: v }` / `new Foo(v)` / `tag\`...\``作为**表达式体**时
抛出明确的`CompileError`（"暂不支持的内联事件函数体…请改用函数调用、赋值或条件表达式"）
  - 同样的表达式放在**块体**中则正常工作（已实测 `new` 与 sequence 均正确改写变量）
  - `SpreadElement`（`fn(...list)`）产物为 `fn(...__vmsProxyRefs.list)`，正确
- **结论**: 该模块对未支持形态采取"显式报错"而非"静默生成空处理器"，
  设计正确，无需修改

✅ **排查**: 计算成员缺陷的同类模式全量收敛（共 5 处）

- **背景**: 上一轮修复"解构变量在计算成员中未改写"后，本轮发现同一模式
  （只递归 `object`、原样透传 `property`）在**多个改写器/收集器中重复出现**
- **全量排查结果**（`src/template` 内所有 `isMemberExpression` 分支）：
  | 位置 | 作用 | 状态 |
  | ---- | ---- | ---- |
  | `expression.ts` `rewriteDestructuredVarsInAst` | 解构变量改写 | 上一轮已修 |
  | `inlineHandler.ts` `rewriteExpressionVars` | 块体处理器改写 | 本轮修复 |
  | `eventHelpers.ts` `buildProxyRefsArgument` | 表达式体处理器改写 | 本轮修复 |
  | `variableCollector.ts` `scanNode` | 事件参数变量收集 | 本轮修复 |
  | `variableCollector.ts` `collectVarsFromNode` | 条件/逻辑式变量收集 | 本轮修复 |
  | `vmodel.ts` 各分支 | 赋值目标判定 | 已正确（仅判断节点类型） |
- **统一修复原则**: `computed` 为真时递归 `property`；非计算成员的属性名保持原样
- **回归测试**: `tests/inline-handler-computed-member.test.ts`（4 个用例）、
  `tests/conditional-computed-member.test.ts`（2 个用例）

✅ **Bug 修复**: 内联事件处理器中计算成员的索引变量未被改写（运行时 ReferenceError）

- **现象**: `<button @tap="() => onPick(map[key])">`（`key` 为 ref）生成
  `onPick(__vmsProxyRefs.map[key])`——对象侧被改写，**索引侧的 `key` 未改写**。
  handler 作用域内没有 `key` 变量，实测抛 `ReferenceError: key is not defined`
  （比"静默取 undefined"更严重）
- **根因**: 同一缺陷模式在**第三个**改写器中重现。
  两个上层入口都只递归 `object`、原样透传 `property`：
  - `inlineHandler.ts` 的 `rewriteExpressionVars`（块体处理器）
  - `eventHelpers.ts` 的 `buildProxyRefsArgument`（表达式体处理器，含
    `MemberExpression` 与 `OptionalMemberExpression` 两个分支）
- **修复**: 三处均在 `computed` 为真时递归改写 `property`；非计算成员的
  属性名保持原样
- **回归测试**: 新增 `tests/inline-handler-computed-member.test.ts`（4 个用例：
  表达式体读取、块体赋值、v-for 内读取、非计算属性名保留）
- **备注**: 块体写法（`() => { return f(a[b]) }`）此前已正确，
  因为走的是 `rewriteExpressionVars`；表达式体写法走
  `buildProxyRefsArgument`，正是遗漏之处

✅ **Bug 修复**: 解构变量出现在**计算成员**中时未被改写，静默取到 undefined

- **现象**: `v-for="{ id, map } in list"` 内使用 `map[id]`，生成
  `item.map[id]`——对象侧被改写为 `item.map`，但**索引侧的 `id` 没有改写**。
  WXML 作用域中不存在 `id`（只有默认的 `item`），因此 `id` 恒为 undefined，
  取值恒为 undefined，且不报错
- **原因**: `rewriteDestructuredVarsInAst` 处理 `MemberExpression` /
  `OptionalMemberExpression` 时只递归 `object`，
  `property` 原样透传。计算成员（`obj[expr]`）的 `property` 本身是表达式，
  其中可能引用解构变量，必须一并递归
- **影响**: 仅"解构式 v-for + 计算成员索引引用解构变量"这一组合触发；
  常见的 `obj.id`（非计算成员）与 `arr[0]`（字面量索引）均正常
- **修复**: 计算成员时递归 `property`；非计算成员的属性名保持原样
- **回归测试**: 新增 `tests/destructured-computed-member.test.ts`（4 个用例：
  单层索引改写、嵌套计算成员逐层改写、非计算属性名保留、字面量索引保持）
- **发现方式**: 对 AST 改写做**执行级差分测试**（同一表达式在原生语义与
  改写语义下的行为对比），与上一轮 `$` 属性名缺陷同属一类

✅ **Bug 修复**: WXS 降级把**属性名**中的 `$` 也改写了，静默取错值

- **现象**: `<view :class="obj.$value ? 'on' : 'off'">` 生成
  `obj._value ? 'on' : 'off'`，而数据的键仍是 `$value`，
  表达式恒为 `undefined` → 实际渲染 `'off'`
- **原因**: `sanitizeWxsAst` 遍历 AST 时对所有 `Identifier` 统一做
  `$` → `_` 替换，未区分"变量引用"与"非计算成员的属性名"。
  WXS 不支持的是 `$` **标识符**，而属性名只是字符串键，无需改写
- **影响范围**: 仅当数据键本身含 `$` 且该表达式走 WXS 降级路径时触发；
  简单插值（`{{ obj.$value }}`）不经过该清理，因此一直正常，
  原有用例也未覆盖此组合
- **修复**: 遍历时跳过 `MemberExpression` / `OptionalMemberExpression`
  的非计算 `property`，以及 `ObjectProperty` / `ObjectMethod` 的非计算 `key`；
  变量名与计算成员（`obj['$k']`、`obj[k]`）行为不变
- **回归测试**: 新增 `tests/wxs-dollar-sanitize.test.ts`（4 个用例：
  属性名保留、可选链属性保留、变量名仍替换、计算成员不受影响）
- **发现方式**: 对 WXS 表达式降级做**执行级差分测试**（降级产物实际运行 vs 原生语义）

✅ **Bug 修复**: `wxsUtils.padStart` 多字符填充串截断方向错误

- **现象**: `padStart('a', 5, 'abc')` 返回 `'cabca'`，原生返回 `'abcaa'`
  （`padStart('x', 6, 'ab')` → `'bababx'`，应为 `'ababax'`）
- **原因**: 旧实现反复 `result = pad + result` 后取
  `result.slice(result.length - targetLength)`（尾部），
  当填充串需被截断时保留了**后缀**而非**前缀**
- **规范**: 原生 `String.prototype.padStart` 在截断填充串时保留其前缀
- **影响范围**: 仅多字符填充串且长度非整除时触发；单字符填充串（最常见用法）
  结果正确，因此原有用例全部通过、缺陷长期未暴露
- **修复**: 先构造足够长的 `filler`，取 `filler.slice(0, padLength)` 前置拼接
- **回归测试**: `tests/wxs-polyfill.test.ts` 新增 6 个用例
  （非整除截断、整除、空填充串、目标长度小于原长度、`padEnd` 对照）
- **验证**: 修复已进入 `dist/polyfill/wxsUtils.wxs` 与 example 产物，
  且 `dist` 中的实现实测与原生一致

✅ **度量**: 编译器阶段耗时剖面（真实项目文件）

- **方法**: 对 example 中 4 个真实 .vue 文件做阶段计时（parseSFC / 作用域分析 /
  模板转换 / 脚本转换），并对模板转换内部逐 transform 隔离测量
- **结论一（阶段分布）**: 模板转换占总编译时间约 **79%**
  （大文件 RevenueAggregationIndex 1372 行：parseSFC 14ms、analyze 11ms、
  template 91ms、script 4ms）
- **结论二（热点归属）**: 隔离测量显示 `transformTemplateClass` 首次调用
  耗时约 **80ms**，远超基线 12ms——但**重复调用后降至 3-8ms**
- **结论三（非缺陷）**: 该 80ms 是 `@babel/preset-env` 的**一次性初始化开销**，
  不是按文件计的重复成本。真实构建（434 文件 / 约 1.9s）中已被摊薄，
  连续两次构建耗时稳定在 1935-1948ms。**因此不构成性能问题，无需优化**
- **副产品**: 隔离测量初次尝试时因自带 counter stub 返回空函数名，
  触发 `module.exports. = function` 解析失败——属测量脚手架问题，非编译器缺陷

✅ **修复**: 性能测试中的绝对耗时断言（flaky 根因）

- **问题**: `performance.test.ts` 断言 `avgTime < 1ms`、`maxTime < 2ms`、
  `duration < 100ms`。这些阈值依赖机器负载，在整仓库并行跑测试时随机失败
  （本项目已实际发生，见上一轮 flaky 记录的同类问题）
- **修复**: 改为断言**结构性**性质——多次运行产物必须完全一致
  （`outputs.size === 1`）、产物包含预期指令（`wx:for`）；
  耗时仅打印供参考。保留唯一一处 `< 5000ms` 作为 1000 层嵌套的
  栈溢出看门狗（该阈值为数量级保护，不受负载影响）
- **验证**: 连续 5 次全量套件运行，574 个用例全部通过，无随机失败

✅ **新增**: 产物级一致性校验脚本 `scripts/verify-artifacts.mjs`

- **动机**: 此前所有校验都停留在单元测试层（编译器输入 → 字符串断言）。
  真实构建产物之间的**跨文件一致性**从未被检查过，
  而这类问题（WXML 绑定指向不存在的处理函数、组件路径无法解析）
  只有在产物层面才暴露
- **检查项**（对 `dist/prod` 实跑，非模拟管线）：
  1. 每个事件绑定（`bind:` / `catch:` / `mut-bind:` / `capture-*`）
     指向的处理函数在配套 .js 中有定义
  2. `wms_wxs.__wxs_N` 调用在同文件 `<wxs>` 中已定义
  3. `usingComponents` 的每个路径可解析到实际文件
  4. 每个 `data-*` 索引键在配套 .js 的 setter 解构中出现
- **首次扫描结果**（1826 个文件 / 147 个 WXML / 150 个 JSON）：
  事件绑定 695、WXS 调用 254、组件引用 664、data-\* 索引 70 —— 全部通过，
  仅 1 处报告见下条
- **用法**: `pnpm verify:artifacts`（仅报告）/
  `pnpm verify:artifacts --strict`（发现问题 exit 1，供 CI 使用）
- **范围**: 排除 `miniprogram_npm`（第三方 JS 经 minify，函数名无法用正则可靠识别；
  其 `template/*.wxml` 是被 `<import>` 引用的片段，本就没有配套 .js）

✅ **发现（非编译器缺陷）**: 示例项目原生组件存在无效事件绑定

- **位置**: `example/src/subMy/.../UploadCardPicture/UploadCardPicture.wxml`
- **现象**: `<t-image-viewer bind:close="onClose">` 中的 `onClose`
  在配套 `.ts` 的 setup 返回值中不存在（同时 `visible` 也未定义）
- **判定**: 该组件的 WXML 为**原生四件套**，构建产物与源码逐字节相同
  （已 diff 确认），VMS 未参与编译，属示例项目自身的业务代码缺陷，
  非编译器问题。已记录但未擅自修改示例业务逻辑
- **价值**: 该问题正是产物级校验才能发现的类型

✅ **重构**: 抽出递归文件收集到 `src/utils/collectFiles.ts`

- **位置**: `cli.ts` 的 `buildComponentLibrary` 内联递归遍历
- **收益**: `cli.ts` 770 → 761 行（累计 885 → 761，-14%）；
  遍历逻辑与"并发转译 + minify + 写回"解耦，可独立测试
- **行为改进**: 原实现未捕获 `readdir` 失败——目录不可读会让整个依赖构建抛错；
  抽出后缺失目录返回空数组，由调用方决定是否告警
- **新增测试**: 8 个用例覆盖后缀过滤、多后缀、递归、空目录、
  缺失目录、符号链接不跟随、绝对路径返回、`lib.min.js` 结尾匹配
- **顺带确认**: 符号链接的 `Dirent.isFile()` 为 false，因此不会被跟随
  （已在本机验证 Dirent 行为），避免循环引用与目录越界

✅ **重构**: 抽出依赖构建去重到 `src/utils/moduleDedup.ts`

- **位置**: `cli.ts` 内 `bundleModule` 的 `builtLibraries` / `bundledModules` 判定
- **收益**: `cli.ts` 783 → 770 行（累计 885 → 770，-13%）；
  去重判定与构建流程解耦，边界行为（`foo` vs `foo-bar`、
  `foo` vs `foo/plugin`）此前无测试覆盖
- **新增测试**: 12 个用例覆盖同名覆盖、子路径覆盖、同前缀包不误判、
  多库命中、动态 getter、多构建上下文独立登记、`register` 语义
- **顺带清理**: 移除从未被调用的 `clear()`（原 `bundledModules` 也从未清理，
  保留死 API 只会误导后续维护）
- **已记录的既有行为**: `pkg` 仅作 Map 键、不做归一化，
  两条调用路径分别用 `src/subLock` 与 `subLock`，因此彼此不去重。
  这是原行为，本次保持一致并在代码注释中说明，避免被误当缺陷顺手"修掉"
  而改变产物复制次数

✅ **排查**: `startsWith` 目录前缀判断全仓库扫描

- **动机**: "用裸 `startsWith` 判断目录前缀"这一模式已连续出现三次
  （`outputPath` 映射、结尾分隔符、独立分包归属），故做一次系统性排查
- **扫描结果**（`src` 内全部 18 处 `startsWith`）:
  - 目录前缀判断：均已收敛到 `isPathInside()`（`outputPath.ts` / `packagePath.ts`）
  - `transformer.ts` / `collectImports.ts` 的 `@/`、`./` 等：模块说明符匹配，语义正确
  - `script/index.ts` 的 `__fun_` 前缀：内部命名约定，语义正确
  - `template/tools.ts` 的 `_vms_` 前缀：内部标签约定，语义正确
  - `cli.ts:172` 的包名判断：已正确使用 `library + '/'` 做边界区分
  - `componentMatcher.ts`：组件名前缀（非文件路径），但见下方新发现的边界缺陷
- **结论**: 目录前缀类缺陷已无遗漏；扫描过程中另外发现组件匹配的边界问题

✅ **Bug 修复**: 组件名恰好等于前缀时生成畸形路径

- **现象**: `ComponentMatcher.match()` 对 `t-`（标签名恰好等于前缀）
  或前缀后仅剩空白的名称，会生成 `tdesign-miniprogram//` 这类空组件名路径，
  指向不存在的组件目录并写入 `usingComponents`
- **原因**: 去掉前缀后未校验剩余部分是否为空
- **修复**: `relativePath` 取 `trim()` 后为空则返回 `null`（不匹配）
- **回归测试**: `tests/component-matcher.test.ts` 用例 1.3 / 1.4
- **补充**: 该文件此前**零测试覆盖**，本轮补齐 10 个用例
  （前缀匹配、精确匹配优先、配置校验、`hasConfig`）

✅ **Bug 修复**: 独立分包归属判断前缀匹配过宽（依赖复制到错误分包）

- **现象**: `dealScriptCode` 用 `filePath.startsWith(path.normalize(sourceDir/item))`
  判断文件属于哪个独立分包，导致同前缀的兄弟分包被误归属：
  - `src/subLock2/a.ts` → 判定属于 `subLock`
  - `src/subLockExtra/a.ts` → 判定属于 `subLock`
- **影响**: `pkg` 决定该文件引用的 npm 依赖复制到哪个分包的
  `miniprogram_npm`，误归属会把依赖写进错误的输出目录
- **修复**: 抽出 `isPathInside()`，要求前缀之后紧跟路径分隔符（或完全相等）；
  与上一轮 `outputPath` 的修复属同一类问题，统一收敛到
  `src/utils/packagePath.ts`
- **回归测试**: `tests/package-path.test.ts` 用例 1.4 / 1.5 / 2.3

✅ **重构**: 抽出独立分包路径归属到 `src/utils/packagePath.ts`

- **位置**: `cli.ts` 内 `dealScriptCode` 的分包查找 + `normalizedPkgPaths` 缓存
- **收益**: `cli.ts` 806 → 783 行（累计 885 → 783，-11.5%）；
  顺带移除与 `normalizedPkgPaths` 重复的缓存（`path.normalize` 开销可忽略，
  而该缓存在生产流程结束时才清理，属无收益的复杂度）
- **新增测试**: 11 个用例覆盖子路径、完全相等、同前缀兄弟目录、
  结尾分隔符、多分包命中、主包归属、空列表、深层嵌套

✅ **Bug 修复**: 输出路径前缀匹配过宽 + 结尾分隔符丢失

- **问题一（原实现）**: `inputPath.startsWith(sourceDir)` 把同前缀的兄弟目录
  误判为源目录内路径：
  - `src-extra/a.ts` → `<输出目录>-extra/a.ts`
  - `srcfoo/a.ts` → `<输出目录>foo/a.ts`
    会写到预期之外的位置。当前 watcher 只监听 `sourceDir`，故未实际触发，
    属于潜伏缺陷；抽模块时一并收紧为"前缀后必须紧跟路径分隔符"。
- **问题二（抽取时自查发现）**: 去前缀用 `inputPath.slice(sourceDir.length)`，
  当 `sourceDir` 以分隔符结尾（`src/`）时会丢掉分隔符，
  输出路径变成 `dist/prodpages/a.ts`。已改为 `stripSourceDir()` 保证剩余部分
  始终以分隔符开头。
- **回归测试**: `tests/output-path.test.ts` 用例 1.4 / 1.5 / 1.7

✅ **重构**: 抽出源→输出路径映射到 `src/utils/outputPath.ts`

- **位置**: `cli.ts` 内 `pathCache` / `getOutputPath` / `clearPathCache`
- **收益**: `cli.ts` 808 → 806 行；该映射是所有产物写盘的必经之路，
  历史 P0 缓存一致性问题（P0-2）正出在此处，此前**零测试覆盖**。
  新模块暴露 `toOutput` / `clear` / `invalidate` 三个明确接口，
  并把原先散落的 `pathCache.delete` 调用改为语义化的 `invalidate`
- **新增测试**: 11 个用例覆盖映射、同前缀目录、结尾分隔符、缓存命中、
  clear/invalidate、空输入

✅ **Bug 修复**: 独立分包识别失效（只读小写 `subpackages`，漏掉官方驼峰 `subPackages`）

- **现象**: `findIndependentPackages` 只读取 `appJson.subpackages`，而微信官方
  `app.json` 使用驼峰 `subPackages`（小写仅为别名）。标准项目下
  `independentPackages` 恒为空数组
- **影响**: 独立分包的 `miniprogram_npm` 依赖不会被复制到分包目录
  （见 `independentPackages.map(... fs.copy)`），产物缺少依赖导致运行时找不到模块
- **对照证据**: 同一文件中 `loadPagePaths` 读的是驼峰 `subPackages`，
  两处不一致；真实项目 `app.json` 中 `subPackages: true / subpackages: false`
- **修复**: 抽出 `getSubPackages()` 统一兼容两种写法（驼峰优先），
  页面路径收集与独立分包识别共用同一入口
- **回归测试**: `tests/app-json.test.ts` 用例 3.1 / 3.2 / 3.3
  （含"识别驼峰写法中的独立分包"这一关键断言）

✅ **重构**: 抽出 app.json 相关工具到 `src/utils/appJson.ts`

- **位置**: `cli.ts` 内的 `loadPagePaths` / `isPageComponent` 路径归一化 / 分包解析
- **收益**: `cli.ts` 885 → 808 行（累计从 885 降到 808）；这部分决定"哪些文件是页面组件"
  与"哪些分包独立"，历史上有过缓存一致性缺陷（P0-1/P0-2）却**零测试覆盖**
- **新增测试**: 15 个用例覆盖两种分包写法、路径拼接、去重、独立分包筛选、
  路径归一化（含 .vue / 非 .vue）

✅ **Bug 修复**: `batchProcess` 任务提前失败时 Promise 永不 settle（构建挂死）

- **现象**: 并发池中有任务失败且**剩余任务尚未启动**时，Promise 既不 resolve
  也不 reject，构建过程永久挂起
- **原因**: 结束判定用的是 `completed === total`，但出错后 `hasError` 会阻止
  新任务启动，`completed` 永远无法到达 `total`，判定条件永不成立
- **修复**: 改为 `running === 0 && (hasError || index === total)`
  （已无在跑任务，且已出错或全部启动过），并移除失效的 `completed` 计数器
- **发现方式**: 抽取该函数到独立模块并补测试时，用例 1.5 / 1.6 直接超时暴露
- **回归测试**: `tests/concurrency.test.ts` 用例 1.5 / 1.6（失败传播 + 不再启动后续任务）

✅ **重构**: 抽出 `batchProcess` 并发池到独立模块

- **位置**: `cli.ts` 内联实现 → `src/utils/concurrency.ts`
- **收益**: `cli.ts` 885 → 838 行；并发调度逻辑与构建流程解耦，获得 8 个单元测试
  （此前该函数**零测试覆盖**，而它是文件处理与依赖打包的核心调度器）
- **新增测试**: 空输入、任务完整性、并发上限、上限大于任务数、失败传播、
  失败后不再启动、上限非法值不死锁、慢任务不阻塞后续启动

✅ **Bug 修复**: 组件 `.lazy` 被静默忽略（产物与不加修饰符完全一致）

- **现象**: 第 10 轮修掉"监听错误事件名"后，`.lazy` 退化为**静默 no-op**——
  `<MyComp v-model.lazy="t" />` 与 `<MyComp v-model="t" />` 产物**逐字节相同**，
  用户以为启用了延迟同步，实际没有任何效果
- **语义依据**: Vue 把修饰符作为 `modelModifiers: { lazy: true }` 传给子组件，
  由子组件决定 emit 时机：
  `createBlock(_component_MyComp, { ..., modelModifiers: { lazy: true } })`
- **根因**: VMS 没有 `modelModifiers` 等价机制（全仓库 0 处），
  `defineModel` 只编译出 `triggerEvent('update:xxx')`，不接收 modifiers；
  父组件既不能改事件名（第 10 轮已证伪），也不能告知子组件
- **修复**: 组件上的 `.lazy` 改为**编译报错**并说明原因与替代方案
  （在子组件内选择合适的时机触发 `update`）。原生标签的 `.lazy` 报错信息保持不变
- **回归测试**: `tests/v-model.test.ts` 用例 6.1b / 6.1c / 6.1d
- **文档同步**: `README.md`、`skills/vms/SKILL.md` 中的 `.lazy` 说明由
  "仅自定义组件有效"改为"暂不支持"

✅ **加固**: WXML 侧产物完整性不变式测试

- **动机**: 上一轮为 JS 侧建立了宿主标识符不变式，本轮补上模板侧。
  两者互补：JS 侧保证"引用有来源"，WXML 侧保证"指令产物自洽"
- **做法**: 新增 `tests/wxml-integrity.test.ts`，对 17 个代表性场景统一断言：
  1. 每个 `bind:*` 指向的 `__fun_N` 在 JS 中有对应 `function` 定义
  2. 每个 `data-*` 索引键在 setter 中被解构使用（防止索引回写链路断裂）
  3. `wx:for-item` 与 `wx:for-index` 不得同名（内层会遮蔽外层）
  4. `wx:elif` / `wx:else` 必须有前置 `wx:if`
- **覆盖场景**: 原生/组件 v-model、v-for 内 v-model（含嵌套）、事件传参、
  内联箭头函数、v-model 与显式事件共存、条件渲染链、template v-for、v-show、
  class/style/WXS、默认/具名/作用域插槽与插槽出口

✅ **加固**: 产物完整性不变式测试（覆盖全部宿主注入标识符）

- **动机**: 多轮审查发现的缺陷几乎都是"产物语法合法，但引用了不存在的变量"
  （如未声明的 `__vmsProxyRefs`、`__vmsProps.model`）。这类问题无法通过
  `parse()` 语法校验发现，而逐个手写用例又容易漏掉组合
- **做法**: 新增 `tests/host-identifier-integrity.test.ts`，对 15 个代表性场景
  统一断言产物不变式：
  - `__vmsProps` / `__vmsContext` 出现时必须同时是 `setup()` 的形参
  - `__vmsProxyRefs` / `__vmsRenderState` / `__vmsInternalState` 被访问时必须有 `const` 声明
  - `__fun_N` 被引用时必须有对应的 `function` 定义
  - 产物本身必须是可解析的合法 JS/TS
- **价值**: 这是**通用不变式**而非单点用例——后续新增特性若缺少配套声明，
  该测试会直接失败，无需再针对每个新组合补写断言
- **本轮覆盖**: 原生/组件 v-model、v-for 内 v-model（含解构、嵌套）、
  v-for 内事件与 computed、作用域插槽、defineModel、解构 props、修饰符、显式事件共存

✅ **Bug 修复**: v-for 内 v-model 产物引用未声明的 `__vmsProxyRefs`

- **现象**: `<view v-for="(it, i) in list"><input v-model="it.a" /></view>` 生成
  - setter: `const it = __vmsProxyRefs.list[i]; it.a = ...`
  - 但产物中**没有** `const __vmsProxyRefs = proxyRefs(...)`，
    也**没有**从 `@unmagic/vue-mini` 导入 `proxyRefs`
    → 运行时抛 ReferenceError，所有这类双向绑定均不可用
- **原因**: `__vmsProxyRefs` 的生成被
  `if (hasInlineFunctions || hasComputedBindings)` 门控。当 v-model 目标
  本身来自 v-for（item / 解构变量）时，代码走"不注册组件 data"的分支，
  `ctx.needsProxyRefs` 从未被置位，门控为假，声明整体被跳过
- **修复**: 门控增加 `|| needsProxyRefs`；并在 v-model 检测到 `inVFor` 时
  置位 `ctx.needsProxyRefs`（此类 setter 必然访问该变量）
- **回归测试**: 新增 `tests/output-integrity.test.ts`（6 个组合 × 断言
  "使用了 `__vmsProxyRefs` 就必须有声明与导入"，并校验产物语法合法）

✅ **Bug 修复**: `v-model` 与显式同名事件绑定共存时，v-model 回写被静默覆盖

- **现象**: 以下写法都会让 v-model 的 setter 变成**死代码**，数据不再回写：
  - `<input v-model="a" @input="onIn" />` → `bind:input="onIn"`（setter 被顶掉）
  - `<MyComp v-model="a" @update:modelValue="onUp" />` → `bind:update:modelValue="onUp"`
    生成的回写函数仍留在产物里，但没有任何绑定指向它
- **语义依据**: Vue 对同一事件的多个处理器会**合并为数组全部调用**
  （`"onUpdate:modelValue": [$event => (_ctx.a) = $event, _ctx.onUp]`），
  而不是后者覆盖前者
- **修复**: 新增 `mergeDuplicateEventHandlers()`——同一事件名存在多个处理器时，
  生成一个顺序调用各处理器的桥接函数（先去重，避免同一函数被调用两次）；
  无冲突时保持原有单一绑定不变
- **回归测试**: 新增 `tests/v-model-event-merge.test.ts`（4 个用例，
  含"显式绑定不得直接顶掉 setter"的回归防线）

✅ **Bug 修复**: 组件 `.lazy` 监听不存在的事件名，双向绑定静默失效

- **现象**: 父组件 `<MyComp v-model.lazy="t" />` 生成
  `bind:change:update:modelValue`，但**没有任何组件会触发该事件**
  （VMS 自身的 `defineModel` 只触发 `update:modelValue`，如
  `context.triggerEvent('update:checked')`），因此回调永不执行
- **证据**:
  1. 全仓库搜索 `change:update`，发送方为 0 处（仅本编译器自己生成接收端）
  2. 真实项目产物中 `bind:update:checked` 对应的原生源码正是
     `triggerEvent('update:checked', ...)`，收发两端名称严格一致
  3. tdesign-miniprogram 的 `triggerEvent` 名称均为无冒号单段（`change`/`confirm` 等）
- **原因**: 误把"延迟同步"实现成改写事件名，而小程序组件的事件名由子组件
  `triggerEvent` 决定，父组件无法通过改名来"延迟"
- **修复**: 事件名固定为 `update:<propName>`，不因 `.lazy` 改变；
  `.lazy` 仍作为合法修饰符保留（原生标签使用仍报错），
  真正的延迟同步应由子组件在合适时机触发 `update` 事件实现
- **回归测试**: `tests/v-model.test.ts` 用例 6.1b / 6.1c

✅ **Bug 修复**: 作用域插槽变量经 v-for 间接写入，产出引用未定义变量

- **现象**: 两种写法均生成 `__vmsProxyRefs.<slotVar>[...]`，运行时抛 ReferenceError：
  - `<template #row="{ items }">` 内 `v-for="it in items"` + `v-model="it.name"`
    → `const it = __vmsProxyRefs.items[i]`（items 从不注册）
  - `<template #row="{ item }">` 内 `v-for="sub in item.subs"` + `v-model="sub.name"`
    → `const sub = __vmsProxyRefs.item.subs[si]`
- **原因**: 插槽变量的**直接**使用已在上一轮拦截，但"作为 v-for 数据源再间接写入"
  绕过了该检查——v-for 的 source 根是插槽变量，父组件没有可写源
- **修复**: 当目标依赖的 v-for 链的 source 根属于 `ctx.scopedSlotVars` 时抛出 `CompileError`；
  仅在目标确实来自该 v-for item 时拦截，绑定父组件自己的 ref 不受影响
- **回归测试**: `tests/spec-conformance.test.ts` 用例 4.3c2 / 4.3c3

✅ **Bug 修复**: `defineModel` 变量作为 `v-model` 目标时绕过 customRef，事件不触发

- **现象**: 子组件内 `<input v-model="model" />`（`model` 来自 `defineModel`）
  生成 setter `__vmsProps.model = e.detail.value`：
  - `__vmsProps.model` 不是真实 property 名（property 名是 `modelValue`）
  - 完全**绕过 customRef 的 setter**，`triggerEvent('update:modelValue')` 永不执行，
    父组件 `v-model` 无法收到回传
- **原因**: `allPropsVarNames` 收集了 `propsVarsMap` 的**全部**键，
  而 `defineModel` 也通过 `propsVarsMap` 注册（`isDestructured: false`），
  于是被 `replacePropsAccessInFunction` 一并改写成 `__vmsProps.xxx`
- **修复**: 该集合只保留 `isDestructured: true` 的解构 props 与 rest 变量；
  `defineModel` 变量保持 `__vmsProxyRefs.xxx` 访问，由 proxyRefs 解包写入 `.value`
- **回归测试**: `tests/spec-conformance.test.ts` 用例 3.1c / 3.1d

✅ **Bug 修复**: 非字符串值标签上使用 `.trim` / `.number` 产出运行时报错或错误数据

- **现象**:
  - `<switch v-model.trim="on" />` → `e.detail.value.trim()`，boolean 没有 trim 方法，**必抛 TypeError**
  - `<slider v-model.trim="n" />` / `<picker v-model.trim="p" />` → 同样报错（值为 number）
  - `<switch v-model.number="on" />` → `+true` 静默得到 `1`，把 boolean 变成 number
- **原因**: 修饰符未按标签的事件值类型校验，无条件套用字符串方法
- **语义依据**: Vue 只在文本类输入（text/textarea）上应用 `.trim`/`.number`，
  checkbox/select 使用不同的 model 指令
- **修复**: `NATIVE_MODEL_MAP` 增加 `stringValue` 标记（仅 input/textarea 为 true），
  其余标签使用 `.trim`/`.number` 时抛出 `CompileError`；自定义组件不受限制
- **回归测试**: `tests/v-model.test.ts` 用例 6.3d / 6.3e / 6.3f

✅ **Bug 修复**: `.number.trim` 修饰符反序，产物运行时抛 TypeError

- **现象**: `v-model.number.trim="v"` 生成
  `(value === "" ? "" : +value).trim()`，对任何非空输入抛
  `TypeError: ...trim is not a function`（数字没有 trim 方法）
- **原因**: `applyValueTransform` 先应用 `.number` 再应用 `.trim`，与 Vue 相反
- **语义依据**: Vue 的 `vModelText` 是先 trim 再 number；空值判断也应作用于 trim 之后的值
- **修复**: 调整为先 `.trim` 再 `.number`；`.number.trim` 与 `.trim.number` 书写顺序不再影响产物
- **回归测试**: `tests/v-model.test.ts` 用例 6.3b / 6.3c

✅ **Bug 修复**: 动态插槽名 `v-slot:[name]` 静默绑定成字面量

- **现象**: `<template v-slot:[name]="{ item }">` 生成 `slot="name"`，
  把表达式文本当成了插槽名（应为变量 `name` 的值）
- **原因**: 未检查 `slotProp.arg.isStatic`，直接取 `arg.content`
- **修复**: 动态参数抛出 `CompileError`，提示小程序 slot 名须在编译期确定
- **回归测试**: `tests/spec-conformance.test.ts` 用例 4.3e / 4.3f

✅ **Bug 修复**: `defineModel` 使用 kebab-case 属性名产出非法 JS

- **现象**: `defineModel<string>('user-name')` 生成
  `properties: { user-name: {...} }` 与 `__vmsProps.user-name`，两处都是**语法错误**
- **原因**: `propName` 被直接交给 `t.identifier()` 当作标识符使用，未考虑非标识符名称
- **规范依据**: WXML 属性本身允许连字符（实际产物中已有 `active-tab="{{...}}"` 等），
  Vue 官方编译器对 `defineModel('user-name')` 同样生成 `"user-name"` 字符串键
- **修复**: `t.isValidIdentifier(propName)` 为假时改用字符串键 / 计算成员访问
  （属性注册、getter 读取两处）；事件名 `update:user-name` 保持不变
- **回归测试**: `tests/spec-conformance.test.ts` 用例 3.1b（含产物语法校验）

✅ **Bug 修复**: 作用域插槽变量可被 `v-model` 绑定，产出引用未定义变量

- **现象**: 父组件对 `<template #row="{ item }">` 内的 `item.name` 使用 `v-model` 时，
  setter 生成 `__vmsProxyRefs.item.name = ...`，但该变量从不注册，运行时抛 ReferenceError
- **原因**: `addRenderProperty` 已通过 `ctx.scopedSlotVars` 排除插槽变量，
  但 `vmodel.ts` 未做同样的只读校验
- **语义依据**: slot 变量由子组件传入，父组件中只读（Vue 运行时对同样写法会告警）
- **修复**: 目标根变量属于 `scopedSlotVars` 时抛出 `CompileError`，提示改用父组件 ref 承接
- **回归测试**: `tests/spec-conformance.test.ts` 用例 4.3c / 4.3d
  （同时确认插槽内绑定父组件自己的 ref 不受影响）

✅ **改进**: 作用域插槽未开启 glassEasel 时给出编译期告警

- **问题**: 作用域插槽依赖 glass-easel 的 `dynamicSlots`。未开启 `glassEasel` 时，
  产物仍会写入 `dynamicSlots: true` 但缺少 `componentFramework: 'glass-easel'`，
  真机上插槽数据不传递——属于**静默失效**，仅文档提示不足以避免踩坑
- **修复**: `transformer.ts` 检测到 `hasDynamicSlots && !glassEasel` 时输出黄色告警，
  指明具体文件与 `vms.config.js` 开关（不中断构建，便于渐进迁移）
- **回归测试**: `tests/transformer-glass-easel.test.ts`（直接调用真实 transformer，
  覆盖"有作用域插槽告警 / 无作用域插槽不告警"两种情形）

✅ **Bug 修复**: 解构式 v-for 的变量作为 v-model 目标时转译错误

- **现象**: `v-for="({ id, name }, index) in list"` 内写 `v-model="name"`：
  - WXML 生成 `value="{{name}}"`，但 `wx:for` 作用域内只有 `item`/`index`，取值恒为 undefined
  - setter 写出 `__vmsProxyRefs.name = ...`，把解构变量误注册成组件 data
- **原因**: `vmodel.ts` 是唯一没有调用 `resolveDestructuredVar` 的转换路径
  （表达式、事件、computed 均已正确处理）
- **修复**: 目标改写为对应层级的 item 属性访问（`name` → `item.name`、`{ user: { name } }` → `item.user.name`、
  `[a, b]` → `item[1]`），并排除解构变量的 data 注册；内层同名 item 造成遮蔽时抛出 `CompileError`
- **回归测试**: `tests/spec-conformance.test.ts` 用例 2.2b / 2.2c

✅ **Bug 修复**: 作用域插槽 kebab-case 数据名被静默丢弃

- **现象**: 父组件写 `<template #row="{ 'list-item': li }">` 时，`slot:list-item="li"` 完全不生成
- **原因**: `parseScopedSlotParams` 只读 `prop.key.name`，而字符串键（kebab-case）在 AST 中是
  `StringLiteral`，其 `name` 为 undefined，被当作无效参数跳过
- **修复**: 同时支持 `Identifier` 与 `StringLiteral` 键，并显式判断 `prop.value` 类型
- **回归测试**: `tests/spec-conformance.test.ts` 用例 4.3b

✅ **Bug 修复**: 具名作用域插槽丢失 `slot="name"`

- **现象**: `<template #row="{ item }">` 编译为 `<text slot:item>`，缺少 `slot="row"`，内容会落到默认插槽
- **原因**: `createChildWithMergedProps` 用 `if (scopedParams.length > 0) ... else if (slotName !== 'default')` 分支，作用域插槽吞掉了具名插槽属性
- **规范依据**: glass-easel 官方用例 `<div slot="abc" slot:some-text>`，两种属性必须并存
- **修复**: 具名与作用域属性改为各自独立追加
- **回归测试**: `tests/spec-conformance.test.ts` 用例 4.2 / 4.3 / 4.6

✅ **Bug 修复**: 嵌套 v-for 各级 index 重名会产出非法 JS

- **现象**: `v-for="(item, index)"` 内再写 `v-for="(child, index)"` 时生成
  `const { a: [index, index] } = e.currentTarget.dataset`，这是**语法错误**（重复声明），
  `data-a="{{[index,index]}}"` 也只能取到内层索引
- **影响**: 同时波及 `v-model` 与内联事件处理函数两条路径（后者更早存在）
- **原因**: 编译期需在同一作用域内按序解构出各级索引，而 WXML 中内层同名 index 会遮蔽外层
- **修复**: 在 `assignVForInfoListMinimal` 预扫描中检测"显式书写"的重名 index 并抛出
  `CompileError`（重命名外层会破坏外层作用域对 index 的引用，故不采用自动改名）；
  未显式命名的层级仍自动生成唯一名称（如 `_child_0_index`），并列 v-for 不受限制
- **回归测试**: `tests/spec-conformance.test.ts` 用例 2.3 / 2.4 / 2.5 / 2.6

✅ **Bug 修复**: `v-model` 非法目标静默生成错误代码（4 类）

- **现象**: 多类非法绑定目标在编译期不报错，产出无法运行的代码：
  - `v-model="'lit'"` → `__vmsProxyRefs.'lit' = ...`（语法错误）
  - `v-model="'a'.length"` / `fn().x` → 运行时报错（不可写目标）
  - `v-model="wx"` / `console` → 引用未定义的 `__vmsProxyRefs`（ReferenceError）
  - `v-model:[key]` → 静默绑定成 `key="{{a}}"`，属性名/事件名并非用户意图
- **原因**:
  1. `fallbackParse` 解析失败时返回 `t.identifier(content)`，把字面量伪装成合法标识符
  2. 成员表达式校验只检查节点类型，未校验根是否为标识符
  3. 全局变量被 `shouldSkip` 排除在 `__vmsProxyRefs` 之外，却仍允许作为写入目标
  4. 带参数分支未检查 `arg.isStatic`，动态参数取其表达式文本当属性名
- **修复**: `fallbackParse` 失败返回 `null`；新增根标识符校验、全局变量校验与 `isStatic` 校验，统一抛出 `CompileError`
- **回归测试**: `tests/v-model.test.ts` 新增 11 个用例（非法目标 4 / 非法成员 2 / 全局变量 2 / 动态参数 1 / 静态参数与合法目标 2）

✅ **P1-2**: `checkSlotsUsage` 字符串匹配改为 AST 分析

- 使用迭代式栈遍历模板 AST，精确判断 `tag === 'slot'`
- 避免 `class="slot-x"` 之类的字符串误判，同时规避深层模板递归爆栈

✅ **P2-3**: `globalWhitelist.ts` 黑名单改为白名单

- 改为 `GLOBAL_WHITELIST`，仅声明小程序运行时实际存在的全局标识符与 ECMAScript 内置对象
- 不再包含 Web / DOM / Node.js 专属 API

✅ **Bug 修复**: `wxsUtils.objectFromEntries` / `objectAssign` 丢失 `"__proto__"` 键

- **现象**: `objectFromEntries([['__proto__', 0]])` 返回 `{}`，该键被静默丢弃
- **原因**: `result[key] = value` 在 `key === '__proto__'` 时触发原型 setter，而非创建自有属性
- **影响**: `Object.fromEntries` / `Object.assign` 的 polyfill 结果与原生语义不一致，并存在原型污染风险
- **修复**: 新增 `assignKey()`，对 `"__proto__"` 使用 `Object.defineProperty` 定义自有可枚举属性（WXS 无该 API 时退化为普通赋值）
- **发现方式**: `wxs-polyfill-pbt.test.ts` 的 fast-check `dictionary` 随机生成该键（概率性失败）
- **回归测试**: 新增 2 个确定性用例覆盖 `objectFromEntries` / `objectAssign`，并断言原型未被污染

✅ **文档同步**: 复核 P1/P2 状态与代码指标

- 修正"关键数据"表（总行数 8,419 → 10,133，最大单文件更正为 `cli.ts`)
- 修正"建议修复顺序"，移除已完成的 P0/P1-1/P1-2 条目
- 明确 `cacheStats` 为未实现的预留字段，`glassEasel` 文档描述与实际行为对齐
