import { parse } from '@vue/compiler-sfc'

const template = `
<div class="summary-text">
  已选金额:
  <span>test</span>
</div>
`

const { descriptor } = parse(template)
const ast = descriptor.template?.ast

function printAST(node, indent = 0) {
  const prefix = '  '.repeat(indent)
  if (node.type === 1) {
    console.log(`${prefix}Element: ${node.tag}`)
    if (node.children) {
      for (const child of node.children) {
        printAST(child, indent + 1)
      }
    }
  } else if (node.type === 2) {
    console.log(`${prefix}Text: "${node.content.replace(/\n/g, '\\n').replace(/ /g, '·')}"`)
  } else if (node.type === 3) {
    console.log(`${prefix}Comment`)
  } else if (node.type === 5) {
    console.log(`${prefix}Interpolation`)
  }
}

if (ast) {
  printAST(ast)
}
