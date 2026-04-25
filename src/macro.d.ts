import type { ComponentContext, ShallowRef } from '@vue-mini/core'

type TemplateRef<T = unknown> = Readonly<ShallowRef<T | null>>

export {}

declare global {
  /**
   * 定义组件上下文
   * @returns ComponentContext 组件上下文对象
   */
  function defineContext(): ComponentContext

  /**
   * 定义@vue-mini/core缺少的组件上下文
   * @param key
   */
  function useTemplateRef<T = unknown, Keys extends string = string>(key: Keys): TemplateRef<T>
  const process: {
    env: Record<string, string>
  }
}
