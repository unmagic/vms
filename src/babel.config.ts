import pk from '@babel/runtime/package.json'

const runtimeVersion = pk.version

// 微信小程序环境支持的最低版本
// 基于微信小程序官方文档的 JavaScript 支持情况
const miniProgramTargets = {
  // 微信小程序基础库 2.19.0+ 支持 ES2018
  // 但为了兼容性，我们针对 ES2016 进行转换
  chrome: '60',
  ios: '10',
}

const config = {
  targets: miniProgramTargets,
  assumptions: {
    // arrayLikeIsIterable: true,
    constantReexports: true,
    constantSuper: true,
    enumerableModuleMeta: true,
    ignoreFunctionLength: true,
    ignoreToPrimitiveHint: true,
    // iterableIsArray: true,
    mutableTemplateObject: true,
    noClassCalls: true,
    noDocumentAll: true,
    noNewArrows: true,
    objectRestNoSymbols: true,
    privateFieldsAsProperties: true,
    pureGetters: true,
    setClassMethods: true,
    setComputedProperties: true,
    setPublicClassFields: true,
    setSpreadProperties: true,
    skipForOfIteratorClosing: true,
    superIsCallableConstructor: true,
  },
  presets: [
    [
      '@babel/preset-env',
      {
        bugfixes: true,
        modules: 'commonjs',
        // 根据小程序环境调整转换目标，减少不必要的转换
        exclude: [
          '@babel/plugin-transform-shorthand-properties',
          // 小程序环境已原生支持，无需转换
          '@babel/plugin-transform-arrow-functions',
          '@babel/plugin-transform-template-literals',
          '@babel/plugin-transform-spread',
          '@babel/plugin-transform-destructuring',
          '@babel/plugin-transform-parameters',
          '@babel/plugin-transform-for-of',
        ],
      },
    ],
    [
      '@babel/preset-typescript',
      {
        allowNamespaces: true,
        allowDeclareFields: true,
        optimizeConstEnums: true,
        allExtensions: true,
        isTSX: true,
      },
    ],
  ],
  plugins: [
    [
      '@babel/plugin-transform-runtime',
      {
        version: runtimeVersion,
      },
    ],
    'transform-inline-environment-variables',
    [
      'module-resolver',
      {
        alias: {
          '@': './src',
        },
      },
    ],
    'autocomplete-index',
  ],
}

export default config
