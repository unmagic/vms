/**
 * 统一的作用域分析类型定义
 * 用于管理模板中变量的来源和访问方式
 */

/**
 * 变量来源类型
 */
export type VariableSourceType =
  | 'v-for' // v-for 临时变量
  | 'props' // props 变量
  | 'macro' // 编译宏变量 (emits, context, slots)
  | 'import' // 导入的变量
  | 'declaration' // 脚本中声明的变量
  | 'global' // 全局变量

/**
 * 变量来源详细信息
 */
export interface VariableSource {
  type: VariableSourceType
  /**
   * 访问路径
   * - v-for: 'data-a'
   * - props: '__vmsProps'
   * - macro: 变量名本身 (emits, context)
   * - import: 变量名本身
   * - declaration: '__vmsProxyRefs'
   * - global: 变量名本身
   */
  accessPath: string
  /**
   * 是否需要通过索引访问 (v-for 变量)
   */
  needsIndex?: boolean
  /**
   * 原始名称 (用于别名映射)
   */
  originalName?: string
}

/**
 * 变量信息
 */
export interface VariableInfo {
  name: string
  source: VariableSource
}

/**
 * Script 阶段收集的静态作用域
 */
export interface ScriptScope {
  /**
   * props 变量
   * key: 解构后的变量名
   * value: 变量信息 (包含原始 props 名)
   */
  props: Map<string, VariableInfo>
  /**
   * 编译宏变量
   * key: 变量名
   * value: 变量信息
   */
  macros: Map<string, VariableInfo>
  /**
   * 导入的变量
   * key: 变量名
   * value: 变量信息
   */
  imports: Map<string, VariableInfo>
  /**
   * 脚本中声明的变量
   * key: 变量名
   * value: 变量信息
   */
  declarations: Map<string, VariableInfo>
  /**
   * 全局变量白名单
   */
  globals: Set<string>
  /**
   * props rest 变量名 (如 const { ...rest } = defineProps())
   */
  propsRestName?: string
  /**
   * props 变量名 (如 const props = defineProps())
   */
  propsVarName?: string
}

/**
 * Template 阶段收集的动态作用域
 */
export interface TemplateScope {
  /**
   * 当前节点的 v-for 变量
   * key: 变量名 (item, index)
   * value: 变量信息
   */
  vForVars: Map<string, VariableInfo>
  /**
   * 父级 v-for 变量 (嵌套时使用)
   */
  parentVForVars: Map<string, VariableInfo>
  /**
   * 引用 script 作用域
   */
  scriptScope: ScriptScope
}

/**
 * 变量解析结果
 */
export interface VariableResolution {
  /**
   * 变量是否找到
   */
  found: boolean
  /**
   * 变量信息
   */
  info?: VariableInfo
  /**
   * 生成访问代码
   * @param index 可选的索引 (v-for 变量使用)
   */
  generateAccess(index?: string): string
}

/**
 * 收集的模板变量
 */
export interface CollectedTemplateVariables {
  /**
   * 需要加入 __vmsRenderState 的变量
   */
  renderVars: Set<string>
  /**
   * 需要加入 __vmsInternalState 的变量
   */
  internalVars: Set<string>
  /**
   * v-for 引用 (需要生成 data-a)
   * key: 变量名
   * value: v-for 信息
   */
  vForRefs: Map<string, VariableInfo>
  /**
   * props 引用 (需要从 __vmsProps 获取)
   */
  propsRefs: Set<string>
}
