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
  /** 预留：缓存统计开关。当前版本尚未实现，设置该字段不会产生任何效果 */
  cacheStats?: boolean
  /**
   * 跳过 Babel 编译、直接复制的文件匹配规则（字符串包含匹配）
   * 适用于已压缩的第三方 JS 库（如 echarts、big.js 等）
   * 例如：['utils/big.js', 'ec-canvas/']
   */
  copyOnly?: string[]
  /**
   * 启用 glass-easel 组件框架（小程序基础库 >= 3.8.12）。
   * 开启后会在每个组件 JSON 中写入 componentFramework: 'glass-easel' 与
   * glassEaselWebview: true；作用域插槽的 dynamicSlots 能力依赖该开关。
   */
  glassEasel?: boolean
}
