/**
 * 依赖构建去重判定。
 *
 * 从 cli.ts 抽出：`bundleModule` 需要判断某个 npm 依赖（或子路径）
 * 是否已经构建过，避免重复打包与重复复制。
 * 这段判断原先内联在构建流程中且无测试覆盖，而它的边界行为
 * （`foo` 与 `foo-bar`、`foo` 与 `foo/plugin`）直接影响产物完整性。
 */

/**
 * 判断模块是否已被"整包构建"覆盖。
 *
 * 规则：模块等于已构建包名，或位于该包的子路径下。
 * 必须区分 `foo` 与 `foo-bar`——裸前缀匹配会把 `foo-bar` 误判为
 * `foo` 的子路径而跳过构建，导致产物缺少该依赖。
 */
export function isCoveredByBuiltLibrary(module: string, builtLibraries: Iterable<string>): boolean {
  for (const library of builtLibraries) {
    if (module === library || module.startsWith(`${library}/`)) {
      return true
    }
  }
  return false
}

/**
 * 依赖去重登记表。
 *
 * 按"构建上下文"（root 或某个独立分包）分别记录已处理的模块，
 * 因为同一依赖可能需要为不同分包各构建/复制一份。
 *
 * 注意：`pkg` 是调用方提供的上下文标识，仅做 Map 键使用，不做归一化。
 * 现有调用点存在两种写法（源文件路径走 `src/subLock`，依赖复制走 `subLock`），
 * 因此这两条路径之间不会互相去重。保持原行为以免影响产物复制；
 * 若要统一需同时调整全部调用点，属独立改动。
 */
export interface ModuleDedupRegistry {
  /**
   * 判断是否应跳过该模块；未跳过时同时登记，避免后续重复处理。
   * @returns true 表示已处理过（调用方应跳过）
   */
  shouldSkip: (module: string, pkg: string) => boolean
  /**
   * 仅登记（不判断），用于"已确认为某分包复制过该依赖"的场景，
   * 避免后续重复复制到同一分包。
   */
  register: (module: string, pkg: string) => void
}

export function createModuleDedupRegistry(
  getBuiltLibraries: () => Iterable<string>,
): ModuleDedupRegistry {
  const bundledModules = new Map<string, Set<string>>()

  return {
    shouldSkip(module: string, pkg: string): boolean {
      const bundled = bundledModules.get(pkg)
      if (bundled?.has(module)) return true
      if (isCoveredByBuiltLibrary(module, getBuiltLibraries())) return true

      if (bundled) {
        bundled.add(module)
      } else {
        bundledModules.set(pkg, new Set([module]))
      }
      return false
    },
    register(module: string, pkg: string): void {
      const bundled = bundledModules.get(pkg)
      if (bundled) {
        bundled.add(module)
      } else {
        bundledModules.set(pkg, new Set([module]))
      }
    },
  }
}
