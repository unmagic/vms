import { analyzeScriptScope, isImportVariable } from '../src/script/scopeAnalyzer'
import fs from 'fs'

const vueContent = fs.readFileSync(
  './example/src/subHome/pages/bill/profit/ProfitBillIndex.vue',
  'utf-8',
)
const scriptMatch = vueContent.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)

if (scriptMatch) {
  const scriptContent = scriptMatch[1]
  console.log('Script content (first 500 chars):')
  console.log(scriptContent.slice(0, 500))
  console.log('\n--- Analyzing scope ---\n')

  const scope = analyzeScriptScope(scriptContent)

  console.log('Imports count:', scope.imports.size)
  console.log('Imports:')
  for (const [name, info] of scope.imports) {
    console.log(`  ${name}`)
  }

  console.log(
    '\nIs profitPercentTypeOptions an import?',
    isImportVariable('profitPercentTypeOptions', scope),
  )
  console.log('Is ref an import?', isImportVariable('ref', scope))
  console.log('Is searchFormRef an import?', isImportVariable('searchFormRef', scope))
} else {
  console.log('No script found')
}
