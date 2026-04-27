import type { InputOptions } from '@/types/build'
import dotenv from 'dotenv-flow'

export async function runVMS(options: InputOptions) {
  dotenv.config({ node_env: options.mode })
  const { dev, prod } = await import('@/cli')
  if (options.mode === 'production') {
    return prod(options)
  } else {
    return dev()
  }
}

export async function runBuildPackage() {
  const { buildPackage } = await import('@/build-package')
  return buildPackage()
}

// 运行主函数，在构建时移除该函数

/*#__PURE__*/
runVMS({
  mode: 'development',
  upload: false,
})
