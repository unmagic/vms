/**
 * VMS (Vue Mini Program SFC) 配置文件
 *
 * 该配置文件用于配置构建工具的行为
 */
export const config = {
  wx: {
    appid: 'wx123456',
    privateKeyPath: '',
    name: '测试小程序',
    email: 'gh_12345678',
    version: '1.0.0',
    description: '测试小程序描述',
  },
  component: {
    prefix: 't-',
    pathPrefix: 'tdesign-miniprogram',
    match: [{ name: 'AppCharts', path: '/components/AppCharts/AppCharts' }],
  },
  // 源代码目录，默认为 'src'
  sourceDir: 'src',

  // 输出目录，默认为 'dist'
  outputDir: 'dist',

  // 路径别名配置
  alias: {
    // 设置 @/ 路径对应的目录，默认为 './src/'
    '@/': './src/',
  },

  // 跳过 Babel 编译、直接复制的文件匹配规则（字符串包含匹配）
  // 适用于已压缩或无需转译的第三方 JS 文件
  copyOnly: [],
}
