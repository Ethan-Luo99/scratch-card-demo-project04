/**
 * mountScratchCard.js — 命令式 API：装配、状态机、生命周期、幂等销毁。
 * 依赖方向单向向下（DESIGN.md §3.1）；pixi.js 在此动态 import（懒加载 chunk）。
 *
 * 状态机（DESIGN.md §3.4）：
 *   idle →(init 完成)→ ready ⇄ scratching →(阈值/手动)→ revealed（终态）
 *   destroy() 可从任意态进入 destroyed（幂等）。
 */
import { DEFAULT_OPTIONS } from './defaultOptions.js'
import { createStage, buildPrize } from './createStage.js'
import { createCoating } from './createCoating.js'
import { attachPointerInput } from './pointerInput.js'
import { createStroke, addPoint, endStroke, strokeCommands } from './stroke.js'
import { createHistory, pushStroke, popStroke, clearHistory, strokeCount } from './strokeHistory.js'
import { measureCoverage } from './coverage.js'
import { clamp, resolveDPR } from './math.js'
import { createSession, parseSession, buildStrokes } from './session.js'

const mounted = new WeakSet() // 重复挂载防护（HMR 叠加的根因防线，DESIGN.md §5 风险#4）

export function mountScratchCard(el, options = {}) {
  if (!el || typeof el.appendChild !== 'function') {
    throw new TypeError('mountScratchCard: el 必须是 DOM 元素')
  }
  if (mounted.has(el)) {
    throw new Error('mountScratchCard: 该容器已挂载刮刮卡（already mounted）')
  }
  mounted.add(el)

  const opts = { ...DEFAULT_OPTIONS, ...options }

  // ---- 内部状态 ----
  const state = {
    phase: 'idle', // idle | init | ready | revealed | destroyed
    logicalW: 0,
    logicalH: 0,
    resolution: 1,
    progress: 0,
    busy: false, // context lost / 重建中，忽略输入
    epoch: 0, // 逻辑世代号：reset 时递增，用于作废进行中的异步读回结果
    chainLocked: false, // 连锁揭晓预约锁（DESIGN.md §12.4）：true 时拒绝一切用户输入
  }
  const history = createHistory()
  let currentStroke = null
  let PIXI = null
  let app = null
  let canvas = null
  let prizeLayer = null
  let coating = null
  let detachInput = null
  let destroyed = false
  let resizeRaf = 0
  let measureScheduled = false
  let measuring = false
  let lastMeasureAt = 0
  let fadeTicker = null // 揭晓淡出动画的 ticker 回调（reset/destroy 时须摘除）

  const stats = { readbackMs: 0, readbackCount: 0, replayCount: 0 }

  let resolveReady
  let rejectReady
  const ready = new Promise((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })
  ready.catch(() => {}) // 未监听 ready 时不产生 unhandledrejection；调用方仍可自行 catch

  // ---- 无障碍（DESIGN.md §5 风险#6）----
  const a11y = { tabindex: false, role: false, label: false }
  if (!el.hasAttribute('tabindex')) {
    el.tabIndex = 0
    a11y.tabindex = true
  }
  if (!el.hasAttribute('role')) {
    el.setAttribute('role', 'button')
    a11y.role = true
  }
  if (!el.hasAttribute('aria-label')) {
    el.setAttribute('aria-label', '刮刮卡：刮开涂层查看奖品。按回车或空格直接揭晓，按 Ctrl+Z 撤销上一笔。')
    a11y.label = true
  }
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false }

  // ---- 尺寸 ----
  const measureHost = () => {
    // 布局尺寸（clientWidth/Height）：不受 CSS transform 影响。
    // 实测：getBoundingClientRect 含 transform，会把纯视觉缩放（scale(0.5)）
    // 误判为布局 resize 并错误重建 RT（见 DESIGN.md §4.6 回填）；display:none 时
    // clientWidth 同样为 0，不影响 0 尺寸等待逻辑。
    return { w: opts.width || el.clientWidth, h: opts.height || el.clientHeight }
  }

  const ro = new ResizeObserver(() => {
    if (destroyed) return
    if (state.phase === 'idle') {
      // 0 尺寸容器（如 display:none）：等首个非 0 尺寸再 init（DESIGN.md §5 风险#10）
      const { w, h } = measureHost()
      if (w > 0 && h > 0) init(w, h)
    } else if (state.phase === 'ready' || state.phase === 'revealed') {
      scheduleResize()
    }
  })
  ro.observe(el)

  // ---- 初始化 ----
  async function init(w, h) {
    if (state.phase !== 'idle' || destroyed) return
    state.phase = 'init'
    state.logicalW = w
    state.logicalH = h
    state.resolution = resolveDPR(opts.maxPixelRatio)
    try {
      PIXI = await import('pixi.js') // 懒加载：pixi 拆为独立异步 chunk
      if (destroyed) return
      const stage = await createStage(PIXI, el, {
        width: w,
        height: h,
        resolution: state.resolution,
        prize: opts.prize,
      })
      if (destroyed) {
        stage.app.destroy({ removeView: true }, { children: true })
        return
      }
      app = stage.app
      canvas = stage.canvas
      prizeLayer = stage.prizeLayer

      coating = createCoating(PIXI, app, {
        width: w,
        height: h,
        resolution: state.resolution,
        coating: opts.coating,
        brushSize: opts.brushSize,
      })
      await coating.init()
      if (destroyed) return
      app.stage.children[0].addChild(coating.sprite) // cardRoot 顶层：奖品之上

      detachInput = attachPointerInput(canvas, () => state.resolution, {
        onStrokeStart,
        onStrokeMove,
        onStrokeEnd,
      })
      canvas.addEventListener('webglcontextlost', onContextLost)
      canvas.addEventListener('webglcontextrestored', onContextRestored)

      state.phase = 'ready'
      opts.onReady?.()
      resolveReady()
    } catch (err) {
      if (!destroyed) {
        opts.onError?.(err)
        rejectReady(err)
      }
    }
  }

  // ---- 刮擦输入 ----
  function onStrokeStart(x, y) {
    if (state.phase !== 'ready' || state.busy || state.chainLocked) return
    currentStroke = createStroke()
    const cmd = addPoint(currentStroke, clamp(x, 0, state.logicalW), clamp(y, 0, state.logicalH))
    coating.erase([cmd])
    scheduleCoverage()
  }

  function onStrokeMove(x, y) {
    if (!currentStroke || state.phase !== 'ready' || state.busy || state.chainLocked) return
    // 卡外坐标 clamp 到边界：沿边滑动不断线，且不结束笔画（DESIGN.md §4.5）
    const cmd = addPoint(currentStroke, clamp(x, 0, state.logicalW), clamp(y, 0, state.logicalH))
    coating.erase([cmd])
    scheduleCoverage()
  }

  function onStrokeEnd() {
    // 连锁预约/状态切换期间笔事件落进来：整笔丢弃，绝不入栈
    if (!currentStroke || state.phase !== 'ready' || state.busy || state.chainLocked) {
      currentStroke = null
      return
    }
    const tail = endStroke(currentStroke)
    if (tail) coating.erase([tail])
    pushStroke(history, currentStroke)
    currentStroke = null
    requestMeasure() // 一笔提交后读回一次（空闲调度，不在 move 热路径）
  }

  // ---- 覆盖率：节流 + 空闲调度（DESIGN.md §4.7 策略 1+2+3）----
  function scheduleCoverage() {
    if (performance.now() - lastMeasureAt < opts.coverageInterval) return
    requestMeasure()
  }

  function requestMeasure() {
    if (measureScheduled || measuring) return
    measureScheduled = true
    const run = () => {
      measureScheduled = false
      doMeasure()
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 })
    else setTimeout(run, 0)
  }

  async function doMeasure() {
    if (state.phase !== 'ready' || state.revealed || destroyed) return
    measuring = true
    lastMeasureAt = performance.now()
    const epoch = state.epoch
    try {
      const { ratio, ms } = await measureCoverage(app.renderer, coating.rt, {
        resolution: opts.coverageResolution,
        stride: opts.coverageStride,
      })
      // 读回 await 期间发生 reset/重建：结果基于旧 RT，直接作废，
      // 否则陈旧比例可能在 reset 后立刻误触发 reveal（DESIGN.md §11.2）
      if (destroyed || epoch !== state.epoch) return
      stats.readbackMs = ms
      stats.readbackCount++
      state.progress = ratio
      opts.onProgress?.(ratio)
      if (opts.revealOnThreshold && ratio >= opts.threshold) reveal('threshold')
    } catch {
      /* 读回失败（如 context 刚丢失）忽略本次，等待下次调度 */
    } finally {
      measuring = false
    }
  }

  // ---- 重放（undo / context lost / resize 共用）----
  function replayAll() {
    const cmds = []
    for (const s of history.strokes) cmds.push(...strokeCommands(s))
    coating.replay(cmds)
    stats.replayCount++
  }

  // ---- 撤销 ----
  function undo() {
    if (state.phase !== 'ready' || state.busy || state.chainLocked || destroyed) return false
    const s = popStroke(history)
    if (!s) return false
    replayAll() // 清 RT 重放剩余笔画；撤到空栈 = 涂层 100% 复原，不触发揭晓
    requestMeasure()
    return true
  }

  // ---- 揭晓（一次性终态）----
  function reveal(reason, silent = false) {
    if (state.phase !== 'ready' || destroyed) return
    state.phase = 'revealed'
    currentStroke = null
    const sprite = coating.sprite
    const finish = () => {
      sprite.visible = false
      fadeTicker = null
    }
    if (reducedMotion.matches || opts.revealFadeMs <= 0) {
      sprite.alpha = 0
      finish() // prefers-reduced-motion：取消淡出，立即揭开（DESIGN.md §5 风险#5）
    } else {
      const fade = (ticker) => {
        sprite.alpha -= ticker.deltaMS / opts.revealFadeMs
        if (sprite.alpha <= 0) {
          app.ticker.remove(fade)
          sprite.alpha = 0
          finish()
        }
      }
      fadeTicker = fade
      app.ticker.add(fade)
    }
    state.progress = 1
    if (!silent) {
      opts.onReveal?.(reason) // 状态机保证只触发一次；连锁演示（silent）不触发 onReveal
    }
    opts.onProgress?.(1) // progress 反映真实覆盖率状态，演示揭晓同样上报
  }

  // ---- 复位（revealed → ready，DESIGN.md §11.2）----
  function reset() {
    if (state.phase !== 'revealed' || destroyed) return false
    state.epoch++ // 作废进行中的覆盖率读回（竞态①：陈旧比例误触发揭晓）
    state.chainLocked = false // 释放可能存在的连锁预约/演示锁（DESIGN.md §12.4）
    clearHistory(history) // 笔画栈清空
    currentStroke = null
    // 竞态②：淡出动画进行中 reset——先摘 ticker 再复原 alpha，
    // 否则旧 ticker 继续递减会把涂层卡在半透明
    if (fadeTicker && app) {
      app.ticker.remove(fadeTicker)
      fadeTicker = null
    }
    const sprite = coating.sprite
    sprite.alpha = 1
    sprite.visible = true
    coating.replay([]) // 涂层 100% 重建：重铺底图、零笔画
    state.progress = 0
    state.phase = 'ready' // onReveal 复位：threshold 可再次触发
    return true
  }

  // ---- 会话序列化 / 重放（DESIGN.md §11.3）----
  function exportSession() {
    if (destroyed) {
      throw new Error('exportSession: 卡片已销毁')
    }
    if (state.phase === 'idle' || state.phase === 'init' || !(state.logicalW > 0)) {
      throw new Error('exportSession: 卡片尚未就绪（逻辑尺寸未知），无一致快照可导出')
    }
    // 原子性（DESIGN.md §12.2）：有一笔正在刮时显式失败，绝不导出半笔。
    // 进行中的读回/淡出只写 progress 与 sprite.alpha（均不入快照），无需等待、
    // 不阻塞链路；快照读取的 history/logicalW/H 在同步执行期间不可能被交错改写。
    if (currentStroke) {
      throw new Error('exportSession: 有一笔尚未提交，请在 pointerup 后导出')
    }
    return createSession(opts, state, history)
  }

  function replaySession(data) {
    if (state.phase !== 'ready' || state.busy || state.chainLocked || destroyed) return false
    const session = parseSession(data) // v1 入口无损升级 v2；非法数据抛错（显式失败）
    // 归一化坐标 → 本卡当前逻辑尺寸（录制基准 → 目标尺寸的线性仿射映射）
    for (const stroke of buildStrokes(session, state.logicalW, state.logicalH)) {
      pushStroke(history, stroke)
      // 与实时刮擦共用同一套点→命令推导，逐笔增量擦除：
      // 之后 undo 弹栈重放剩余笔画，与「少一笔数据直接回放」逐命令一致
      coating.erase(strokeCommands(stroke))
    }
    requestMeasure()
    return true
  }

  // ---- resize（窗口/旋转/地址栏，rAF 合帧）----
  function scheduleResize() {
    if (resizeRaf) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0
      const { w, h } = measureHost()
      const res = resolveDPR(opts.maxPixelRatio)
      const sizeChanged = Math.abs(w - state.logicalW) > 0.5 || Math.abs(h - state.logicalH) > 0.5
      if (w > 0 && h > 0 && (sizeChanged || res !== state.resolution)) resize(w, h)
    })
  }

  async function resize(w, h) {
    if ((state.phase !== 'ready' && state.phase !== 'revealed') || destroyed) return
    const sx = state.logicalW ? w / state.logicalW : 1
    const sy = state.logicalH ? h / state.logicalH : 1
    state.logicalW = w
    state.logicalH = h
    state.resolution = resolveDPR(opts.maxPixelRatio)
    state.busy = true
    // 坐标映射必须在首个 await 之前同步完成（DESIGN.md §12.2）：
    // 否则 await 期间 exportSession 会读到「新尺寸 + 旧像素坐标」的撕裂快照
    for (const s of history.strokes) {
      for (const p of s.points) {
        p.x *= sx
        p.y *= sy
      }
    }
    try {
      app.renderer.resize(w, h, state.resolution)
      await coating.resize(w, h, state.resolution)
      if (destroyed) return
      await buildPrize(PIXI, prizeLayer, opts.prize, w, h)
      replayAll()
      if (state.phase === 'ready') requestMeasure()
    } finally {
      state.busy = false
    }
  }

  // ---- WebGL context lost / restored（DESIGN.md §5 风险#1）----
  function onContextLost() {
    state.busy = true // 挂起输入，等待恢复
  }
  function onContextRestored() {
    // Pixi 自动重建托管 GPU 资源；自管 RT 内容 = 重铺底图 + 笔画重放
    state.busy = false
    if (state.phase === 'ready' || state.phase === 'revealed') {
      replayAll()
      if (state.phase === 'ready') requestMeasure()
    }
  }

  // ---- 键盘 ----
  function onKeydown(e) {
    if (destroyed) return
    if (e.key === 'Enter' || e.key === ' ') {
      if (state.chainLocked) return // 连锁预约期间键盘揭晓同样拒绝
      e.preventDefault()
      reveal('manual')
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (state.chainLocked) return
      e.preventDefault()
      undo()
    }
  }
  el.addEventListener('keydown', onKeydown)

  // ---- 销毁（幂等）----
  function destroy() {
    if (destroyed) return
    destroyed = true
    state.phase = 'destroyed'
    state.chainLocked = false // 组级连锁定时器由 group 侧清理；此处仅解除自身输入锁
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    if (fadeTicker && app) {
      app.ticker.remove(fadeTicker)
      fadeTicker = null
    }
    ro.disconnect()
    el.removeEventListener('keydown', onKeydown)
    if (detachInput) detachInput()
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
    }
    if (coating) coating.destroy()
    if (app) {
      app.destroy(
        { removeView: true },
        { children: true, texture: true, textureSource: true, context: true }
      )
    }
    if (a11y.tabindex) el.removeAttribute('tabindex')
    if (a11y.role) el.removeAttribute('role')
    if (a11y.label) el.removeAttribute('aria-label')
    if (el.__scratchCard === handle) delete el.__scratchCard
    mounted.delete(el)
    app = null
    canvas = null
    coating = null
    currentStroke = null
  }

  // ---- 对外句柄（DESIGN.md §3.3）----
  const handle = {
    ready,
    reveal: () => reveal('manual'),
    undo,
    reset,
    exportSession,
    replaySession,
    /**
      * 组级连锁内部原语（DESIGN.md §12.4，下划线前缀=非业务 API，仅 group 调用）：
      * _chainArm() 预约锁定：仅 ready 卡可预约，立即拒绝之后的全部用户输入；
      * _chainPlay() 到点执行：reset 清卡 + 静默 reveal（不触发 onReveal），幂等。
      */
    _chainArm() {
      if (destroyed || state.busy || state.chainLocked || state.phase !== 'ready') {
        return false
      }
      state.chainLocked = true
      return true
    },
    _chainPlay() {
      if (destroyed) return
      state.chainLocked = true // 保险：即便未经过 arm（理论不会发生）也拒绝输入
      reset() // revealed→ready；ready 卡调用返回 false 也不影响后续 reveal
      reveal('chain', true) // silent：演示揭晓，不触发 onReveal（状态机一次性保证）
    },
    getProgress: () => state.progress,
    resize: (w, h) => {
      if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
        opts.width = w
        opts.height = h
        resize(w, h)
      } else {
        scheduleResize()
      }
    },
    destroy,
    /** 诊断（测试/调试用，非业务 API）：只读快照 */
    diagnostics: () => ({
      phase: state.phase,
      strokes: strokeCount(history),
      progress: state.progress,
      resolution: state.resolution,
      logicalWidth: state.logicalW,
      logicalHeight: state.logicalH,
      coatingVisible: coating ? coating.sprite.visible : null,
      readbackMs: stats.readbackMs,
      readbackCount: stats.readbackCount,
      replayCount: stats.replayCount,
    }),
  }
  el.__scratchCard = handle // 可测试性挂钩（DESIGN.md §3.3 已记录）；destroy 时移除

  // ---- 启动：尺寸有效即初始化，否则等 ResizeObserver 首个非 0 尺寸 ----
  const { w, h } = measureHost()
  if (w > 0 && h > 0) init(w, h)
  return handle
}
