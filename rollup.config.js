import { defineConfig } from 'rollup'
import json from '@rollup/plugin-json' // 添加 json 插件
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
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
  plugins: [
    {
      name: 'clean-dist',
      async buildStart() {
        // 在构建开始前清理 dist 目录
        if (existsSync('dist')) {
          await rm('dist', { recursive: true, force: true })
        }
        // 确保 dist 目录存在
        await mkdir('dist', { recursive: true })
      },
    },
    json(),
    resolve({
      extensions: ['.ts', '.js'],
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      compilerOptions: {
        allowImportingTsExtensions: false,
      },
    }),
    {
      name: 'copy-macro-dts-and-polyfill',
      async writeBundle() {
        // 确保 dist 目录存在
        if (!existsSync('dist')) {
          await mkdir('dist', { recursive: true })
        }

        // 只复制 macro.d.ts 文件
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
  external: externalDependencies,
})
