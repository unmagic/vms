import { defineConfig } from 'rolldown'
import { replacePlugin } from 'rolldown/plugins'
import { copyFile, mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import pkg from './package.json' with { type: 'json' }
import fsExtra from 'fs-extra'

const { copy, stat } = fsExtra

const externalDependencies = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  'node:path',
  'node:process',
  'node:fs',
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
  external: externalDependencies,
  treeshake: true,
  plugins: [
    // builtin:replace — Rust 实现，替代 @rollup/plugin-replace
    replacePlugin(
      {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      },
      { preventAssignment: true },
    ),
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
