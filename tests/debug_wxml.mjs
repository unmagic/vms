import { parse } from '@vue/compiler-sfc'
import { NodeTypes } from '@vue/compiler-dom'

const template = `<div class="order-summary">
  <div class="summary-text">
    已选金额:
    <span>{{ amount }}</span>
  </div>
</div>`

const { descriptor } = parse(template)
const templateAST = descriptor.template?.ast

console.log('=== Original AST children ===')
function printChildren(node, indent = 0) {
  const prefix = '  '.repeat(indent)
  if (!node) return
  if (node.type === NodeTypes.ELEMENT) {
    console.log(`${prefix}Element: ${node.tag}`)
    if (node.children) {
      for (const child of node.children) {
        printChildren(child, indent + 1)
      }
    }
  } else if (node.type === NodeTypes.TEXT) {
    const content = node.content || ''
    console.log(`${prefix}Text: "${content.replace(/\n/g, '\\n').replace(/ /g, '·')}"`)
  } else if (node.type === NodeTypes.INTERPOLATION) {
    console.log(`${prefix}Interpolation`)
  }
}

if (templateAST) {
  for (const child of templateAST.children || []) {
    printChildren(child)
  }
}
