// 从用户配置文件加载配置
import { UserConfig } from '@/types/build'
import { resolve as pathResolve } from 'node:path'
import fs from 'fs-extra'
import { pathToFileURL } from 'node:url'
import { getErrorMessage } from '@/utils/errorHandler'

export async function loadUserConfig(): Promise<UserConfig> {
  const configFiles = ['vms.config.js', 'vms.config.mjs']
  for (const configFile of configFiles) {
    const configPath = pathResolve(configFile)
    if (fs.existsSync(configPath)) {
      try {
        // 使用 pathToFileURL 确保路径是有效的 file:// URL
        const configUrl = pathToFileURL(configPath).href
        const config = await import(configUrl)
        return config.default || config.config
      } catch (error: unknown) {
        console.warn(`配置文件 ${configFile} 加载失败:`, getErrorMessage(error))
      }
    }
  }
  return Promise.reject('未找到配置文件')
}
