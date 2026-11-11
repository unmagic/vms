#!/usr/bin/env node
/**
 * 产物级一致性校验（对真实构建输出跑，而非单元测试的模拟管线）。
 *
 * 检查项：
 *  1. 每个 .wxml 中的事件绑定（bind:/catch:/mut-bind:/capture- 前缀）
 *     指向的处理函数，在配套 .js 中确实有定义
 *  2. 每个 .wxml 引用的 wxs 模块函数（wms_wxs.__wxs_N）在同文件 <wxs> 中已定义
 *  3. 每个 .json 的 usingComponents 路径可解析到实际文件
 *  4. 每个 .wxml 中 data-* 索引键在配套 .js 的 setter 解构中出现
 *  5. WXML 结构合法性：标签配对、无重复属性
 *  6. **VMS 生成的 .js 必须是合法 JavaScript**（不含残留 TS 语法）
 *  7. WXS 代码块中不得出现 `$` 标识符（WXS 不支持）
 *
 * 用法：
 *   node verify-artifacts.mjs <dist-dir> [--strict] [--vms-only] [--src <dir>]
 *
 *   --src <dir>  源码目录，用于区分"VMS 生成"与"原样拷贝"的产物
 *   --vms-only   只校验由 VMS 生成的产物（配合 --src 使用）
 *   --strict     发现问题以 exit 1 退出，可用于 CI
 *
 * 关于 --vms-only：原生四件套（.wxml/.wxss/.json 源文件）会被逐字节拷贝到
 * 产物中，其既有缺陷（例如 `bind:close` 指向未定义的处理函数）不属于
 * 编译器问题，但会在全量扫描时被一并报告。用 --vms-only 可只看编译器产物，
 * 从而让 --strict 可用于 CI。
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const vmsOnly = args.includes('--vms-only')
const root = args.find((a) => !a.startsWith('--'))
// --src 指定源码目录，用于判断哪些产物由 VMS 生成（.vue）vs 原样拷贝（.wxml/.ts 等）
const srcArgIdx = args.indexOf('--src')
const srcDir = srcArgIdx >= 0 ? args[srcArgIdx + 1] : null
if (!root) {
  console.error(
    'usage: node verify-artifacts.mjs <dist-dir> [--strict] [--vms-only] [--src <source-dir>]',
  )
  console.error('  默认仅报告（始终 exit 0）；--strict 时发现问题以 exit 1 退出，可用于 CI')
  console.error('  --vms-only 只报告由 VMS 生成的产物（需配合 --src）')
  process.exit(2)
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(root)

// 第三方依赖目录由 npm 原样复制，不参与本校验：
//  - 其 JS 经 minify，函数名无法用正则可靠识别
//  - template/*.wxml 是被 <import> 引用的片段，本就没有配套 .js
// 本脚本只校验 VMS 自己生成的组件/页面产物。
const isThirdParty = (f) => f.includes(`${path.sep}miniprogram_npm${path.sep}`)

/**
 * 判断某个产物是否由 VMS 生成（而非原样拷贝）。
 *
 * 产物路径与源码同构，但**不同文件类型的来源不同**：
 *  - `.wxml` 只有在存在同名 `.vue` 时才由 VMS 模板编译生成；
 *    若来源是 `.wxml` 源文件，则是逐字节原样拷贝（已实测确认）
 *  - `.js`  来源于 `.vue`（VMS 生成）或 `.ts`（Babel 转译的原生逻辑）
 *
 * 原样拷贝文件中的既有缺陷不属于编译器问题（例如原生四件套里
 * `bind:close` 指向未定义的处理函数），因此 --vms-only 需要按类型判定，
 * 否则会把原生代码的问题误算到编译器头上。
 *
 * 未提供 --src 时无法判断，一律视为"需要校验"（保持向后兼容）。
 */
const srcRoot = srcDir ? path.resolve(srcDir) : null
function isVmsGenerated(distFile) {
  if (!srcRoot) return true
  const rel = path.relative(path.resolve(root), distFile)
  const toSrc = (ext) => path.join(srcRoot, rel.replace(/\.(wxml|js|json|wxss)$/, ext))

  // .wxml / .wxss / .json：只有同名 .vue 存在才是 VMS 生成的
  if (/\.(wxml|wxss|json)$/.test(distFile)) {
    return fs.existsSync(toSrc('.vue'))
  }
  // .js：.vue（VMS 生成）或 .ts（Babel 转译）都算编译器产物
  return fs.existsSync(toSrc('.vue')) || fs.existsSync(toSrc('.ts'))
}

const inScope = (f) => !isThirdParty(f) && (!vmsOnly || isVmsGenerated(f))

const wxmlFiles = files.filter((f) => f.endsWith('.wxml') && inScope(f))
const jsonFiles = files.filter((f) => f.endsWith('.json') && inScope(f))

const problems = []
const stats = {
  bindings: 0,
  wxsCalls: 0,
  components: 0,
  dataAttrs: 0,
  jsFiles: 0,
  wxmlStructure: 0,
  wxmlExpression: 0,
}

function readJs(jsPath) {
  try {
    return fs.readFileSync(jsPath, 'utf8')
  } catch {
    return null
  }
}

/** 去掉 WXML 注释，避免把被注释掉的绑定当作真实绑定 */
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 去掉 JS 注释与字符串字面量，避免把字符串内容误判为语法。
 * 例：`return a ? a : '加载中...'` 中的 `...` **不是** spread 语法。
 * 这一点很关键——朴素正则会在此产生假阳性。
 */
function stripJsLiterals(src) {
  return src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/**
 * 官方 WXS 语言未支持的构造。语句仅支持 if / switch / for / while；
 * 函数仅 `function` 声明（无箭头函数）；无 class / try-catch / 扩展运算符等。
 * 参考《WXS 语法参考 · 语句 / 运算符 / 数据类型》。
 */
const WXS_UNSUPPORTED = [
  ['箭头函数', /=>/],
  ['let/const', /\b(let|const)\s/],
  ['class', /\bclass\s/],
  ['try/catch', /\btry\s*\{/],
  ['扩展运算符', /\.\.\./],
  ['模板字符串', /`/],
  ['async/await', /\b(async|await)\b/],
  ['可选链', /\?\./],
  ['空值合并', /\?\?/],
]

for (const wxml of wxmlFiles) {
  const src = stripComments(fs.readFileSync(wxml, 'utf8'))
  const js = readJs(wxml.replace(/\.wxml$/, '.js'))

  // 1. 事件绑定处理函数
  for (const m of src.matchAll(
    /(?:bind|catch|mut-bind|capture-bind|capture-catch|capture-mut-bind):[\w:-]+="([^"]+)"/g,
  )) {
    const handler = m[1]
    stats.bindings++
    if (/^\{\{/.test(handler)) continue // 动态绑定，跳过
    if (!js) {
      problems.push(wxml + ': 缺少配套 .js（绑定 ' + handler + '）')
      continue
    }
    // 处理函数的定义形式随构建模式不同：
    //   压缩产物：function a(...) / a= / a:  （名字被保留在桥接函数或对象键上）
    //   未压缩产物（dev）：
    //     function onX(...) {...}
    //     const { onX } = getXxxUpdateFun(...)   ← 对象**简写**解构，无 "onX:" 形式
    //     { onX, onY }                            ← 对象简写属性
    // 因此除赋值/键值形式外，还需匹配"作为独立标识符出现在解构或对象简写中"。
    const defined =
      new RegExp('function\\s+' + handler + '\\b').test(js) ||
      new RegExp('\\b' + handler + '\\s*[=:,}]').test(js) ||
      new RegExp('[,{]\\s*' + handler + '\\s*[,}]').test(js) ||
      new RegExp('["\']' + handler + '["\']\\s*:').test(js)
    if (!defined) problems.push(wxml + ': 绑定处理函数未在 JS 中定义 -> ' + handler)
  }

  // 2. WXS 函数调用
  const definedWxs = new Set([...src.matchAll(/module\.exports\.(\w+)\s*=/g)].map((m) => m[1]))
  for (const m of src.matchAll(/wms_wxs\.(\w+)\s*\(/g)) {
    stats.wxsCalls++
    if (!definedWxs.has(m[1])) problems.push(wxml + ': 调用了未定义的 WXS 函数 -> ' + m[1])
  }

  // 3. data-* 索引键需在 JS 中解构
  for (const m of src.matchAll(/data-([a-z])="{{/g)) {
    stats.dataAttrs++
    if (!js) continue
    if (!new RegExp('\\b' + m[1] + '\\s*:').test(js)) {
      problems.push(wxml + ': data-' + m[1] + ' 未在 JS setter 中解构')
    }
  }

  // 3b. WXML 结构合法性：标签配对 + 无重复属性
  //     小程序对未闭合标签/重复属性会静默忽略或报错，属于"产物能否运行"的一层。
  {
    const stack = []
    const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
    let tm
    while ((tm = tagRe.exec(src))) {
      const [, closing, tag, , selfClose] = tm
      if (closing) {
        const top = stack.pop()
        if (top !== tag) problems.push(wxml + ': 标签不配对 </' + tag + '>')
      } else if (!selfClose) {
        stack.push(tag)
      }
    }
    if (stack.length) problems.push(wxml + ': 未闭合标签 ' + stack.join(','))

    for (const am of src.matchAll(/<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g)) {
      const attrs = [...am[2].matchAll(/([\w:.-]+)\s*=/g)].map((x) => x[1])
      const dup = attrs.filter((a, i) => attrs.indexOf(a) !== i)
      if (dup.length) problems.push(wxml + ': 重复属性 ' + [...new Set(dup)].join(','))
    }
    stats.wxmlStructure++
  }

  // 3e. WXML 表达式中不得出现微信编译器无法解析的运算符
  //     WXML 的表达式解析器（不是 JS 引擎）不支持以下运算符；原样输出会让
  //     开发者工具报 Bad value with message: unexpected token，
  //     并且**整个页面无法加载**（而非单个字段为空）。
  //     实测（模拟器）确认：
  //       一元 +  -> unexpected token +
  //       **      -> unexpected token *
  //       >>>     -> unexpected token >
  //     其它运算符（+ - * / % << >> & | ^ === 以及一元 ! - ~ !!）WXML 均支持。
  //     编译器应把这些不支持的形式改由 WXS 求值（见 isComplexExpression）。
  for (const m of src.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const expr = m[1]
    if (/\*\*/.test(expr)) {
      problems.push(wxml + ': WXML 表达式含 ** -> 幂运算应改由 WXS 求值')
    }
    if (/>>>/.test(expr)) {
      problems.push(wxml + ': WXML 表达式含 >>> -> 无符号右移应改由 WXS 求值')
    }
    // 一元 +：表达式以 + 开头（忽略前导空白），即 {{ +x }} 形式
    if (/^\s*\+[^+=]/.test(expr)) {
      problems.push(wxml + ': WXML 表达式含一元 + -> 应改由 WXS 求值')
    }
    stats.wxmlExpression++
  }

  // 4. WXS 代码中不得出现 `$` 标识符
  //    WXS 不支持 `$` 标识符；属性名含 `$` 时应编译为 `obj['$x']` 形式。
  //    这里只检查标识符位置（排除字符串字面量与注释）。
  for (const m of src.matchAll(/<wxs[^>]*>([\s\S]*?)<\/wxs>/g)) {
    const wxsBody = m[1]
    const stripped = wxsBody
      .replace(/\/\/[^\n]*/g, '') // 行注释
      .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
      .replace(/'(?:[^'\\]|\\.)*'/g, "''") // 单引号字符串
      .replace(/"(?:[^"\\]|\\.)*"/g, '""') // 双引号字符串
    for (const id of stripped.matchAll(/\$[A-Za-z_\u4e00-\u9fa5][\w$]*/g)) {
      problems.push(wxml + ': WXS 代码中出现 `$` 标识符 -> ' + id[0])
    }

    // 5. WXS 中不得使用 `new Date()` / `new RegExp()`
    //    官方《WXS 语法参考》要求用 getDate() / getRegExp() 创建；
    //    基础类库中 Date 只有 parse/UTC/now，无构造函数。
    for (const ctor of stripped.matchAll(/new\s+(Date|RegExp)\s*\(/g)) {
      problems.push(
        wxml +
          ': WXS 中不支持 new ' +
          ctor[1] +
          '()，应使用 ' +
          (ctor[1] === 'Date' ? 'getDate()' : 'getRegExp()'),
      )
    }

    // 6. WXS 语言未支持的语法（语句仅 if/switch/for/while，函数仅 function）
    //    这些构造若进入 WXS，小程序无法解析整个 wxs 块。
    for (const [name, re] of WXS_UNSUPPORTED) {
      if (re.test(stripped)) problems.push(wxml + ': WXS 中使用了不支持的语法 -> ' + name)
    }

    // 7. WXS 基础类库中没有的全局函数。
    //    官方《WXS 语法参考 · 基础类库》的 Global 方法仅有：
    //      parseInt / parseFloat / isNaN / isFinite /
    //      decodeURI / decodeURIComponent / encodeURI / encodeURIComponent
    //    String 与 Boolean **不在其中**；实测它们会静默渲染为空值。
    //    编译器应已改写为 '' + x / !!x；此处校验结果。
    for (const [fn, hint] of [
      ['String', "应改写为 '' + x"],
      ['Boolean', '应改写为 !!x'],
    ]) {
      if (new RegExp('(?<![\\w.$])' + fn + '\\s*\\(').test(stripped)) {
        problems.push(wxml + ': WXS 中使用了不可用的全局函数 ' + fn + '() -> ' + hint)
      }
    }
  }
}

// 3c. WXSS 中不得残留 Vue scoped-CSS 专有语法
//     `:deep()` / `::v-deep()` / `:slotted()` / `:global()` 是 Vue 的语法，
//     WXSS 不支持——微信开发者工具会**丢弃整条规则**，样式静默失效。
//     编译器应已展开 `:deep()` 并剥掉 scoped 属性选择器；此处校验结果。
const wxssFiles = files.filter((f) => f.endsWith('.wxss') && inScope(f))
const VUE_ONLY_CSS = [
  [':deep(', ':deep() 应被展开为具体选择器'],
  ['::v-deep(', '::v-deep() 应被展开为具体选择器'],
  [':slotted(', ':slotted() 在 WXSS 中不支持'],
  ['::v-slotted(', '::v-slotted() 在 WXSS 中不支持'],
  [':global(', ':global() 在 WXSS 中不支持'],
]
for (const wxss of wxssFiles) {
  const css = fs.readFileSync(wxss, 'utf8')
  stats.wxssFiles = (stats.wxssFiles || 0) + 1
  for (const [needle, hint] of VUE_ONLY_CSS) {
    if (css.includes(needle)) problems.push(wxss + ': 残留 Vue 专有语法 ' + needle + ') -> ' + hint)
  }
  // 残留的 scoped 属性选择器（形如 [data-v-xxxx]）
  if (/\[data-v-[\w]+\]/.test(css)) {
    problems.push(wxss + ': 残留 scoped 属性选择器 [data-v-*]，WXSS 中无效')
  }
}

// 3d. 源码 ↔ 产物映射完整性（需 --src）
//      - 每个 .vue 必须产出完整四件套（.js/.wxml/.wxss/.json）
//      - 产物中的 .js/.wxml/.wxss/.json 都应能追溯到某个源文件（无孤儿产物）
//     这能抓出"漏编译"与"源文件删除后产物残留"两类问题。
if (srcRoot && fs.existsSync(srcRoot)) {
  const relOut = files.map((f) => path.relative(path.resolve(root), f))
  const outSet = new Set(relOut)

  // 递归收集源码相对路径
  const collect = (dir, base = '') => {
    const acc = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? base + '/' + entry.name : entry.name
      if (entry.isDirectory()) acc.push(...collect(path.join(dir, entry.name), rel))
      else acc.push(rel)
    }
    return acc
  }
  const srcFiles = collect(srcRoot)
  const srcSet = new Set(srcFiles)

  const QUARTET = ['.js', '.wxml', '.wxss', '.json']
  for (const f of srcFiles) {
    if (!f.endsWith('.vue')) continue
    stats.vueQuartets = (stats.vueQuartets || 0) + 1
    const base = f.slice(0, -'.vue'.length)
    const missing = QUARTET.filter((e) => !outSet.has(base + e))
    if (missing.length) {
      problems.push(srcRoot + '/' + f + ': .vue 未产出完整四件套，缺少 ' + missing.join('/'))
    }
  }

  for (const rel of relOut) {
    if (!/\.(js|wxml|wxss|json)$/.test(rel)) continue
    if (rel.startsWith('miniprogram_npm/') || rel.startsWith('polyfill/')) continue
    // 生成文件（非源码一一对应）
    if (rel === 'project.config.json' || rel === 'sitemap.json') continue
    const base = rel.replace(/\.(js|wxml|wxss|json)$/, '')
    const traced =
      srcSet.has(rel) ||
      srcSet.has(base + '.vue') ||
      srcSet.has(base + '.ts') ||
      srcSet.has(base + '.js') ||
      srcSet.has(base + '.wxml') ||
      srcSet.has(base + '.wxss') ||
      srcSet.has(base + '.json')
    if (!traced) problems.push(rel + ': 产物无对应源文件（可能为残留）')
  }
}

// 4. usingComponents 路径可解析
for (const jsonFile of jsonFiles) {
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
  } catch (e) {
    problems.push(jsonFile + ': JSON 解析失败 -> ' + e.message)
    continue
  }
  const using = cfg.usingComponents || {}
  const base = path.dirname(jsonFile)
  for (const [name, target] of Object.entries(using)) {
    stats.components++
    let resolved
    if (target.startsWith('/')) resolved = path.join(root, target)
    else if (target.startsWith('.')) resolved = path.resolve(base, target)
    else resolved = path.join(root, 'miniprogram_npm', target)
    const ok =
      fs.existsSync(resolved + '.json') ||
      fs.existsSync(path.join(resolved, path.basename(resolved) + '.json'))
    if (!ok) problems.push(jsonFile + ': 组件 ' + name + ' 路径无法解析 -> ' + target)
  }
}

// 5. VMS 生成的 .js 必须是**合法 JavaScript**（纯 JS 语法，不含 TS 语法）
//    这是独立的一层：产物可能"看起来对"但含残留 TS 语法（如 as 断言、
//    类型注解、泛型调用），会导致小程序**整个模块无法加载**。
//    注意：只检查非第三方产物；miniprogram_npm 为 npm 原样拷贝。
const jsFiles = files.filter((f) => f.endsWith('.js') && !isThirdParty(f))
for (const jsFile of jsFiles) {
  const code = fs.readFileSync(jsFile, 'utf8')
  // 仅检查 VMS 生成的组件/页面文件（含 defineComponent 调用）
  if (!code.includes('defineComponent')) continue
  stats.jsFiles++
  try {
    // 用 Node 自身解析（等价于纯 JS 语法检查，不启用 TS）
    new Function(code.replace(/^\s*"use strict";?\s*/, ''))
  } catch (e) {
    // new Function 会把 import/export 视为语法错误，故仅在出现模块语法时跳过
    if (/\b(import|export)\b/.test(code) === false) {
      problems.push(jsFile + ': VMS 产物不是合法 JavaScript -> ' + e.message.slice(0, 80))
    }
  }
}

// 只校验 VMS 编译产物（.vue → 四件套）。
// 原生四件套由 VMS 原样复制，其 WXML/JS 的既有缺陷不属于编译器问题，
// 因此按"是否存在同名 .vue 源文件"无法判断——这里统一对全部非第三方产物
// 报告，由使用者结合源文件归属判断。
console.log('扫描文件:', files.length, '| wxml:', wxmlFiles.length, '| json:', jsonFiles.length)
console.log(
  '检查项: 事件绑定',
  stats.bindings,
  '| WXS 调用',
  stats.wxsCalls,
  '| 组件引用',
  stats.components,
  '| data-* 索引',
  stats.dataAttrs,
  '| JS 合法性检查',
  stats.jsFiles,
  '| WXML 结构检查',
  stats.wxmlStructure,
  '| WXML 表达式检查',
  stats.wxmlExpression,
  '| WXSS 语法检查',
  stats.wxssFiles || 0,
  '| .vue 四件套',
  stats.vueQuartets || 0,
)
if (problems.length) {
  console.log('\n发现', problems.length, '个问题:')
  for (const p of problems.slice(0, 30)) console.log('  -', p)
  if (problems.length > 30) console.log('  ... 其余', problems.length - 30, '条已省略')
  // 注意：原生四件套（非 .vue）由 VMS 原样复制，其既有缺陷会被一并报告，
  // 因此默认只报告、不阻断；--strict 供 CI 在清理完存量问题后启用。
  if (strict) process.exit(1)
  console.log('\n（非 strict 模式：仅报告，不阻断）')
  process.exit(0)
}
console.log('\n产物一致性校验通过')
