import { ComponentMatchConfig } from '@/types/build'

// 组件匹配器类
export class ComponentMatcher {
  private prefix: string = ''
  private pathPrefix: string = ''
  private exactMatches: Map<string, string> = new Map()
  private isConfigPrefix: boolean = false
  private isConfigMatch: boolean = false
  constructor(config?: ComponentMatchConfig) {
    if (config) {
      // 设置前缀匹配
      if ((!config.prefix && config.pathPrefix) || (config.prefix && !config.pathPrefix)) {
        throw new Error('请设置组件匹配的前缀和路径前缀')
      }
      if (config.prefix && config.pathPrefix) {
        this.prefix = config.prefix
        this.pathPrefix = config.pathPrefix
        this.isConfigPrefix = true
      }

      // 设置严格匹配
      if (config.match?.length) {
        config.match.forEach((item) => {
          this.exactMatches.set(item.name, item.path)
        })
        this.isConfigMatch = true
      }
    }
  }

  /**
   * 根据组件名称匹配组件路径
   * @param componentName 组件名称
   * @returns 匹配的组件路径，如果没有匹配则返回null
   */
  match(componentName: string): string | null {
    // 1. 首先检查严格匹配
    if (this.exactMatches.has(componentName)) {
      return this.exactMatches.get(componentName) || null
    }

    // 2. 检查前缀匹配
    if (this.isConfigPrefix && componentName.startsWith(this.prefix)) {
      // 移除前缀并构造路径
      const relativePath = componentName.slice(this.prefix.length)
      const path = `${this.pathPrefix}/${relativePath}/${relativePath}`
      if (!this.exactMatches.has(componentName)) {
        // 添加到严格匹配中
        this.exactMatches.set(componentName, path)
        this.isConfigMatch = true
      }
      return path
    }

    // 没有匹配
    return null
  }

  /**
   * 检查是否存在任何匹配配置
   */
  hasConfig(): boolean {
    return this.isConfigPrefix || this.isConfigMatch
  }
}
