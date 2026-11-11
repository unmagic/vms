import { describe, it, expect } from 'vitest'
import { ComponentMatcher } from '../src/utils/componentMatcher'

/**
 * 第三方组件前缀匹配（如 t-button → tdesign-miniprogram/button/button）。
 * 该逻辑此前无测试覆盖，且存在"标签名恰好等于前缀"的边界情况。
 */

describe('ComponentMatcher', () => {
  describe('前缀匹配', () => {
    it('1.1 正常前缀组件映射到 pathPrefix/name/name', () => {
      const matcher = new ComponentMatcher({ prefix: 't-', pathPrefix: 'tdesign-miniprogram' })
      expect(matcher.match('t-button')).toBe('tdesign-miniprogram/button/button')
      expect(matcher.match('t-icon')).toBe('tdesign-miniprogram/icon/icon')
    })

    it('1.2 不匹配的组件名返回 null', () => {
      const matcher = new ComponentMatcher({ prefix: 't-', pathPrefix: 'tdesign-miniprogram' })
      expect(matcher.match('button')).toBeNull()
      expect(matcher.match('tdesign')).toBeNull()
    })

    // 回归：组件名恰好等于前缀时，旧实现会生成 'tdesign-miniprogram//'
    // 这种畸形路径（空组件名），不应被当作有效匹配。
    it('1.3 组件名恰好等于前缀时不匹配', () => {
      const matcher = new ComponentMatcher({ prefix: 't-', pathPrefix: 'tdesign-miniprogram' })
      expect(matcher.match('t-')).toBeNull()
    })

    it('1.4 前缀后为空白的组件名不匹配', () => {
      const matcher = new ComponentMatcher({ prefix: 't-', pathPrefix: 'tdesign-miniprogram' })
      expect(matcher.match('t- ')).not.toBe('tdesign-miniprogram/ / ')
      expect(matcher.match('t-  ')).toBeNull()
    })
  })

  describe('精确匹配', () => {
    it('2.1 match 配置优先于前缀匹配', () => {
      const matcher = new ComponentMatcher({
        prefix: 't-',
        pathPrefix: 'tdesign-miniprogram',
        match: [{ name: 't-button', path: '/custom/Button' }],
      })
      expect(matcher.match('t-button')).toBe('/custom/Button')
    })

    it('2.2 仅配置 match 时也能工作', () => {
      const matcher = new ComponentMatcher({
        match: [{ name: 'AppCharts', path: '/components/AppCharts' }],
      })
      expect(matcher.match('AppCharts')).toBe('/components/AppCharts')
      expect(matcher.match('Other')).toBeNull()
    })
  })

  describe('配置校验', () => {
    it('3.1 只给 prefix 不给 pathPrefix 时报错', () => {
      expect(() => new ComponentMatcher({ prefix: 't-' })).toThrow()
    })

    it('3.2 只给 pathPrefix 不给 prefix 时报错', () => {
      expect(() => new ComponentMatcher({ pathPrefix: 'tdesign-miniprogram' })).toThrow()
    })

    it('3.3 无配置时 hasConfig 为 false 且 match 返回 null', () => {
      const matcher = new ComponentMatcher()
      expect(matcher.hasConfig()).toBe(false)
      expect(matcher.match('t-button')).toBeNull()
    })

    it('3.4 有配置时 hasConfig 为 true', () => {
      const matcher = new ComponentMatcher({ prefix: 't-', pathPrefix: 'tdesign-miniprogram' })
      expect(matcher.hasConfig()).toBe(true)
    })
  })
})
