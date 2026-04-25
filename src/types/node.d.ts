import type {
  AttributeNode,
  DirectiveNode,
  ElementTypes,
  NodeTypes,
  RootNode,
  SourceLocation,
  TemplateChildNode,
} from '@vue/compiler-core'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { ScriptScope } from './scope'

// 'element' | 'text' | 'interpolation' | 'comment' | 'block' | 'root'
/**
 * VMS 代码生成节点 - 每个 AST 节点自持，包含生成 WXML 所需的全部信息
 */
export interface VMSCodegenNode {
  /** 节点类型 */
  type: NodeTypes
  /** 标签名（element/block 类型） */
  tag?: string
  /** 所有属性（已转换完成，可直接输出）key: 属性名，如 "if"、"else"、"for"  */
  props?: Map<string, VMSCodegenProp>
  /** 子节点 codegenNode 数组 */
  children?: VMSCodegenNode[]
  /** 文本内容（text/comment 类型） */
  content?: string
  /** 原始 AST 节点引用 */
  loc?: SourceLocation
}

/**
 * VMS 代码生成属性 - 已转换完成，可直接输出到 WXML
 */
export interface VMSCodegenProp {
  /** 属性值，如 "{{condition}}"，undefined 表示无值属性 */
  content?: string
}

/**
 * 属性转换结果 - 由属性转换器返回
 */
export interface PropTransformResult {
  /** 转换后的属性名 */
  key: string
  /** 转换后的属性值 */
  value: VMSCodegenProp
  /** 优先级，用于解决属性冲突（高优先级覆盖低优先级） */
  priority: number
  /** 原始属性引用（用于调试） */
  source?: string
}

/**
 * 属性优先级常量
 * @see src/template/propTransformers.ts — 唯一定义来源
 */
export { PROP_PRIORITIES } from '@/template/propTransformers'

export interface VueComponentImport {
  name: string
  path: string
}

export interface VMSTransformResult {
  wxmlContent: string
  returnValue: t.ObjectExpression
  thirdPartyComponents: Map<string, string>
  bridgedFunctions: Set<string>
  internalVars: Set<string>
  renderVars: Set<string>
  needsProxyRefs: boolean
}

export interface VForInfo {
  // 原始 Vue 编译器的 forParseResult
  forParseResult: any

  // 元数据
  depth: number // 嵌套深度（0 表示最外层）
  parent?: VForInfo // 父级 v-for 信息（对于嵌套 v-for）
}

export type VMSRootNode = RootNode
export type VMSTemplateChildNode = TemplateChildNode

/**
 * 编译期上下文，存储编译期间的共享状态
 * 每次编译创建新实例
 */
export interface VMSTransformContext {
  /** 节点的 vForInfoList，key 为 AST 节点对象 */
  vForInfoMap: WeakMap<object, VForInfo[]>
  /** 被桥接函数替代的原始函数名集合（不应加入 __vmsRenderState） */
  bridgedFunctions: Set<string>
  /** 桥接函数内部用到的外部变量（只进 __vmsInternalState，不进渲染 data） */
  internalVars: Set<string>
  /** 通过模板直接绑定路径收集的变量（必须进 __vmsRenderState 渲染 data） */
  renderVars: Set<string>
  /** 是否有内联箭头函数需要通过 __vmsProxyRefs 访问外部变量 */
  needsProxyRefs: boolean
  /** Script 阶段分析的作用域信息 */
  scriptScope?: ScriptScope
  /** 模板根元素节点 */
  rootElementNode: null | TemplateChildNode
}

export interface VMSCounter {
  // 生成WXS函数名的计数器
  wxsFunctionCounter: number
  // 生成函数属性名的计数器
  functionPropertyCounter: number
  // 节点级别的 dataKey 计数器，每个节点从 0 开始（对应 'a'）
  nodeDataKeyIndex: number

  generateWxsFunctionName(): string

  generateFunctionPropertyName(): string
}

type MacroInfoVariable = {
  path: NodePath<t.VariableDeclaration>
  type: 'defineProps' | 'defineEmits' | 'defineContext'
  decl: t.VariableDeclarator
}

type MacroInfoExpression = {
  path: NodePath<t.ExpressionStatement>
  type: 'defineExpose' | 'defineOptions'
  expression: t.CallExpression
}

// 收集的宏信息接口
type MacroInfo = MacroInfoVariable | MacroInfoExpression

export interface VMSSFCContext {
  importAST: t.ImportDeclaration[]
  propsVarName: string
  propsVarRestName: string | undefined
  contextVarName: string
  exposeObject: t.ObjectExpression | null
  defineOptionsObject: Record<string, unknown> | null
  vueComponentImports: any[]
  functionVarsAndDecl: Set<string>
  // 存储解构的props变量与原始属性的映射关系，key对应的是解构的属性名（如果存在别名，则是别名）
  propsVarsMap: Map<string, { defaultValue?: any; originName: string; isDestructured?: boolean }>
  macroInfoList: MacroInfo[]
}

// 已废弃，使用 VMSCodegenProp 替代
/** @deprecated 使用 VMSCodegenProp */
export interface VMSTransformedProp {
  name: string
  content?: string
}

export type VMSAttrOrDirectiveNode = AttributeNode | DirectiveNode

export interface VMSError extends Error {
  cause: {
    loc: {
      start: {
        line: number
        column: number
      }
      end: {
        line: number
        column: number
      }
    }
  }
}
