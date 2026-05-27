import type { InputOptions } from '@/types/build'
import dotenv from 'dotenv-flow'

export async function runVMS(options: InputOptions) {
  // 加载对应 mode 的 .env 文件（.env.production / .env.development），注入 APP_BASE_URL 等业务变量
  dotenv.config({ node_env: options.mode })
  // dotenv-flow 不会自动设置 process.env.NODE_ENV（它只是按 node_env 选择加载哪个文件）
  // 但 constants.ts 中 __IS_PROD__ 依赖它，必须在动态 import 前显式设置
  process.env.NODE_ENV = options.mode
  const { dev, prod } = await import('@/cli')
  if (options.mode === 'production') {
    return prod(options)
  } else {
    return dev()
  }
}
// 运行主函数，在构建时移除该函数

/*#__PURE__*/
runVMS({
  mode: 'development',
  upload: false,
})
