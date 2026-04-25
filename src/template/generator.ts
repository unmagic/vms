import { WX_TAG_MAP } from '@/utils/constants'
import { NodeTypes, type RootNode } from '@vue/compiler-core'
import type { VMSCodegenNode, VMSCodegenProp } from '@/types/node'
import { getCodegenNode } from './tools'

function createAttr(prop: VMSCodegenProp, key: string): string {
  return typeof prop?.content === 'undefined'
    ? ` ${key}`
    : ` ${key}="${prop.content}"`
}

class WXMLGenerator {
  private code: string[]
  private indentLevel: number
  private indent: string

  constructor() {
    this.code = []
    this.indentLevel = 0
    this.indent = '  '
  }

  generate(wxsScripts: string | undefined, ast: RootNode): string {
    this.code.splice(0, this.code.length)
    if (wxsScripts) {
      this.code.push(wxsScripts)
    }
    this.indentLevel = 0

    // 从根节点的 codegenNode 开始生成，如果没有则基于原始 AST 生成
    const rootCodegen = getCodegenNode(ast)
    if (rootCodegen?.children) {
      rootCodegen.children.forEach((child, index) => {
        this.traverseCodegenNode(child)
        if (index < rootCodegen.children!.length - 1) {
          this.code.push('\n')
        }
      })
    }

    return this.code.join('')
  }

  /**
   * 遍历 codegenNode 生成 WXML
   */
  private traverseCodegenNode(node: VMSCodegenNode): void {
    if (!node) return

    switch (node.type) {
      case NodeTypes.ELEMENT:
        this.generateElement(node)
        break
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
    case NodeTypes.INTERPOLATION:
        this.generateLeafNode(node)
        break
      default:
        break
    }
  }

  /**
   * 生成元素节点（基于 codegenNode）
   */
  private generateElement(node: VMSCodegenNode): void {
    const indentation = this.indent.repeat(this.indentLevel)
    const tag = node.tag && WX_TAG_MAP.has(node.tag) ? WX_TAG_MAP.get(node.tag)! : node.tag || ''

    // block 标签且无属性时，直接渲染子节点
    if (tag === 'block' && (!node.props || node.props.size === 0)) {
      node.children?.forEach((child) => {
        this.traverseCodegenNode(child)
      })
      return
    }

    this.code.push(`${indentation}<${tag}`)

    // 直接输出 codegenNode 中的属性（已转换完成）
    this.generateProps(node.props)

    if (node.children && node.children.length > 0) {
      this.code.push('>')
      const isNeedIndent = this.shouldIndentChildren(node)

      if (isNeedIndent) {
        this.code.push('\n')
        this.indentLevel++
      }

      node.children.forEach((child, index) => {
        this.traverseCodegenNode(child)
        if (isNeedIndent && index < node.children!.length - 1) {
          this.code.push('\n')
        }
      })

      if (isNeedIndent) {
        this.indentLevel--
        this.code.push(`\n${indentation}`)
      }

      this.code.push(`</${tag}>`)
    } else {
      this.code.push(' />')
    }
  }

  /**
   * 生成属性列表
   */
  private generateProps(props: Map<string, VMSCodegenProp> | undefined): void {
    if (!props) return

    props.forEach((prop, key) => {
      this.code.push(createAttr(prop, key))
    })
  }

  private generateLeafNode(node: VMSCodegenNode): void {
    this.code.push(node.content || '')
  }

  private shouldIndentChildren(node: VMSCodegenNode): boolean {
    return !node.children?.every(
      (child) => child.type === NodeTypes.TEXT || child.type === NodeTypes.INTERPOLATION,
    )
  }
}

export function generateWxml(wxsScripts: string | undefined, ast: RootNode): string {
  const generator = new WXMLGenerator()
  return generator.generate(wxsScripts, ast)
}
