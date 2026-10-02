/**
 * smoke-dev.mjs — dev 服务器冒烟（node 内置 fetch，无新增依赖）。
 * 用法：先起 npm run dev（可指定端口），再运行
 *   node src/scratch/tools/smoke-dev.mjs [baseURL]   默认 http://localhost:5173
 * 断言：首页 200 且引用 /src/main.js；/src/main.js 200 且含 mountScratchCard；
 *       /src/scratch/index.js 200 且导出 mountScratchCard。
 */
const base = process.argv[2] || 'http://localhost:5173'
let failures = 0

async function check(path, expect) {
  try {
    const res = await fetch(base + path)
    const body = await res.text()
    const okStatus = res.status === 200
    const okBody = expect.every((s) => body.includes(s))
    const ok = okStatus && okBody
    console.log(`${ok ? 'PASS' : 'FAIL'}  GET ${path} → ${res.status}，内容断言 ${okBody ? '通过' : '失败'}`)
    if (!ok) failures++
  } catch (err) {
    console.log(`FAIL  GET ${path} → ${err.message}`)
    failures++
  }
}

await check('/', ['/src/main.js'])
// dev 下 Vite 会把相对导入重写为绝对路径，故只断言稳定子串
await check('/src/main.js', ['mountScratchCard', 'scratch/index.js'])
await check('/src/scratch/index.js', ['mountScratchCard'])

console.log(failures ? `${failures} 项失败` : '冒烟全部通过')
process.exit(failures ? 1 : 0)
