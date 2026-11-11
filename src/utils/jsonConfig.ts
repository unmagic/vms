/**
 * 生成组件基础 JSON 配置。
 *
 * 单独抽出为纯函数，便于单元测试覆盖 glass-easel 等开关行为，
 * 避免测试中重复实现同一份逻辑而与真实构建结果产生偏差。
 */
export function createBaseJsonConfig(
  isPage: boolean,
  usingComponents: Record<string, string>,
  glassEasel: boolean,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    component: true,
    styleIsolation: isPage ? 'shared' : 'apply-shared',
    usingComponents,
  }

  if (glassEasel) {
    config.componentFramework = 'glass-easel'
    config.glassEaselWebview = true
  }

  return config
}
