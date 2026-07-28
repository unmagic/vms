import { runVMS } from '@/index'

// 本地开发入口（例如 example 中通过 tsx ../src/dev-entry.ts 启动），
// 与库入口 index.ts 分离，避免依赖打包器 treeshake 移除顶层调用
runVMS({
  mode: 'development',
  upload: false,
}).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
