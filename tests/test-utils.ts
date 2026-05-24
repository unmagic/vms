import { parse as parseSFC } from '@vue/compiler-sfc'
import { parseTemplate } from '../src/template'
import { parseScript, analyzeScriptScope, createEmptyScriptScope } from '../src/script'
import { deepMerge } from '../src/utils/merge'

export interface JsonConfig {
  component: boolean
  styleIsolation: string
  usingComponents: Record<string, string>
  [key: string]: unknown
}

/**
 * 编译 Vue 单文件组件内容,返回生成的 JS、WXML 和 JSON 配置
 * 支持纯模板组件（无 script 部分）
 * @param isPage 是否为页面组件（默认 false）
 */
export async function compileVueContent(
  vueContent: string,
  isPage = false,
): Promise<{
  js: string
  wxml: string
  json: JsonConfig | null
  error: Error | null
}> {
  try {
    const { descriptor } = parseSFC(vueContent, {
      filename: 'test.vue',
      templateParseOptions: { comments: false },
    })

    const { template, scriptSetup } = descriptor

    if (!template?.ast) {
      throw new Error('Invalid Vue SFC: missing template')
    }

    // 支持纯模板组件
    const isTemplateOnly = !scriptSetup

    // 1. 先分析 script 作用域（纯模板组件使用空作用域）
    const scriptScope = isTemplateOnly
      ? createEmptyScriptScope()
      : analyzeScriptScope(scriptSetup.content)

    // 2. 转换 template（传入 scriptScope）
    const {
      wxmlContent,
      returnValue,
      thirdPartyComponents,
      bridgedFunctions,
      internalVars,
      renderVars,
      needsProxyRefs,
    } = parseTemplate(template.ast, 'test.vue', isPage, scriptScope)

    // 3. 转换 script（纯模板组件传递 isTemplateOnly 标志）
    const result = await parseScript(
      descriptor,
      returnValue,
      bridgedFunctions,
      internalVars,
      renderVars,
      needsProxyRefs,
      isPage,
      scriptScope,
    )

    // 4. 生成 JSON 配置（模拟 transformer.ts 的逻辑）
    const usingComponents: Record<string, string> = {}
    result.vueComponentImports.forEach((imp) => {
      if (imp.path.endsWith('.vue')) {
        const componentName = imp.name
        const componentPath = imp.path.startsWith('@/')
          ? imp.path.replace('@/', '/').replace(/\.vue$/, '')
          : imp.path.replace(/\.vue$/, '')
        usingComponents[componentName] = componentPath
      }
    })
    thirdPartyComponents.forEach((value, key) => {
      usingComponents[key] = value
    })

    const baseJsonConfig: Record<string, unknown> = {
      component: true,
      styleIsolation: isPage ? 'shared' : 'apply-shared',
      usingComponents,
    }
    const jsonConfig = result.defineOptionsObject
      ? deepMerge(baseJsonConfig, result.defineOptionsObject)
      : baseJsonConfig

    return {
      js: result.script,
      wxml: wxmlContent,
      json: jsonConfig as JsonConfig,
      error: null,
    }
  } catch (error) {
    return {
      js: '',
      wxml: '',
      json: null,
      error: error as Error,
    }
  }
}
