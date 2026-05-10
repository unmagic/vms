// 从用户配置文件加载配置
import { UserConfig } from '@/types/build'
import { resolve as pathResolve } from 'node:path'
import fs from 'fs-extra'
import { pathToFileURL } from 'node:url'
import { getErrorMessage } from '@/utils/errorHandler'

export async function loadUserConfig(): Promise<UserConfig> {
  const configFiles = ['vms.config.js', 'vms.config.ts', 'vms.config.mjs']
  for (const configFile of configFiles) {
    const configPath = pathResolve(configFile)
    if (fs.existsSync(configPath)) {
      try {
        // 对于 TS 文件，需要特殊处理
        // if (configFile.endsWith('.ts')) {
        //   // 使用Babel将TypeScript文件转译为JavaScript
        //   const result = await transformAsync(
        //     fs.readFileSync(configPath, 'utf-8'),
        //     {
        //       filename: configPath,
        //       presets: [
        //         ['@babel/preset-env', { targets: { node: 'current' } }],
        //         '@babel/preset-typescript',
        //       ],
        //     },
        //   )
        //
        //   if (result && result.code) {
        //     // 创建临时文件并导入
        //     const tempPath = configPath.replace('.ts', '.temp.cjs')
        //     fs.writeFileSync(tempPath, result.code)
        //     try {
        //       const config = await import(tempPath)
        //       // 清理临时文件
        //       fs.unlinkSync(tempPath)
        //       return config.default.default || config.config
        //     } catch (importError) {
        //       // 清理临时文件
        //       fs.unlinkSync(tempPath)
        //       throw importError
        //     }
        //   } else {
        //     throw new Error('TypeScript转译失败')
        //   }
        // } else {
        // 对于 JS/MJS 文件，直接导入
        // 使用 pathToFileURL 确保路径是有效的 file:// URL
        const configUrl = pathToFileURL(configPath).href
        const config = await import(configUrl)
        return config.default || config.config
        // }
      } catch (error: unknown) {
        console.warn(`配置文件 ${configFile} 加载失败:`, getErrorMessage(error))
      }
    }
  }
  return Promise.reject('未找到配置文件')
}
