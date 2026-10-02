/**
 * assert-dist.mjs — 对 npm run build 产物做断言（无测试框架，node 直接运行）：
 *   node src/scratch/tools/assert-dist.mjs
 *
 * 断言项：
 *   1. dist/index.html 只通过 <script type="module"> 加载入口 chunk，
 *      不以 script/modulepreload 形式引用 pixi chunk（即 pixi 不被首屏 eager 加载）。
 *   2. dist/assets 下存在且仅存在一个 pixi-*.js chunk（manualChunks 单块化）。
 *   3. pixi chunk 含 PixiJS 标记（"PixiJS" 与版本号 "8.21.0"），入口 chunk 不含。
 *   4. 入口 chunk 仅以动态 import() 引用 pixi chunk（懒加载），无静态 import。
 * 同时打印 raw/gzip/brotli 体积表（回填 DESIGN.md §1.3 用）。
 * 任一断言失败 → 退出码 1。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const dist = join(root, 'dist')
const assetsDir = join(dist, 'assets')

let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const assets = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))

// 入口 chunk：index.html 中 <script type="module" ... src="...">
const entryMatch = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+)"/)
check(!!entryMatch, 'index.html 引用了入口 chunk')
const entryFile = entryMatch?.[1]
const entrySrc = entryFile ? readFileSync(join(assetsDir, entryFile), 'utf8') : ''

// 1. HTML 不 eager 引用任何 pixi chunk
const pixiChunks = assets.filter((f) => /^pixi-.*\.js$/.test(f))
const htmlRefsPixi = pixiChunks.some((f) => html.includes(f))
check(!htmlRefsPixi, 'index.html 不以 script/modulepreload 引用 pixi chunk（首屏不加载）')

// 2. 恰好一个 pixi chunk
check(pixiChunks.length === 1, 'pixi.js 被拆为恰好一个独立 chunk', pixiChunks.join(',') || 'none')

// 3. 内容标记
const pixiSrc = pixiChunks.length ? readFileSync(join(assetsDir, pixiChunks[0]), 'utf8') : ''
check(pixiSrc.includes('PixiJS') && pixiSrc.includes('8.21.0'), 'pixi chunk 含 PixiJS 与 8.21.0 标记')
check(!entrySrc.includes('PixiJS'), '入口 chunk 不含 PixiJS 代码（已彻底拆分）')

// 4. 入口仅动态 import pixi chunk（懒加载），无静态引用
const pixiRef = pixiChunks[0]
const dynamicRef = pixiRef && entrySrc.includes(`import(\`./${pixiRef}\`)`)
const staticRef =
  pixiRef &&
  (entrySrc.includes(`from"./${pixiRef}"`) ||
    entrySrc.includes(`from"./${pixiRef}"`) ||
    new RegExp(`import"\\./${pixiRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(entrySrc))
check(!!dynamicRef, '入口 chunk 通过动态 import() 引用 pixi chunk（懒加载）')
check(!staticRef, '入口 chunk 无对 pixi chunk 的静态 import')

// 体积表
console.log('\n体积（raw / gzip / brotli）:')
let total = 0
for (const f of [entryFile, ...pixiChunks].filter(Boolean)) {
  const buf = readFileSync(join(assetsDir, f))
  const raw = statSync(join(assetsDir, f)).size
  const gz = gzipSync(buf).length
  const br = brotliCompressSync(buf).length
  total += raw
  console.log(
    `  ${f.padEnd(28)} ${(raw / 1024).toFixed(1).padStart(8)} kB / ${(gz / 1024)
      .toFixed(1)
      .padStart(7)} kB / ${(br / 1024).toFixed(1).padStart(7)} kB`
  )
}
console.log(`  JS 合计 raw ${(total / 1024).toFixed(1)} kB`)

console.log(failures ? `\n${failures} 项断言失败` : '\n全部断言通过')
process.exit(failures ? 1 : 0)
