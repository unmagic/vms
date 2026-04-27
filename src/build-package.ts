import { transformAsync, transformFileAsync } from '@babel/core'
import { bold, green } from 'kolorist'
import fs from 'fs-extra'
import path from 'node:path'
import { performance } from 'perf_hooks'
import config from './babel.config'
import { transformVueToMiniProgram } from './transformer'

export async function buildPackage() {
  const cwd = process.cwd()
  const packageJsonPath = path.join(cwd, 'package.json')

  if (!(await fs.pathExists(packageJsonPath))) {
    console.error('❌ 当前目录下未找到 package.json，请在组件包根目录下执行此命令')
    process.exit(1)
  }

  const packageJson = await fs.readJson(packageJsonPath)
  const sourceDir = path.join(cwd, 'src')
  const outputDir = path.join(cwd, 'dist')

  if (!(await fs.pathExists(sourceDir))) {
    console.error('❌ 当前目录下未找到 src/ 目录')
    process.exit(1)
  }

  // 清空 dist
  await fs.remove(outputDir)
  await fs.ensureDir(outputDir)

  console.log(bold(green(`开始构建组件包 ${packageJson.name}...`)))

  // 递归编译
  const compileDir = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(sourceDir, fullPath)
      const outputPath = path.join(outputDir, relativePath)

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        await fs.ensureDir(outputPath)
        await compileDir(fullPath)
        continue
      }

      if (entry.name.endsWith('.vue')) {
        const t = performance.now()
        await transformVueToMiniProgram(
          fullPath,
          outputDir,
          false,
          async (generatedCode) => {
            const result = await transformAsync(generatedCode, {
              filename: fullPath.replace('.vue', '.js'),
              ...config,
            })
            return result?.code ?? generatedCode
          },
          sourceDir,
        )
        console.log(bold(green(`✓ ${relativePath} (${(performance.now() - t).toFixed(0)}ms)`)))
      } else if (entry.name.endsWith('.ts')) {
        const result = await transformFileAsync(fullPath, { ast: false, ...config })
        if (result?.code) {
          await fs.writeFile(outputPath.replace(/\.ts$/, '.js'), result.code)
        }
      } else if (entry.name.endsWith('.js')) {
        const result = await transformFileAsync(fullPath, { ast: false, ...config })
        if (result?.code) {
          await fs.writeFile(outputPath, result.code)
        }
      } else {
        await fs.copy(fullPath, outputPath)
      }
    }
  }

  await compileDir(sourceDir)
  console.log(bold(green(`构建完成，输出到 ${outputDir}`)))
}
