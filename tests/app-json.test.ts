import { describe, it, expect } from 'vitest'
import {
  collectIndependentPackages,
  collectPagePaths,
  getSubPackages,
  normalizePagePath,
  type AppJson,
} from '../src/utils/appJson'

/**
 * appJson 工具原先内联在 cli.ts 中且无测试覆盖。
 * 这部分决定"哪些文件是页面组件"与"哪些分包是独立分包"，
 * 历史上出现过缓存一致性问题（P0-1/P0-2），故补齐解析层测试。
 */

describe('getSubPackages', () => {
  it('1.1 读取官方驼峰写法 subPackages', () => {
    const appJson: AppJson = { subPackages: [{ root: 'a', pages: ['p'] }] }
    expect(getSubPackages(appJson)).toHaveLength(1)
    expect(getSubPackages(appJson)[0].root).toBe('a')
  })

  it('1.2 兼容小写别名 subpackages', () => {
    const appJson: AppJson = { subpackages: [{ root: 'b', pages: ['p'] }] }
    expect(getSubPackages(appJson)).toHaveLength(1)
    expect(getSubPackages(appJson)[0].root).toBe('b')
  })

  it('1.3 两者都缺失时返回空数组', () => {
    expect(getSubPackages({})).toEqual([])
  })

  it('1.4 驼峰优先于小写别名', () => {
    const appJson: AppJson = {
      subPackages: [{ root: 'camel', pages: [] }],
      subpackages: [{ root: 'lower', pages: [] }],
    }
    expect(getSubPackages(appJson)[0].root).toBe('camel')
  })
})

describe('collectPagePaths', () => {
  it('2.1 主包页面路径原样保留', () => {
    const paths = collectPagePaths({ pages: ['pages/index/Index', 'pages/my/My'] })
    expect([...paths]).toEqual(['pages/index/Index', 'pages/my/My'])
  })

  it('2.2 分包页面路径拼接 root（驼峰写法）', () => {
    const paths = collectPagePaths({
      pages: ['pages/index/Index'],
      subPackages: [{ root: 'subHome', pages: ['pages/home/Home', 'pages/bill/Bill'] }],
    })
    expect(paths.has('subHome/pages/home/Home')).toBe(true)
    expect(paths.has('subHome/pages/bill/Bill')).toBe(true)
    expect(paths.has('pages/index/Index')).toBe(true)
  })

  it('2.3 分包页面路径拼接 root（小写别名）', () => {
    const paths = collectPagePaths({
      subpackages: [{ root: 'subMy', pages: ['pages/my/My'] }],
    })
    expect(paths.has('subMy/pages/my/My')).toBe(true)
  })

  it('2.4 空配置返回空集合', () => {
    expect(collectPagePaths({}).size).toBe(0)
  })

  it('2.5 重复路径自动去重', () => {
    const paths = collectPagePaths({ pages: ['a', 'a'] })
    expect(paths.size).toBe(1)
  })
})

describe('collectIndependentPackages', () => {
  // 回归：该函数原先只读 appJson.subpackages（小写），
  // 而微信官方 app.json 使用驼峰 subPackages，导致独立分包永远识别不到，
  // 其 miniprogram_npm 依赖不会被复制，产物缺依赖。
  it('3.1 识别驼峰 subPackages 中的独立分包', () => {
    const appJson: AppJson = {
      subPackages: [
        { root: 'subA', pages: [], independent: true },
        { root: 'subB', pages: [] },
      ],
    }
    expect(collectIndependentPackages(appJson)).toEqual(['subA'])
  })

  it('3.2 识别小写别名中的独立分包', () => {
    const appJson: AppJson = {
      subpackages: [{ root: 'subC', pages: [], independent: true }],
    }
    expect(collectIndependentPackages(appJson)).toEqual(['subC'])
  })

  it('3.3 无独立分包时返回空数组', () => {
    const appJson: AppJson = {
      subPackages: [{ root: 'subA', pages: [] }],
    }
    expect(collectIndependentPackages(appJson)).toEqual([])
  })
})

describe('normalizePagePath', () => {
  it('4.1 去掉 sourceDir 前缀与 .vue 后缀', () => {
    const result = normalizePagePath('/proj/src', '/proj/src/pages/index/Index.vue')
    expect(result).toBe('pages/index/Index')
  })

  it('4.2 分包页面同样归一化', () => {
    const result = normalizePagePath('/proj/src', '/proj/src/subHome/pages/home/Home.vue')
    expect(result).toBe('subHome/pages/home/Home')
  })

  it('4.3 非 .vue 文件保留原扩展名', () => {
    const result = normalizePagePath('/proj/src', '/proj/src/pages/index/Index.ts')
    expect(result).toBe('pages/index/Index.ts')
  })
})
