import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { loadUserConfig } from '@/utils/configLoader'
import { ComponentMatcher } from '@/utils/componentMatcher'

export const __IS_PROD__ = process.env.NODE_ENV === 'production'

const userConfig = await loadUserConfig()
if (!userConfig.wx) {
  throw new Error('请在vms.config.*s中配置完整的wx')
}
process.env.APP_VERSION = userConfig.wx.version
if (!userConfig.sourceDir) {
  userConfig.sourceDir = 'src'
}
if (!userConfig.outputDir) {
  userConfig.outputDir = 'dist'
}

export const OUTPUT_DIR = path.resolve(userConfig.outputDir as string, __IS_PROD__ ? 'prod' : 'dev')
export const POLYFILL_OUTPUT_DIR = path.resolve(OUTPUT_DIR, 'polyfill')

// 创建全局组件匹配器实例
export const getComponentMatcher = new ComponentMatcher(userConfig.component)

function findPolyfillDirectory(baseDir: string): string {
  // 首先尝试生产环境路径
  let polyfillPath = path.resolve(baseDir, 'polyfill')
  if (fs.existsSync(polyfillPath)) {
    return polyfillPath
  }
  // 如果生产环境路径不存在，尝试开发环境路径
  polyfillPath = path.resolve(baseDir, '../../polyfill')
  if (fs.existsSync(polyfillPath)) {
    return polyfillPath
  }
  // 如果都不存在，抛出错误
  throw new Error('找不到Polyfill文件夹')
}

export const POLYFILL_VMS_DIR = findPolyfillDirectory(path.dirname(fileURLToPath(import.meta.url)))

export const VMS_FIXED_TAG_PREFIX = '_vms_'

export const WX_TAG_MAP = new Map([
  ['div', 'view'],
  ['img', 'image'],
  ['template', 'block'],
])

export const WXS_NAMESPACE = 'wms_wxs'
export { userConfig }
