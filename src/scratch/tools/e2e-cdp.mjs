/**
 * e2e-cdp.mjs — 无头 Chromium + CDP 端到端自测（无测试框架、无新增依赖）。
 * 用法：node src/scratch/tools/e2e-cdp.mjs
 * 覆盖 DESIGN.md §7.1 验收场景与「待验证」实测项；结果打印到 stdout。
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CHROME =
  process.env.CHROME_BIN ||
  '/home/ethan_luo/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const DEV_PORT = 5312
const APP = `http://localhost:${DEV_PORT}/`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// 无头 Chromium 的系统库（libnss3/libnspr4/libasound 等）在本机以解包形式存在于 /tmp；
// 自动探测并注入 LD_LIBRARY_PATH（不修改系统）
import { existsSync } from 'node:fs'
const LIB_DIRS = [
  '/tmp/chromelibs/root/usr/lib/x86_64-linux-gnu',
  '/tmp/debs2/root/usr/lib/x86_64-linux-gnu',
  '/tmp/cdp/libs/usr/lib/x86_64-linux-gnu',
  '/tmp/debs/extracted/usr/lib/x86_64-linux-gnu',
]
const chromeLibDir = LIB_DIRS.find((d) => existsSync(join(d, 'libnss3.so')))
const chromeEnv = chromeLibDir
  ? { ...process.env, LD_LIBRARY_PATH: `${chromeLibDir}:${process.env.LD_LIBRARY_PATH || ''}` }
  : process.env

/* ---------------- CDP 客户端（node 内置 WebSocket） ---------------- */
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
        }
      } else if (msg.method) {
        const key = `${msg.sessionId || ''}:${msg.method}`
        ;(this.handlers.get(key) || []).forEach((cb) => cb(msg.params))
      }
    })
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => resolve(new CDP(ws)))
      ws.addEventListener('error', (e) => reject(new Error('CDP ws error: ' + e.message)))
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(method, cb, sessionId = '') {
    const key = `${sessionId}:${method}`
    if (!this.handlers.has(key)) this.handlers.set(key, [])
    this.handlers.get(key).push(cb)
  }
  waitEvent(method, sessionId = '', timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待事件超时: ${method}`)), timeout)
      this.on(method, (params) => {
        clearTimeout(timer)
        resolve(params)
      }, sessionId)
    })
  }
}

/* ---------------- 进程启动 ---------------- */
async function startVite() {
  const proc = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(DEV_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stderr.on('data', () => {})
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(APP)
      if (res.status === 200) return proc
    } catch {}
    await sleep(300)
  }
  throw new Error('vite dev 服务器启动超时')
}

async function startChrome() {
  const proc = spawn(
    CHROME,
    [
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--js-flags=--expose-gc',
      `--user-data-dir=/tmp/scratch-e2e-profile-${process.pid}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: chromeEnv }
  )
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('chrome DevTools ws 超时\n' + buf)), 20000)
    proc.stderr.on('data', (d) => {
      buf += d
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    proc.on('exit', () => reject(new Error('chrome 提前退出\n' + buf)))
  })
  return { proc, wsUrl }
}

/* ---------------- 页面侧辅助函数（注入） ---------------- */
const PAGE_HELPERS = `
window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms))
window.__cards = []
window.__mountCard = async (opts = {}, hostStyle = 'width:320px;height:180px;', awaitReady = true) => {
  const { mountScratchCard } = await import('/src/scratch/index.js')
  const host = document.createElement('div')
  host.style.cssText = hostStyle
  document.body.appendChild(host)
  const reveals = []
  const progressLog = []
  const errors = []
  const handle = mountScratchCard(host, {
    ...opts,
    onReveal: (r) => { reveals.push(r); if (opts.onReveal) opts.onReveal(r) },
    onProgress: (p) => { progressLog.push(p); if (opts.onProgress) opts.onProgress(p) },
    onError: (e) => { errors.push(String(e)); if (opts.onError) opts.onError(e) },
  })
  const card = { host, handle, reveals, progressLog, errors }
  window.__cards.push(card)
  if (awaitReady) await handle.ready
  return window.__cards.length - 1
}
window.__fireLogical = (host, type, lx, ly, id = 1) => {
  const canvas = host.querySelector('canvas')
  const d = host.__scratchCard.diagnostics()
  const r = canvas.getBoundingClientRect()
  const sx = d.logicalWidth ? r.width / d.logicalWidth : 1
  const sy = d.logicalHeight ? r.height / d.logicalHeight : 1
  canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: r.left + lx * sx, clientY: r.top + ly * sy,
    bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
    button: 0, buttons: (type === 'pointerup' || type === 'pointercancel') ? 0 : 1,
  }))
}
window.__stroke = (host, pts, id = 1) => {
  window.__fireLogical(host, 'pointerdown', pts[0][0], pts[0][1], id)
  for (let i = 1; i < pts.length; i++) window.__fireLogical(host, 'pointermove', pts[i][0], pts[i][1], id)
  window.__fireLogical(host, 'pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], id)
}
window.__strokeCancel = (host, pts, id = 1) => {
  window.__fireLogical(host, 'pointerdown', pts[0][0], pts[0][1], id)
  for (let i = 1; i < pts.length; i++) window.__fireLogical(host, 'pointermove', pts[i][0], pts[i][1], id)
  window.__fireLogical(host, 'pointercancel', pts[pts.length - 1][0], pts[pts.length - 1][1], id)
}
window.__strips = (host, x0, x1, step = 20) => {
  for (let x = x0; x <= x1; x += step) window.__stroke(host, [[x, 2], [x, 60], [x, 120], [x, 178]])
}
`

/* ---------------- 场景 ---------------- */

async function run() {
  console.log('== 启动 vite dev 与无头 Chromium ==')
  const vite = await startVite()
  const { proc: chrome, wsUrl } = await startChrome()
  const mainPath = join(ROOT, 'src/main.js')
  const mainOriginal = readFileSync(mainPath, 'utf8')
  const consoleErrors = []

  let browser
  try {
    browser = await CDP.connect(wsUrl)
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const S = sessionId
    await browser.send('Page.enable', {}, S)
    await browser.send('Runtime.enable', {}, S)
    browser.on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push('exception: ' + JSON.stringify(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text).slice(0, 200))
    }, S)
    browser.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push('console.error: ' + JSON.stringify(p.args?.map((a) => a.value ?? a.description)).slice(0, 200))
    }, S)

    const evaluate = async (expression) => {
      const res = await Promise.race([
        browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, S),
        sleep(60000).then(() => {
          throw new Error('evaluate 超时（60s）')
        }),
      ])
      if (res.exceptionDetails) {
        throw new Error('页面执行异常: ' + JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text).slice(0, 300))
      }
      return res.result.value
    }

    const loaded = browser.waitEvent('Page.loadEventFired', S, 20000)
    await browser.send('Page.navigate', { url: APP }, S)
    await loaded
    await evaluate(PAGE_HELPERS)

    /* ---- T0 预检：WebGL2 可用 ---- */
    const preflight = await evaluate(`(() => {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2')
      return { webgl2: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null, dpr: window.devicePixelRatio }
    })()`)
    record('T0 预检: WebGL2 可用', preflight.webgl2, `${preflight.renderer} dpr=${preflight.dpr}`)
    if (!preflight.webgl2) throw new Error('无 WebGL2，无法继续')

    /* ---- T1 主挂载：单 canvas、ready、ARIA、DPR 封顶 ---- */
    const t1 = await evaluate(`(async () => {
      const host = document.querySelector('#scratch-card')
      const handle = host && host.__scratchCard
      if (!handle) return { ok: false, why: 'handle 不存在' }
      await handle.ready
      const d = handle.diagnostics()
      return {
        ok: true,
        canvases: document.querySelectorAll('canvas').length,
        phase: d.phase,
        resolution: d.resolution,
        dpr: window.devicePixelRatio,
        tabindex: host.getAttribute('tabindex'),
        role: host.getAttribute('role'),
        aria: !!host.getAttribute('aria-label'),
        canvasCssW: host.querySelector('canvas').clientWidth,
      }
    })()`)
    record('T1 主挂载: 单 canvas + ready', t1.ok && t1.canvases === 1 && t1.phase === 'ready',
      `canvases=${t1.canvases} phase=${t1.phase} canvasW=${t1.canvasCssW}`)
    record('T1b DPR 封顶 maxPixelRatio=2', t1.resolution === Math.min(t1.dpr, 2),
      `resolution=${t1.resolution} dpr=${t1.dpr}`)
    record('T1c 无障碍属性', t1.tabindex === '0' && t1.role === 'button' && t1.aria,
      `tabindex=${t1.tabindex} role=${t1.role} aria-label=${t1.aria}`)

    /* ---- T2 慢涂（密集点）---- */
    const t2 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      const pts = []
      for (let x = 40; x <= 280; x += 4) pts.push([x, 90])
      __stroke(c.host, pts)
      await __sleep(900)
      const d = c.handle.diagnostics()
      return { progress: d.progress, strokes: d.strokes, readbackMs: d.readbackMs }
    })()`)
    record('T2 慢涂: 覆盖增长且一笔入栈', t2.progress > 0.05 && t2.strokes === 1,
      `progress=${t2.progress.toFixed(3)} strokes=${t2.strokes} readback=${t2.readbackMs.toFixed(1)}ms`)

    /* ---- T3 快划（2 点大跳）连续性：面积须接近线段扫描面积 ---- */
    const t3 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __stroke(c.host, [[30, 90], [290, 90]])
      await __sleep(900)
      return { progress: c.handle.diagnostics().progress }
    })()`)
    // 期望 ≈ (260×26 + π·13²) / 57600 ≈ 0.127；断点（仅圆点）则 ≈ 0.018
    record('T3 快划无断点（面积连续性）', t3.progress > 0.08 && t3.progress < 0.18,
      `progress=${t3.progress.toFixed(3)} 期望≈0.127（断点则≈0.018）`)

    /* ---- T4 沿卡片边缘滑动不断线 ---- */
    const t4 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __stroke(c.host, [[5, 3], [120, 2], [240, 2], [315, 3], [318, 90], [315, 177]])
      await __sleep(900)
      return { progress: c.handle.diagnostics().progress }
    })()`)
    record('T4 沿边滑动不断线', t4.progress > 0.03, `progress=${t4.progress.toFixed(3)}`)

    /* ---- T5 undo 逐笔回退，撤光 100% 复原且不触发揭晓 ---- */
    const t5 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __stroke(c.host, [[40, 40], [120, 40]])
      __stroke(c.host, [[40, 90], [120, 90]])
      __stroke(c.host, [[40, 140], [120, 140]])
      await __sleep(900)
      const before = c.handle.diagnostics()
      const u1 = c.handle.undo()
      const u2 = c.handle.undo()
      await __sleep(300)
      const mid = c.handle.diagnostics()
      const u3 = c.handle.undo()
      const u4 = c.handle.undo() // 空栈应返回 false
      await __sleep(900)
      const after = c.handle.diagnostics()
      return { before: before.progress, strokesBefore: before.strokes,
               u1, u2, u3, u4, strokesMid: mid.strokes,
               after: after.progress, strokesAfter: after.strokes,
               reveals: c.reveals.length, coatingVisible: after.coatingVisible }
    })()`)
    record('T5 undo 逐笔回退', t5.u1 && t5.u2 && t5.u3 && !t5.u4 && t5.strokesBefore === 3 && t5.strokesMid === 1,
      `strokes 3→1→0, undo 返回 ${t5.u1},${t5.u2},${t5.u3},${t5.u4}`)
    record('T5b 撤光后 100% 复原且不触发揭晓',
      t5.after <= 0.03 && t5.reveals === 0 && t5.strokesAfter === 0 && t5.coatingVisible === true,
      `progress=${t5.after.toFixed(3)} reveals=${t5.reveals} coatingVisible=${t5.coatingVisible}`)

    /* ---- T6 手动揭晓：一次性、reason 正确、揭晓后输入忽略 ---- */
    const t6 = await evaluate(`(async () => {
      const i = await __mountCard({ revealFadeMs: 0 })
      const c = __cards[i]
      __stroke(c.host, [[40, 90], [120, 90]])
      await __sleep(700)
      c.handle.reveal()
      c.handle.reveal() // 重复调用应被忽略
      await __sleep(200)
      const afterReveal = c.handle.diagnostics()
      __stroke(c.host, [[40, 40], [280, 40]]) // 揭晓后输入应被忽略
      const undoRet = c.handle.undo()          // 揭晓后 undo 应被拒绝
      await __sleep(400)
      const d = c.handle.diagnostics()
      return { reveals: c.reveals, phase: d.phase, coatingVisible: d.coatingVisible,
               progress: d.progress, strokes: d.strokes, undoRet, afterRevealStrokes: afterReveal.strokes }
    })()`)
    record('T6 手动揭晓一次性 + reason=manual',
      t6.reveals.length === 1 && t6.reveals[0] === 'manual' && t6.phase === 'revealed' && t6.coatingVisible === false,
      `reveals=${JSON.stringify(t6.reveals)} phase=${t6.phase} coatingVisible=${t6.coatingVisible}`)
    record('T6b 揭晓后输入全部忽略', t6.strokes === t6.afterRevealStrokes && t6.undoRet === false && t6.progress === 1,
      `strokes=${t6.strokes} undo=${t6.undoRet} progress=${t6.progress}`)

    /* ---- T7 阈值自动揭开：只触发一次；改 threshold 行为变化 ---- */
    const t7 = await evaluate(`(async () => {
      const i1 = await __mountCard({ threshold: 0.3 })
      const c1 = __cards[i1]
      __strips(c1.host, 0, 140) // ~覆盖 45%
      await __sleep(1200)
      const r1 = { reveals: c1.reveals, phase: c1.handle.diagnostics().phase }
      __stroke(c1.host, [[10, 10], [60, 10]]) // 揭晓后再涂
      await __sleep(400)
      r1.revealsAfter = c1.reveals.length
      const i2 = await __mountCard({ threshold: 0.9 })
      const c2 = __cards[i2]
      __strips(c2.host, 0, 140) // 同样 ~45%，不应触发
      await __sleep(1200)
      const r2 = { reveals: c2.reveals, phase: c2.handle.diagnostics().phase, progress: c2.handle.diagnostics().progress }
      return { r1, r2 }
    })()`)
    record('T7 阈值 0.3 自动揭开且仅一次',
      t7.r1.reveals.length === 1 && t7.r1.reveals[0] === 'threshold' && t7.r1.phase === 'revealed' && t7.r1.revealsAfter === 1,
      `reveals=${JSON.stringify(t7.r1.reveals)} phase=${t7.r1.phase}`)
    record('T7b 同动作 threshold=0.9 不揭开（阈值可配置）',
      t7.r2.reveals.length === 0 && t7.r2.phase === 'ready' && t7.r2.progress > 0.3,
      `reveals=${t7.r2.reveals.length} phase=${t7.r2.phase} progress=${t7.r2.progress.toFixed(3)}`)

    /* ---- T8 display:none 挂载再显示 ---- */
    const t8 = await evaluate(`(async () => {
      const i = await __mountCard({}, 'display:none;width:300px;height:160px;', false)
      const c = __cards[i]
      await __sleep(400)
      const whileHidden = { phase: c.handle.diagnostics().phase, canvas: !!c.host.querySelector('canvas') }
      c.host.style.display = 'block'
      await __sleep(1000)
      const d = c.handle.diagnostics()
      __stroke(c.host, [[30, 80], [270, 80]])
      await __sleep(900)
      return { whileHidden, phase: d.phase, canvas: !!c.host.querySelector('canvas'),
               w: d.logicalWidth, h: d.logicalHeight, cssW: c.host.querySelector('canvas').clientWidth,
               progress: c.handle.diagnostics().progress }
    })()`)
    record('T8 display:none 挂载：延迟初始化', t8.whileHidden.phase === 'idle' && !t8.whileHidden.canvas,
      `隐藏时 phase=${t8.whileHidden.phase} canvas=${t8.whileHidden.canvas}`)
    record('T8b 显示后自动初始化且尺寸正确、可刮',
      t8.phase === 'ready' && t8.canvas && t8.w === 300 && t8.h === 160 && t8.cssW === 300 && t8.progress > 0.05,
      `phase=${t8.phase} ${t8.w}x${t8.h} cssW=${t8.cssW} progress=${t8.progress.toFixed(3)}`)

    /* ---- T9 WebGL context lost → 恢复后重放 ---- */
    const t9 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __stroke(c.host, [[40, 60], [280, 60]])
      __stroke(c.host, [[40, 120], [280, 120]])
      await __sleep(900)
      const before = c.handle.diagnostics()
      const canvas = c.host.querySelector('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const ext = gl.getExtension('WEBGL_lose_context')
      if (!ext) return { skip: true }
      ext.loseContext()
      await __sleep(400)
      ext.restoreContext()
      await __sleep(1200)
      const after = c.handle.diagnostics()
      __stroke(c.host, [[40, 90], [280, 90]]) // 恢复后可继续刮
      await __sleep(900)
      const final = c.handle.diagnostics()
      return { skip: false, before: before.progress, after: after.progress,
               replays: after.replayCount, final: final.progress, strokes: final.strokes }
    })()`)
    if (t9.skip) {
      record('T9 context lost 重放', true, '跳过：WEBGL_lose_context 不可用')
    } else {
      record('T9 context lost 后已刮内容正确重放',
        Math.abs(t9.after - t9.before) < 0.06 && t9.before > 0.1 && t9.replays >= 1,
        `lost前=${t9.before.toFixed(3)} 恢复后=${t9.after.toFixed(3)} replays=${t9.replays}`)
      record('T9b 恢复后可继续刮', t9.final > t9.after && t9.strokes === 3,
        `final=${t9.final.toFixed(3)} strokes=${t9.strokes}`)
    }

    /* ---- T10 键盘：Enter 揭晓 / Ctrl+Z 撤销 ---- */
    const t10 = await evaluate(`(async () => {
      const i1 = await __mountCard({ revealFadeMs: 0 })
      const c1 = __cards[i1]
      c1.host.focus()
      c1.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await __sleep(200)
      const r1 = { reveals: c1.reveals, phase: c1.handle.diagnostics().phase }
      const i2 = await __mountCard()
      const c2 = __cards[i2]
      __stroke(c2.host, [[40, 90], [200, 90]])
      await __sleep(800)
      c2.host.focus()
      c2.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      await __sleep(800)
      const r2 = { strokes: c2.handle.diagnostics().strokes, progress: c2.handle.diagnostics().progress }
      return { r1, r2 }
    })()`)
    record('T10 键盘 Enter 揭晓', t10.r1.reveals.length === 1 && t10.r1.reveals[0] === 'manual',
      `reveals=${JSON.stringify(t10.r1.reveals)}`)
    record('T10b 键盘 Ctrl+Z 撤销', t10.r2.strokes === 0 && t10.r2.progress <= 0.03,
      `strokes=${t10.r2.strokes} progress=${t10.r2.progress.toFixed(3)}`)

    /* ---- T11 prefers-reduced-motion：取消淡出 ---- */
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, S)
    const t11a = await evaluate(`(async () => {
      const i = await __mountCard({ revealFadeMs: 300 })
      const c = __cards[i]
      c.handle.reveal()
      await __sleep(60) // 淡出若存在则 300ms 内仍可见
      return { visible: c.handle.diagnostics().coatingVisible }
    })()`)
    record('T11 reduced-motion 下立即揭开（无淡出）', t11a.visible === false,
      `reveal 后 60ms coatingVisible=${t11a.visible}`)
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, S)
    const t11b = await evaluate(`(async () => {
      const i = await __mountCard({ revealFadeMs: 300 })
      const c = __cards[i]
      c.handle.reveal()
      await __sleep(60)
      const during = c.handle.diagnostics().coatingVisible
      await __sleep(700)
      const after = c.handle.diagnostics().coatingVisible
      return { during, after }
    })()`)
    record('T11b 正常模式有淡出过程', t11b.during === true && t11b.after === false,
      `淡出中 visible=${t11b.during} 完成后=${t11b.after}`)

    /* ---- T12 多点触控：只跟踪捕获指针 ---- */
    const t12 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __fireLogical(c.host, 'pointerdown', 50, 90, 1)
      __fireLogical(c.host, 'pointermove', 100, 90, 1)
      __fireLogical(c.host, 'pointerdown', 300, 90, 2)   // 第二指：应被忽略
      __fireLogical(c.host, 'pointermove', 300, 10, 2)   // 应被忽略
      __fireLogical(c.host, 'pointermove', 150, 90, 1)
      __fireLogical(c.host, 'pointerup', 150, 90, 1)
      await __sleep(900)
      const d = c.handle.diagnostics()
      return { progress: d.progress, strokes: d.strokes }
    })()`)
    // 仅第一指 50→150 的线段 ≈ (100×26+caps)/57600 ≈ 0.054；若第二指生效会显著更大
    record('T12 多点触控只跟踪捕获指针', t12.progress > 0.02 && t12.progress < 0.09 && t12.strokes === 1,
      `progress=${t12.progress.toFixed(3)} strokes=${t12.strokes}`)

    /* ---- T13 pointercancel / 窗口失焦：提交当前笔 ---- */
    const t13 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __strokeCancel(c.host, [[40, 60], [160, 60]])
      await __sleep(200)
      __fireLogical(c.host, 'pointerdown', 40, 120, 1)
      __fireLogical(c.host, 'pointermove', 160, 120, 1)
      window.dispatchEvent(new Event('blur')) // 失焦：提交当前笔
      await __sleep(900)
      const d = c.handle.diagnostics()
      return { strokes: d.strokes, progress: d.progress }
    })()`)
    record('T13 pointercancel + 失焦均提交当前笔', t13.strokes === 2 && t13.progress > 0.05,
      `strokes=${t13.strokes} progress=${t13.progress.toFixed(3)}`)

    /* ---- T14 读回耗时实测（回填 DESIGN §7.2）---- */
    const t14 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      const samples = []
      for (let k = 0; k < 8; k++) {
        __stroke(c.host, [[30 + k * 30, 40], [30 + k * 30, 140]])
        await __sleep(700)
        samples.push(c.handle.diagnostics().readbackMs)
      }
      const d = c.handle.diagnostics()
      return { samples, count: d.readbackCount, w: d.logicalWidth, h: d.logicalHeight, res: d.resolution }
    })()`)
    const rbMax = Math.max(...t14.samples)
    const rbAvg = t14.samples.reduce((a, b) => a + b, 0) / t14.samples.length
    record('T14 覆盖率读回不在热路径且耗时可接受', rbMax < 100,
      `读回耗时 avg=${rbAvg.toFixed(1)}ms max=${rbMax.toFixed(1)}ms（${t14.w}x${t14.h}@res${t14.res}，软件渲染）`)
    console.log(`MEASURE readback-ms: avg=${rbAvg.toFixed(2)} max=${rbMax.toFixed(2)} samples=[${t14.samples.map((s) => s.toFixed(1)).join(',')}]`)

    /* ---- T15 抽样误差桌面端标定（回填 DESIGN §8.4）---- */
    const t15 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __strips(c.host, 0, 160) // 左半
      await __sleep(1200)
      const half = c.handle.diagnostics().progress
      __strips(c.host, 180, 320) // 补满（步进 20：160 已画，从 180 起）
      await __sleep(1200)
      const full = c.handle.diagnostics().progress
      return { half, full }
    })()`)
    // 左半真实覆盖 ≈ [0, 160+13]/320 ≈ 0.540（笔刷半径 13 外溢）
    const halfTrue = 173 / 320
    const halfErr = Math.abs(t15.half - halfTrue)
    record('T15 抽样标定：半屏测量误差 ≤5%', halfErr <= 0.05,
      `测量=${t15.half.toFixed(3)} 真实≈${halfTrue.toFixed(3)} 误差=${(halfErr * 100).toFixed(1)}%`)
    record('T15b 全刮测量 ≥0.98', t15.full >= 0.98, `full=${t15.full.toFixed(3)}`)
    console.log(`MEASURE sampling: half measured=${t15.half.toFixed(4)} true≈${halfTrue.toFixed(4)} err=${(halfErr * 100).toFixed(2)}% full=${t15.full.toFixed(4)}`)

    /* ---- T16 CSS transform 下坐标不偏移（§4.1 四段换算）---- */
    const t16 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      c.host.style.transform = 'scale(0.5)'
      c.host.style.transformOrigin = '0 0'
      await __sleep(300)
      __strips(c.host, 0, 160) // 逻辑左半（__fireLogical 已按实测缩放比换算 client 坐标）
      await __sleep(1200)
      const half = c.handle.diagnostics().progress
      c.host.style.transform = ''
      return { half }
    })()`)
    record('T16 transform scale(0.5) 下刮左半 ≈ 0.5（无偏移）', Math.abs(t16.half - halfTrue) <= 0.06,
      `测量=${t16.half.toFixed(3)} 期望≈${halfTrue.toFixed(3)}`)

    /* ---- T17 容器 resize：RT 重建 + 笔画重放 ---- */
    const t17 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      __stroke(c.host, [[40, 90], [200, 90]])
      await __sleep(800)
      const before = c.handle.diagnostics()
      c.host.style.width = '400px'
      await __sleep(1200)
      const d = c.handle.diagnostics()
      __stroke(c.host, [[40, 45], [360, 45]])
      await __sleep(900)
      const after = c.handle.diagnostics()
      return { w: d.logicalWidth, cssW: c.host.querySelector('canvas').clientWidth,
               progressKept: d.progress, before: before.progress, final: after.progress, strokes: after.strokes }
    })()`)
    record('T17 resize 后尺寸正确、笔画保留、可继续刮',
      t17.w === 400 && t17.cssW === 400 && t17.progressKept > 0.03 && t17.final > t17.progressKept && t17.strokes === 2,
      `resize→${t17.w}px(css ${t17.cssW}) 保留=${t17.progressKept.toFixed(3)} 续刮=${t17.final.toFixed(3)}`)

    /* ---- T18 DPR 3x 封顶 2（§8.5 桌面模拟）---- */
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 3, mobile: false }, S)
    const t18 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      const d = c.handle.diagnostics()
      __stroke(c.host, [[40, 90], [280, 90]])
      await __sleep(900)
      const progress = c.handle.diagnostics().progress
      c.handle.destroy()
      c.host.remove()
      return { dpr: window.devicePixelRatio, resolution: d.resolution, progress }
    })()`)
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, S)
    record('T18 3x 屏 DPR 封顶 2 且可正常刮擦', t18.dpr === 3 && t18.resolution === 2 && t18.progress > 0.05,
      `dpr=${t18.dpr} resolution=${t18.resolution} progress=${t18.progress.toFixed(3)}`)
    console.log(`MEASURE dpr-cap: deviceScaleFactor=3 → resolution=${t18.resolution}`)

    /* ---- T19 幂等 destroy / 重复挂载防护 / 销毁后可重挂载 ---- */
    const t19 = await evaluate(`(async () => {
      const i = await __mountCard()
      const c = __cards[i]
      const n0 = document.querySelectorAll('canvas').length
      c.handle.destroy()
      c.handle.destroy() // 幂等：第二次不抛错
      const afterDestroy = {
        canvasInHost: !!c.host.querySelector('canvas'),
        hook: '__scratchCard' in c.host,
        tabindex: c.host.hasAttribute('tabindex'),
      }
      let guardThrew = false
      const i2 = await __mountCard() // 新 host；先验证重复挂载抛错
      const c2 = __cards[i2]
      const { mountScratchCard } = await import('/src/scratch/index.js')
      try { mountScratchCard(c2.host) } catch (e) { guardThrew = /already mounted/.test(e.message) }
      c2.handle.destroy()
      // 销毁后可重挂载
      let remountOk = false
      try {
        const h = mountScratchCard(c.host)
        await h.ready
        remountOk = h.diagnostics().phase === 'ready'
        h.destroy()
      } catch (e) { remountOk = 'err:' + e.message }
      c.host.remove(); c2.host.remove()
      const n1 = document.querySelectorAll('canvas').length
      return { afterDestroy, guardThrew, remountOk, n0, n1 }
    })()`)
    record('T19 幂等 destroy（解绑+移除 canvas+清挂钩）',
      t19.afterDestroy.canvasInHost === false && t19.afterDestroy.hook === false && t19.afterDestroy.tabindex === false,
      JSON.stringify(t19.afterDestroy))
    record('T19b 重复挂载抛错 + 销毁后可重挂载', t19.guardThrew === true && t19.remountOk === true,
      `guard=${t19.guardThrew} remount=${t19.remountOk}`)

    /* ---- T20 长稳：反复 挂载/刮/撤销/揭晓/销毁，堆内存无单调增长 ---- */
    const t20 = await evaluate(`(async () => {
      if (!performance.memory || !window.gc) return { skip: true }
      window.gc()
      await __sleep(100)
      const before = performance.memory.usedJSHeapSize
      for (let k = 0; k < 15; k++) {
        const i = await __mountCard({ revealFadeMs: 0 })
        const c = __cards[i]
        __strips(c.host, 0, 300, 30)
        await __sleep(30)
        for (let u = 0; u < 12; u++) c.handle.undo()
        c.handle.reveal()
        c.handle.destroy()
        c.host.remove()
      }
      window.gc()
      await __sleep(100)
      const after = performance.memory.usedJSHeapSize
      return { skip: false, before, after, deltaMB: (after - before) / 1048576 }
    })()`)
    if (t20.skip) {
      record('T20 长稳内存（15 轮 mount/scratch/undo/reveal/destroy）', true, '跳过：performance.memory/gc 不可用')
    } else {
      record('T20 长稳内存（15 轮 mount/scratch/undo/reveal/destroy）', t20.deltaMB < 30,
        `堆增长 ${t20.deltaMB.toFixed(2)} MB（GC 后）`)
      console.log(`MEASURE heap: before=${(t20.before / 1048576).toFixed(2)}MB after=${(t20.after / 1048576).toFixed(2)}MB delta=${t20.deltaMB.toFixed(2)}MB`)
    }

    /* ---- T21 HMR：反复保存 main.js，单 canvas、counter 不翻倍 ---- */
    let hmrOk = true
    let hmrDetail = []
    for (let k = 1; k <= 3; k++) {
      writeFileSync(mainPath, mainOriginal + `\n// hmr-probe-${k}\n`)
      await sleep(1500)
      const r = await evaluate(`(() => {
        const canvases = document.querySelectorAll('canvas').length
        const btn = document.querySelector('#counter')
        const before = btn.textContent
        btn.click(); btn.click()
        return { canvases, before, after: btn.textContent }
      })()`)
      const ok = r.canvases === 1 && r.before === 'Count is 0' && r.after === 'Count is 2'
      hmrOk = hmrOk && ok
      hmrDetail.push(`#${k}: canvas=${r.canvases} "${r.before}"→"${r.after}"`)
    }
    writeFileSync(mainPath, mainOriginal)
    record('T21 HMR 反复保存：单 canvas 且 counter 不翻倍', hmrOk, hmrDetail.join(' | '))

    /* ---- 页面错误收口 ---- */
    record('T22 全程无未捕获异常/console 错误', consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' ; ') || '无')
  } finally {
    writeFileSync(mainPath, mainOriginal) // 任何情况下恢复 main.js
    try { browser?.ws.close() } catch {}
    chrome.kill('SIGKILL')
    vite.kill('SIGKILL')
  }
}

const watchdog = setTimeout(() => {
  console.error('全局超时，强制退出')
  process.exit(2)
}, 300000)

run()
  .then(() => {
    clearTimeout(watchdog)
    const failed = results.filter((r) => !r.ok)
    console.log(`\n== 结果: ${results.length - failed.length}/${results.length} 通过 ==`)
    process.exit(failed.length ? 1 : 0)
  })
  .catch((err) => {
    clearTimeout(watchdog)
    console.error('E2E 运行失败:', err.message)
    process.exit(2)
  })
