# 0.2.0 (2026-11-11)

### 新特性

- 新增微信小程序分享、滚动 API 的自动配置：在 `<script setup lang="ts">` 顶层直接调用从 `@unmagic/vue-mini` 导入的 `onPageScroll` / `onShareAppMessage` / `onShareTimeline` 时，编译期自动向 `defineComponent` 的第二个参数分别注入 `listenPageScroll: true` / `canShareToOthers: true` / `canShareToTimeline: true`
- 页面 API 的识别仅覆盖当前 script 顶层的直接调用；函数体、条件分支、回调等嵌套调用不会自动注入

### 其它

- 移除不再需要的 `.npmrc` 配置

# 0.1.0 (2026-05-11)

### 依赖

- 替换rollup为rolldown
- 使用正则精确匹配 node_modules 和 .git 目录路径，避免误判
- 修复并发任务启动逻辑，错误发生时标记状态阻止新任务启动
- 调整输出路径的缓存替换，确保只替换 sourceDir 前缀
- 修复监听文件处理时 pending 文件队列逻辑，正确获取并处理下一个待处理文件

# 0.0.2 (2026-04-25)

### 依赖

- 更新README.md

# 0.0.1 (2026-04-24)

### 依赖

- 首次发布。
