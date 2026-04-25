import {
  createVMSTransformContext,
  addRenderProperty,
  collectBindingVarsWithVarName,
} from '../src/template/tools'
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

  // 创建模拟的 context
  const ctx = createVMSTransformContext(scope)

  // 创建 returnValue
  const returnValue = t.objectExpression([])

  console.log('Testing collectBindingVarsWithVarName with profitPercentTypeOptions...')

  // 模拟调用 collectBindingVarsWithVarName
  // 注意：这里需要一个 TemplateChildNode，但我们用 null 来测试
  // 实际上应该传入正确的 node，但这里主要看 shouldCollectVariable 的行为
  try {
    collectBindingVarsWithVarName('profitPercentTypeOptions', null as any, returnValue, ctx)
  } catch (e) {
    // 忽略 node 为 null 的错误
  }

  console.log('Return value properties after collectBindingVarsWithVarName:')
  console.log('  Count:', returnValue.properties.length)
  returnValue.properties.forEach((prop: any) => {
    console.log('   -', prop.key?.name || prop.key?.value)
  })

  // 直接测试 addRenderProperty
  console.log('\nDirect test of addRenderProperty:')
  addRenderProperty(returnValue, 'profitPercentTypeOptions', ctx)
  console.log('Return value properties count:', returnValue.properties.length)
} else {
  console.log('No script found')
}
