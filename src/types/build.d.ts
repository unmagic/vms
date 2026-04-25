export interface InputOptions {
  mode: 'development' | 'production'
  upload: boolean
}

// 组件匹配配置接口
export interface ComponentMatchConfig {
  // 前缀匹配配置
  prefix?: string
  pathPrefix?: string

  // 严格匹配配置
  match?: Array<{
    name: string
    path: string
  }>
}

// 添加类型声明
export interface UserConfig {
  wx: {
    appid: string
    privateKeyPath: string
    name: string
    email: string
    version: string
    description: string
  }
  alias?: {
    '@': string
  }
  sourceDir?: string
  outputDir?: string
  component?: ComponentMatchConfig
  /** 是否启用缓存统计，默认 false。开启后可通过 globalCacheStats.generateReport() 查看统计报告，但会带来额外性能开销 */
  cacheStats?: boolean
  /**
   * 跳过 Babel 编译、直接复制的文件匹配规则（字符串包含匹配）
   * 适用于已压缩的第三方 JS 库（如 echarts、big.js 等）
   * 例如：['utils/big.js', 'ec-canvas/']
   */
  copyOnly?: string[]
}
