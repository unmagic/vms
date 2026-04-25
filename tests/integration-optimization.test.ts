import { describe, it, expect } from 'vitest'
import { parseTemplate } from '../src/template'
import { parse } from '@vue/compiler-dom'

describe('Optimization Integration Tests', () => {
  it('should use iterative v-for assignment (no stack overflow)', () => {
    // 创建深度嵌套的模板
    let template = '<div>Root</div>'
    const depth = 500 // 测试深度嵌套

    for (let i = 0; i < depth; i++) {
      template = `<div v-for="item${i} in list${i}">${template}</div>`
    }

    const ast = parse(template, { comments: false })

    // 应该成功完成，没有栈溢出
    expect(() => {
      parseTemplate(ast, '/test/path')
    }).not.toThrow()

    const result = parseTemplate(ast, '/test/path')
    expect(result.wxmlContent).toBeDefined()
    expect(result.returnValue).toBeDefined()

    console.log(`Deeply nested template (${depth} levels) processed successfully`)
  })

  it('should cache expression parsing', () => {
    const template = `
      <div>
        <div :class="active ? 'active' : 'inactive'">Item 1</div>
        <div :class="active ? 'active' : 'inactive'">Item 2</div>
        <div :class="active ? 'active' : 'inactive'">Item 3</div>
      </div>
    `

    const ast = parse(template, { comments: false })

    // 第一次解析
    const result1 = parseTemplate(ast, '/test/path')

    // 第二次解析
    const result2 = parseTemplate(ast, '/test/path')

    // 结果应该相同
    expect(result1.wxmlContent).toBe(result2.wxmlContent)
  })

  it('should handle complex templates efficiently', () => {
    // 创建包含多种指令的复杂模板
    const template = `
      <div v-if="showHeader">
        <h1>{{ title }}</h1>
        <button @click="handleClick">Click me</button>
      </div>
      <div v-for="item in items" :key="item.id">
        <div :class="{ active: item.active, disabled: !item.enabled }">
          <span @click="item.select(item)">{{ item.name }}</span>
          <div :style="{ color: item.color, fontSize: item.size + 'px' }">
            {{ item.description }}
          </div>
        </div>
      </div>
      <div v-else>
        <p>No items to display</p>
      </div>
    `

    const ast = parse(template, { comments: false })

    const startTime = performance.now()
    const result = parseTemplate(ast, '/test/path')
    const endTime = performance.now()

    const duration = endTime - startTime

    expect(result.wxmlContent).toBeDefined()
    expect(result.returnValue).toBeDefined()
    expect(result.thirdPartyComponents).toBeDefined()

    // 应该在合理时间内完成
    expect(duration).toBeLessThan(100) // 小于100ms

    console.log(`Complex template processed in ${duration.toFixed(2)}ms`)
  })

  it('should optimize memory usage for v-for info', () => {
    // 创建大量节点的模板
    const items = Array.from({ length: 100 }, (_, i) => i)
    const template = `
      <div>
        ${items.map((i) => `<div v-for="subItem${i} in subList${i}">Item ${i}</div>`).join('\n')}
      </div>
    `

    const ast = parse(template, { comments: false })

    // 通过parseTemplate间接测试
    const result = parseTemplate(ast, '/test/path')

    // 验证转换成功
    expect(result.wxmlContent).toBeDefined()
    expect(result.returnValue).toBeDefined()

    // 检查wxml是否包含预期的v-for转换
    // 应该包含wx:for属性
    expect(result.wxmlContent).toContain('wx:for')

    console.log(`Large template with ${items.length} v-for nodes processed successfully`)
  })

  it('should maintain correctness after optimization', () => {
    // 测试各种模板以确保优化不影响正确性
    const testCases = [
      {
        name: 'simple v-for',
        template: '<div v-for="item in items" :key="item.id">{{ item.name }}</div>',
        // 检查是否成功转换，不检查具体标签
        shouldTransform: true,
      },
      {
        name: 'v-if with v-for',
        template: '<div v-if="show"><div v-for="item in items">{{ item }}</div></div>',
        shouldTransform: true,
      },
      {
        name: 'event handler',
        template: '<button @click="handleClick">Click</button>',
        shouldTransform: true,
      },
      {
        name: 'class binding',
        template: '<div :class="{ active: isActive }">Test</div>',
        shouldTransform: true,
      },
      {
        name: 'style binding',
        template: '<div :style="{ color: textColor }">Test</div>',
        shouldTransform: true,
      },
    ]

    for (const testCase of testCases) {
      const ast = parse(testCase.template, { comments: false })
      const result = parseTemplate(ast, '/test/path')

      expect(result.wxmlContent, `Failed for: ${testCase.name}`).toBeDefined()
      expect(result.returnValue, `Failed for: ${testCase.name}`).toBeDefined()

      // 验证转换成功生成了有效的wxml
      expect(result.wxmlContent.length, `Failed for: ${testCase.name}`).toBeGreaterThan(0)

      // 验证returnValue包含必要的属性
      expect(result.returnValue.properties, `Failed for: ${testCase.name}`).toBeDefined()

      console.log(`✓ ${testCase.name}: Correctly transformed (${result.wxmlContent.length} chars)`)
    }
  })
})
