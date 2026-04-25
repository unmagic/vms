/**
 * 深度合并两个普通对象，合并规则：
 * 1. 类型不同：新值覆盖旧值
 * 2. 都是普通对象：递归合并（取并集）
 * 3. 都是数组：取并集（去重）
 * 4. 同类型原始值：新值覆盖旧值
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    const srcVal = source[key]
    const tgtVal = result[key]

    if (!(key in result)) {
      result[key] = srcVal
    } else if (!isSameCompositeType(tgtVal, srcVal)) {
      // 策略1：类型不同，新值覆盖
      result[key] = srcVal
    } else if (isPlainObject(tgtVal) && isPlainObject(srcVal)) {
      // 策略2：都是普通对象，递归合并
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>)
    } else if (Array.isArray(tgtVal) && Array.isArray(srcVal)) {
      // 策略2：都是数组，取并集
      result[key] = arrayUnion(tgtVal, srcVal)
    } else {
      // 策略1：同类型原始值，新值覆盖
      result[key] = srcVal
    }
  }

  return result
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isSameCompositeType(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return true
  if (isPlainObject(a) && isPlainObject(b)) return true
  return false
}

function arrayUnion(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set(a.map(serialize))
  const result = [...a]
  for (const item of b) {
    if (!seen.has(serialize(item))) {
      result.push(item)
      seen.add(serialize(item))
    }
  }
  return result
}

function serialize(val: unknown): string {
  return JSON.stringify(val)
}
