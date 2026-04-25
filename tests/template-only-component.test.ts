import { describe, it, expect } from 'vitest'
import { compileVueContent } from './test-utils'

describe('纯模板组件编译测试', () => {
  it('应该编译只有 template 的组件', async () => {
    const vueContent = `
<template>
  <view class="container">
    <text>纯模板组件</text>
  </view>
</template>
`
    const result = await compileVueContent(vueContent)

    expect(result.error).toBeNull()
    expect(result.wxml).toContain('纯模板组件')
    expect(result.wxml).toContain('container')
    expect(result.js).toContain('defineComponent')
    expect(result.js).toContain('@vue-mini/core')
  })

  it('应该编译带静态内容的纯模板组件', async () => {
    const vueContent = `
<template>
  <view class="static-component">
    <image src="/static/logo.png" />
    <text>静态内容</text>
  </view>
</template>
`
    const result = await compileVueContent(vueContent)

    expect(result.error).toBeNull()
    expect(result.wxml).toContain('static-component')
    expect(result.wxml).toContain('/static/logo.png')
    expect(result.js).toContain('defineComponent')
  })

  it('应该编译带嵌套元素的纯模板组件', async () => {
    const vueContent = `
<template>
  <view class="wrapper">
    <view class="header">
      <text>标题</text>
    </view>
    <view class="body">
      <text>内容</text>
    </view>
  </view>
</template>
`
    const result = await compileVueContent(vueContent)

    expect(result.error).toBeNull()
    expect(result.wxml).toContain('wrapper')
    expect(result.wxml).toContain('header')
    expect(result.wxml).toContain('body')
    expect(result.js).toContain('defineComponent')
  })

  it('纯模板组件应该包含 virtualHost 配置', async () => {
    const vueContent = `
<template>
  <view class="test">测试</view>
</template>
`
    const result = await compileVueContent(vueContent)

    expect(result.error).toBeNull()
    // 检查生成的 JS 包含 virtualHost 和 externalClasses
    expect(result.js).toContain('virtualHost')
    expect(result.js).toContain('externalClasses')
  })
})
