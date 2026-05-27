import { existsSync } from 'fs'
import fsExtra from 'fs-extra'
import { copyFile, mkdir, rm } from 'fs/promises'
import { defineConfig } from 'rolldown'
import pkg from './package.json' with { type: 'json' }

const { copy, stat } = fsExtra

const externalDependencies = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  'node:path',
  'node:process',
  'node:fs',
  'node:fs/promises',
  'node:crypto',
  'node:os',
  'node:module',
  'perf_hooks',
  'node:url',
  /\.node$/,
]

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    dir: 'dist',
  },
  // Rolldown 原生支持混合 ESM/CJS 模块图，无需 commonjs 插件
  // Rolldown 基于 TypeScript 和 Node.js 行为原生解析模块，无需 node-resolve 插件
  // Rolldown 原生支持 JSON 导入（作为内置模块类型），无需 json 插件
  // TypeScript 转换由 Babel 处理（babel.config.ts），Rolldown 仅负责打包
  // Rolldown 内置 treeshake（默认开启），比 Rollup 更激进
  external: (id) => {
    return externalDependencies.some((ext) => {
      if (typeof ext === 'string') return id === ext || id.startsWith(ext + '/')
      if (ext instanceof RegExp) return ext.test(id)
      return false
    })
  },
  treeshake: true,
  // 阻止 rolldown 在构建时常量折叠 process.env.NODE_ENV
  // 该值由 runVMS() 在运行时通过动态 import 前设置，构建时不应替换
  transform: {
    define: {
      'process.env.NODE_ENV': 'process.env.NODE_ENV',
    },
  },
  plugins: [
    {
      name: 'clean-dist',
      async buildStart() {
        if (existsSync('dist')) {
          await rm('dist', { recursive: true, force: true })
        }
        await mkdir('dist', { recursive: true })
      },
    },
    {
      name: 'copy-macro-dts-and-polyfill',
      async writeBundle() {
        if (!existsSync('dist')) {
          await mkdir('dist', { recursive: true })
        }

        // 复制 macro.d.ts 文件
        await copyFile('src/macro.d.ts', 'dist/macro.d.ts')

        // 复制 polyfill 目录
        try {
          const polyfillExists = await stat('polyfill')
          if (polyfillExists.isDirectory()) {
            await copy('polyfill', 'dist/polyfill')
          }
        } catch (error) {
          console.warn('Failed to copy polyfill directory:', error.message)
        }
      },
    },
  ],
})
