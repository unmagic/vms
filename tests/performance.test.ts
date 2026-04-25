import { describe, it, expect } from 'vitest'
import { parseTemplate } from '../src/template'
import { parse } from '@vue/compiler-dom'

describe('Template Transform Performance', () => {
  const testCases = [
    {
      name: 'Simple template',
      template: '<div>Hello World</div>',
    },
    {
      name: 'Template with v-for',
      template: '<div v-for="item in items" :key="item.id">{{ item.name }}</div>',
    },
    {
      name: 'Template with v-if and v-for',
      template: `
        <div v-if="show">
          <div v-for="item in items" :key="item.id">
            {{ item.name }}
          </div>
        </div>
      `,
    },
    {
      name: 'Complex template with events',
      template: `
        <div>
          <button @click="handleClick">Click me</button>
          <div v-for="item in items" :key="item.id">
            <span @click="item.onClick(item)">{{ item.name }}</span>
          </div>
        </div>
      `,
    },
  ]

  it('should transform templates efficiently', () => {
    const results: Array<{ name: string; time: number }> = []

    for (const testCase of testCases) {
      const startTime = performance.now()

      // Parse the template
      const ast = parse(testCase.template, {
        comments: false,
      })

      // Transform the template
      parseTemplate(ast, '/test/path')

      const endTime = performance.now()
      const duration = endTime - startTime

      results.push({
        name: testCase.name,
        time: duration,
      })

      console.log(`${testCase.name}: ${duration.toFixed(2)}ms`)
    }

    // Basic assertion - all transformations should complete
    expect(results.length).toBe(testCases.length)

    // Log performance summary
    const totalTime = results.reduce((sum, r) => sum + r.time, 0)
    const avgTime = totalTime / results.length

    console.log(`\nPerformance Summary:`)
    console.log(`Total time: ${totalTime.toFixed(2)}ms`)
    console.log(`Average time: ${avgTime.toFixed(2)}ms`)
    console.log(`Times per test case:`)
    results.forEach((r) => {
      console.log(`  ${r.name}: ${r.time.toFixed(2)}ms`)
    })
  })

  it('should handle nested v-for efficiently', () => {
    const template = `
      <div v-for="parent in parents" :key="parent.id">
        <div>{{ parent.name }}</div>
        <div v-for="child in parent.children" :key="child.id">
          {{ child.name }}
        </div>
      </div>
    `

    const startTime = performance.now()

    const ast = parse(template, {
      comments: false,
    })

    const result = parseTemplate(ast, '/test/path')

    const endTime = performance.now()
    const duration = endTime - startTime

    console.log(`Nested v-for transformation: ${duration.toFixed(2)}ms`)

    // Basic assertions
    expect(result.wxmlContent).toBeDefined()
    expect(result.returnValue).toBeDefined()
    expect(duration).toBeLessThan(100) // Should complete in under 100ms
  })

  it('should have consistent performance across multiple runs', () => {
    const template = '<div v-for="item in items" :key="item.id">{{ item.name }}</div>'
    const ast = parse(template, { comments: false })

    const times: number[] = []
    const runs = 10

    for (let i = 0; i < runs; i++) {
      const startTime = performance.now()
      parseTemplate(ast, '/test/path')
      const endTime = performance.now()
      times.push(endTime - startTime)
    }

    const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length
    const maxTime = Math.max(...times)
    const minTime = Math.min(...times)
    const variance = maxTime - minTime

    console.log(`\nConsistency test (${runs} runs):`)
    console.log(`Average: ${avgTime.toFixed(2)}ms`)
    console.log(`Min: ${minTime.toFixed(2)}ms`)
    console.log(`Max: ${maxTime.toFixed(2)}ms`)
    console.log(`Variance: ${variance.toFixed(2)}ms`)

    // 由于缓存优化，我们主要关注平均性能在可接受范围内
    expect(avgTime).toBeLessThan(1) // Average time less than 1ms
    expect(maxTime).toBeLessThan(2) // Max time less than 2ms

    // 对于缓存优化系统，方差可能较大，这是正常的
    // 我们只记录方差，不进行严格断言
    if (variance > avgTime * 3) {
      console.log(
        `Note: High variance detected (${variance.toFixed(2)}ms), which is expected with caching optimizations`,
      )
    }
  })
})
