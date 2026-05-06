# VMS 项目优化点清单

> 本文档记录 VMS (Vue Mini Program SFC) 项目的待优化问题和改进建议。
> 最后更新：2026-05-05（修复 P0-1/P0-2/P0-3）

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
- **状态**: 📋 待拆分

### P1-2: `checkSlotsUsage` 使用字符串搜索

- **位置**: `src/script/index.ts:22-28`
- **问题**: 使用 `includes('slot')` 或 `includes('Slot')` 进行字符串匹配，可能误判
- **示例**: 如果模板中有 `<slot>` 以外的包含 "slot" 的字符串（如注释、动态内容），会误判
- **建议**: 使用 Vue 编译器生成的 AST 检查是否有 slot 节点
- **状态**: 📋 待优化

```typescript
// 当前实现
function checkSlotsUsage(templateContent: string | undefined): boolean {
  if (!templateContent) return false
  return templateContent.includes('slot') || templateContent.includes('Slot')
}

// 建议：使用 AST 分析
function checkSlotsUsage(templateAST: RootNode | undefined): boolean {
  if (!templateAST) return false
  // 遍历 AST 查找 slot 节点
  let hasSlot = false
  traverse(templateAST, {
    ElementNode(node) {
      if (node.tag === 'slot' || node.tag.includes('slot')) {
        hasSlot = true
      }
    },
  })
  return hasSlot
}
```

### P1-3: `as any` 类型断言仍有 26 处

- **位置**: 分散在多个文件中
  - `src/template/index.ts`: 5 处
  - `src/template/tools.ts`: 8 处
  - `src/utils/tools.ts`: 4 处
  - 其他文件: 9 处
- **问题**: 过度使用 `as any` 会失去 TypeScript 的类型保护
- **建议**: 逐步用正确类型替换，特别是工具函数中的返回值类型
- **状态**: 🔄 进行中（从 87 处降到 26 处）

### P1-4: `ensureCoreImport` 重复遍历 importAST

- **位置**: `src/script/index.ts:34-65`
- **问题**: 第一次遍历检查是否存在，第二次遍历查找现有导入，可能重复扫描
- **建议**: 合并为单次遍历
- **状态**: 📋 待优化

### P1-5: `scopeAnalyzer.ts` 中多个查询函数模式重复

- **位置**: `src/script/scopeAnalyzer.ts:261-277`
- **问题**: `isPropsVariable`、`isMacroVariable`、`isImportVariable`、`isGlobalVariableInScope` 函数模式相似
- **建议**: 可以合并为一个通用的查询函数，或统一返回变量的完整信息
- **状态**: 📋 待优化

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
- **状态**: 📋 设计讨论

### P2-4: 错误恢复使用默认 AST

- **位置**: `src/script/index.ts:86-98`
- **问题**: 当 Babel 解析失败时，生成一个空的 AST 继续运行，可能导致后续错误难以追踪
- **建议**: 考虑是否应该直接抛出错误，或在错误恢复时添加更明显的警告
- **状态**: 📋 设计讨论

### P2-5: `as any` 类型断言（详细列表）

- **位置**: 各文件
- **说明**: 以下是具体的 `as any` 使用位置（共 26 处）

| 文件                               | 行数   | 主要位置                          |
| ---------------------------------- | ------ | --------------------------------- |
| `src/template/index.ts`            | 5      | getCodegenNode、setCodegenNode 等 |
| `src/template/nodeProps/clazz.ts`  | 2      | style 处理                        |
| `src/template/nodeProps/slot.ts`   | 1      | slot 处理                         |
| `src/template/propTransformers.ts` | 2      | 属性转换                          |
| `src/template/tools.ts`            | 8      | codegenNode 操作                  |
| `src/utils/babelTraverse.ts`       | 1      | traverse 封装                     |
| `src/utils/errorHandler.ts`        | 2      | 错误处理                          |
| `src/utils/tools.ts`               | 4      | 工具函数                          |
| **合计**                           | **26** |                                   |

---

## 已解决的问题

| 编号          | 描述                                        | 解决方案                      |
| ------------- | ------------------------------------------- | ----------------------------- |
| ~~P0-1 (旧)~~ | `replacePropsAccessInFunction` 手写遍历 AST | 已使用 `VISITOR_KEYS` 优化    |
| ~~P1-4 (旧)~~ | `batchProcess` 不是真并发池                 | 已使用 `Promise.all` 分批处理 |
| ~~清理~~      | `as any` 从 87 处降到 26 处                 | 逐步替换为正确类型            |

---

## 关键数据

| 指标            | 数值                                  |
| --------------- | ------------------------------------- |
| 总代码行数      | 8,419 行                              |
| 最大单文件      | `eventProcessor.ts` (1,341 行)        |
| `as any` 数量   | 26 处                                 |
| 全局缓存 Map    | 2 个（pageComponentCache、pathCache） |
| 缓存一致性问题  | ✅ 已修复（P0-1/P0-2）                |
| P0-3 默认值处理 | ✅ 已在 `macro/props.ts` 中处理       |
| 待优化 P1 问题  | 5 个                                  |
| 技术债 P2 问题  | 5 个                                  |

---

## 建议修复顺序

1. **优先级 1**: P0-1/P0-2 - 内存泄漏（影响 dev 模式稳定性）
2. **优先级 2**: P0-3 - defineProps 默认值处理（影响实际使用）
3. **优先级 3**: P1-2 - `checkSlotsUsage` 改 AST 分析（提升准确性）
4. **优先级 4**: P1-1 - 拆分大文件（提升可维护性）
5. **优先级 5**: P2 系列 - 逐步清理技术债

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
