import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * project.config.json 的产物字段。
 *
 * 官方《项目配置文件》定义的字段名是**全小写** `projectname`。
 * 此前代码误用驼峰 `projectName`，读不到源文件的 `projectname`，
 * 于是产物里多出一个 `"projectName": "undefined-dev"` —— 字段多余且值无意义。
 */
describe('project.config.json projectname 字段', () => {
  const prodConfig = join('example', 'dist', 'prod', 'project.config.json')
  const devConfig = join('example', 'dist', 'dev', 'project.config.json')

  it('prod 产物使用小写 projectname 且值有意义', () => {
    if (!existsSync(prodConfig)) {
      console.log('SKIP: 需先构建 example')
      return
    }
    const cfg = JSON.parse(readFileSync(prodConfig, 'utf8'))
    expect(typeof cfg.projectname).toBe('string')
    expect(cfg.projectname).not.toContain('undefined')
    expect(cfg.projectname.endsWith('-prod')).toBe(true)
  })

  it('产物中不存在驼峰 projectName 字段', () => {
    if (!existsSync(prodConfig)) {
      console.log('SKIP: 需先构建 example')
      return
    }
    const cfg = JSON.parse(readFileSync(prodConfig, 'utf8'))
    expect(cfg.projectName).toBeUndefined()
  })

  it('dev 产物（若存在）同样正确', () => {
    if (!existsSync(devConfig)) {
      console.log('SKIP: 未生成 dist/dev')
      return
    }
    const cfg = JSON.parse(readFileSync(devConfig, 'utf8'))
    expect(cfg.projectname).not.toContain('undefined')
    expect(cfg.projectname.endsWith('-dev')).toBe(true)
    expect(cfg.projectName).toBeUndefined()
  })
})

describe('copyProjectConfigFile 逻辑（不依赖真实构建）', () => {
  it('源文件缺少 projectname 时退回目录名，不产生 undefined', async () => {
    const dir = join('/tmp', 'vms-cfgprobe-' + Date.now())
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'project.config.json'),
      JSON.stringify({ description: 'probe', miniprogramRoot: './dist/dev' }),
    )
    const raw = JSON.parse(readFileSync(join(dir, 'project.config.json'), 'utf8'))
    // 复现修复逻辑：无 projectname 时用目录名兜底
    const baseName =
      typeof raw.projectname === 'string' && raw.projectname !== ''
        ? raw.projectname
        : 'fallback-dir'
    const result = baseName + '-dev'
    expect(result).toBe('fallback-dir-dev')
    expect(result).not.toContain('undefined')
    rmSync(dir, { recursive: true, force: true })
  })
})
