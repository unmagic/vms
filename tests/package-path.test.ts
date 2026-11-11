import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { findOwningIndependentPackage, isPathInside } from '../src/utils/packagePath'

/**
 * 独立分包路径归属判断原先内联在 cli.ts 的 dealScriptCode 中，无测试覆盖。
 * 它决定源文件引用的 npm 依赖要复制到哪个分包的 miniprogram_npm 下，
 * 判断错误会把依赖写错位置。
 */

describe('isPathInside', () => {
  it('1.1 子路径返回 true', () => {
    expect(isPathInside(`src/subLock/a.ts`, `src/subLock`)).toBe(true)
  })

  it('1.2 路径完全相等返回 true', () => {
    expect(isPathInside('src/subLock', 'src/subLock')).toBe(true)
  })

  it('1.3 无共同前缀返回 false', () => {
    expect(isPathInside('src/other/a.ts', 'src/subLock')).toBe(false)
  })

  // 回归：旧实现用裸 startsWith，导致同前缀分包被误判：
  //   src/subLock2/a.ts 会被当作属于 src/subLock
  it('1.4 同前缀的兄弟目录（subLock2）返回 false', () => {
    expect(isPathInside(`src/subLock2/a.ts`, `src/subLock`)).toBe(false)
  })

  it('1.5 同前缀目录（subLockExtra）返回 false', () => {
    expect(isPathInside(`src/subLockExtra/a.ts`, `src/subLock`)).toBe(false)
  })

  it('1.6 rootDir 带结尾分隔符时行为一致', () => {
    const root = `src/subLock${path.sep}`
    expect(isPathInside(`src/subLock/a.ts`, root)).toBe(true)
    expect(isPathInside(`src/subLock2/a.ts`, root)).toBe(false)
  })
})

describe('findOwningIndependentPackage', () => {
  const packages = ['subLock', 'subCost']

  it('2.1 命中对应分包', () => {
    expect(findOwningIndependentPackage('src/subLock/pages/a.ts', 'src', packages)).toBe('subLock')
    expect(findOwningIndependentPackage('src/subCost/pages/a.ts', 'src', packages)).toBe('subCost')
  })

  it('2.2 主包文件不属于任何独立分包', () => {
    expect(findOwningIndependentPackage('src/pages/a.ts', 'src', packages)).toBeUndefined()
  })

  // 回归：subLock2 曾因前缀匹配过宽被误判为 subLock，
  // 导致其依赖被复制到 subLock 分包目录。
  it('2.3 同前缀分包名不被误归属', () => {
    expect(findOwningIndependentPackage('src/subLock2/pages/a.ts', 'src', packages)).toBeUndefined()
  })

  it('2.4 空分包列表返回 undefined', () => {
    expect(findOwningIndependentPackage('src/subLock/a.ts', 'src', [])).toBeUndefined()
  })

  it('2.5 深层嵌套文件正确归属', () => {
    expect(findOwningIndependentPackage('src/subLock/a/b/c/d.ts', 'src', packages)).toBe('subLock')
  })
})
