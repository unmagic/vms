import { createVMSTransformContext, addRenderProperty } from '../src/template/tools'
import { analyzeScriptScope, isImportVariable } from '../src/script/scopeAnalyzer'
import * as t from '@babel/types'
import fs from 'fs'

const vueContent = fs.readFileSync(
  './example/src/subHome/pages/bill/profit/ProfitBillIndex.vue',
  'utf-8',
)
const scriptMatch = vueContent.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)

if (scriptMatch) {
  const scriptContent = scriptMatch[1]
  const scope = analyzeScriptScope(scriptContent)

  console.log(
    'Is profitPercentTypeOptions an import?',
    isImportVariable('profitPercentTypeOptions', scope),
  )

  // 创建模拟的 context
  const ctx = createVMSTransformContext(scope)

  console.log('ctx.scriptScope:', ctx.scriptScope ? 'exists' : 'null')
  console.log('ctx.scriptScope?.imports.size:', ctx.scriptScope?.imports.size)

  // 创建 returnValue
  const returnValue = t.objectExpression([])

  // 尝试添加 profitPercentTypeOptions
  console.log('\nTrying to add profitPercentTypeOptions...')
  addRenderProperty(returnValue, 'profitPercentTypeOptions', ctx)

  console.log('Return value properties:')
  returnValue.properties.forEach((prop: any) => {
    console.log('  ', prop.key?.name || prop.key?.value)
  })
} else {
  console.log('No script found')
}
