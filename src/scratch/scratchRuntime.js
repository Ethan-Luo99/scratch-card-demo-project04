import { Coating } from './createCoating.js'
import { CoverageScheduler } from './coverage.js'
import { resolveOptions } from './defaultOptions.js'
import { createStage, refitPrize } from './createStage.js'
import { bindPointerInput } from './pointerInput.js'
import { clamp, resolveResolution } from './math.js'
import { Stroke } from './stroke.js'
import { StrokeHistory } from './strokeHistory.js'

const mountedElements = new WeakSet()
const FALLBACK_CLASS = 'scratch-card-fallback'

export function mountScratchCardRuntime(el, options = {}) {
  if (!(el instanceof HTMLElement)) {
    throw new TypeError('mountScratchCard: el must be an HTMLElement')
  }
  if (mountedElements.has(el)) {
    throw new Error('mountScratchCard: element already has a scratch card mounted')
  }
  mountedElements.add(el)

  const opts = resolveOptions(options)
  const state = {
    destroyed: false,
    revealed: false,
    ready: false,
    suspended: false,
    width: 0,
    height: 0,
    resolution: resolveResolution(opts.maxPixelRatio),
    revealReason: null,
  }

  let stage = null
  let coating = null
  let input = null
  let resizeObserver = null
  let coverageScheduler = null
  let currentStroke = null
  let rafFrame = 0
  let resizeFrame = 0
  const history = new StrokeHistory()
  const listeners = new Set()

  el.setAttribute('tabindex', '0')
  el.setAttribute('role', 'img')
  el.setAttribute(
    'aria-label',
    '刮刮卡奖品。使用指针涂抹刮开涂层，按回车或空格一键揭晓，按 Ctrl 加 Z 撤销上一笔。',
  )

  const fallback = document.createElement('div')
  fallback.className = FALLBACK_CLASS
  fallback.hidden = true
  fallback.textContent = '🎁 奖品揭晓：点击查看'
  fallback.style.cssText =
    'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
    'min-height:120px;background:#ffd54a;color:#7a4b00;font-weight:700;cursor:pointer;' +
    'border-radius:12px;'
  fallback.addEventListener('click', () => finishReveal('manual'))

  function measureSize() {
    const rect = el.getBoundingClientRect()
    const width = Math.round(
      opts.width && opts.width > 0 ? opts.width : rect.width || 300,
    )
    const height = Math.round(
      opts.height && opts.height > 0 ? opts.height : rect.height || 160,
    )
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
      hasBox: rect.width > 0 && rect.height > 0,
    }
  }

  function paintStrokeFull(graphics, stroke) {
    stroke.paintFull(graphics)
  }

  function replayAll() {
    coating.rebuild(
      state.width,
      state.height,
      state.resolution,
      history,
      paintStrokeFull,
    )
    stage.render()
  }

  let readyResolve
  let readyReject
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  async function init(initialSize) {
    try {
      const { width, height } = initialSize
      state.width = width
      state.height = height
      stage = await createStage({
        el,
        width,
        height,
        resolution: state.resolution,
        prize: opts.prize,
      })
      coating = new Coating(stage.app.renderer, {
        width,
        height,
        resolution: state.resolution,
        coating: opts.coating,
        brushSize: opts.brushSize,
      })
      await coating.buildBase(width, height)
      stage.cardRoot.addChild(coating.sprite)
      coating.rebuild(width, height, state.resolution, history, paintStrokeFull)
      stage.render()

      coverageScheduler = new CoverageScheduler({
        renderer: stage.app.renderer,
        renderTextureProvider: () => coating?.renderTexture ?? null,
        resolution: opts.coverageResolution,
        stride: opts.coverageStride,
        throttleMs: opts.coverageThrottleMs,
        onResult: handleCoverage,
      })

      input = bindPointerInput(stage.canvas, {
        onStart: handleStrokeStart,
        onMove: handleStrokeMove,
        onEnd: handleStrokeEnd,
      })

      stage.canvas.addEventListener('webglcontextlost', onContextLost)
      stage.canvas.addEventListener('webglcontextrestored', onContextRestored)
      listeners.add(() => {
        stage?.canvas.removeEventListener('webglcontextlost', onContextLost)
        stage?.canvas.removeEventListener('webglcontextrestored', onContextRestored)
      })

      resizeObserver = new ResizeObserver(queueResize)
      resizeObserver.observe(el)

      el.addEventListener('keydown', onKeyDown)
      listeners.add(() => el.removeEventListener('keydown', onKeyDown))

      state.ready = true
      opts.onReady?.()
      readyResolve()
    } catch (err) {
      showFallback()
      opts.onError?.(err)
      readyReject(err)
    }
  }

  const starting = measureSize()
  if (starting.hasBox || (opts.width && opts.height)) {
    init(starting)
  } else {
    // 0-size container (e.g. display:none): wait for the first non-zero box.
    let attempts = 0
    const probe = () => {
      if (state.destroyed) return
      attempts += 1
      const size = measureSize()
      if (size.hasBox || attempts > 600) {
        init(size)
        return
      }
      requestAnimationFrame(probe)
    }
    requestAnimationFrame(probe)
  }

  function queueResize() {
    if (!state.ready || state.destroyed) {
      return
    }
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(applyResize)
  }

  function applyResize() {
    resizeFrame = 0
    if (state.destroyed || !stage || !coating) return
    const { width, height, hasBox } = measureSize()
    if (!hasBox && !(opts.width && opts.height)) return
    if (width === state.width && height === state.height) return
    const sx = width / state.width
    const sy = height / state.height
    state.width = width
    state.height = height
    state.resolution = resolveResolution(opts.maxPixelRatio)
    stage.resize(width, height, state.resolution)
    refitPrize(stage.prizeLayer, width, height)
    const scaled = history.mapScale(sx, sy)
    history.strokes = scaled.strokes
    replayAll()
  }

  function handleStrokeStart(point) {
    if (!state.ready || state.revealed || state.suspended || state.destroyed) return
    currentStroke = new Stroke(opts.brushSize)
    const p = clampPoint(point)
    currentStroke.addPoint(p.x, p.y)
    coating.eraseSegment(currentStroke, null, p)
    stage.render()
    scheduleCoverage()
  }

  function handleStrokeMove(point, prevPoint) {
    if (!currentStroke || state.revealed || state.suspended) return
    const p = clampPoint(point)
    currentStroke.addPoint(p.x, p.y)
    coating.eraseSegment(currentStroke, prevPoint ? clampPoint(prevPoint) : null, p)
    stage.render()
    scheduleCoverage()
  }

  function handleStrokeEnd(canceled) {
    if (!currentStroke) return
    const stroke = currentStroke
    currentStroke = null
    if (stroke.size > 0 && !state.revealed) {
      history.push(stroke)
      coverageScheduler?.runNow()
    }
  }

  function clampPoint(point) {
    return {
      x: clamp(point.x, 0, state.width),
      y: clamp(point.y, 0, state.height),
    }
  }

  let coverageTimer = 0
  function scheduleCoverage() {
    if (!opts.revealOnThreshold || state.revealed) return
    coverageScheduler?.request()
  }

  function handleCoverage(result) {
    if (state.destroyed) return
    latestProgress = result.clearedRatio
    opts.onProgress?.(result.clearedRatio)
    if (
      opts.revealOnThreshold &&
      !state.revealed &&
      result.clearedRatio >= opts.threshold
    ) {
      revealWithReason('threshold')
    }
  }

  function revealWithReason(reason) {
    if (state.revealed || state.destroyed) return
    state.revealed = true
    state.revealReason = reason
    currentStroke = null
    input?.abort()
    coverageScheduler?.destroy()
    coverageScheduler = null
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (coating && stage) {
      if (reduced || opts.fadeDurationMs === 0) {
        coating.sprite.visible = false
        stage.render()
        finishReveal(reason)
      } else {
        fadeCoating(() => finishReveal(reason))
      }
    } else {
      finishReveal(reason)
    }
  }

  function fadeCoating(done) {
    const duration = opts.fadeDurationMs
    const start = performance.now()
    const tick = (now) => {
      if (state.destroyed) return
      const t = clamp((now - start) / duration, 0, 1)
      coating.sprite.alpha = 1 - t
      stage.render()
      if (t < 1) {
        rafFrame = requestAnimationFrame(tick)
      } else {
        coating.sprite.visible = false
        stage.render()
        done()
      }
    }
    rafFrame = requestAnimationFrame(tick)
  }

  function finishReveal(reason) {
    if (state.destroyed) return
    if (fallback.isConnected) {
      fallback.hidden = false
      if (stage?.canvas) stage.canvas.style.display = 'none'
    }
    opts.onReveal?.(reason)
  }

  function showFallback() {
    if (!fallback.isConnected) el.appendChild(fallback)
    fallback.hidden = false
  }

  function onContextLost(event) {
    event.preventDefault?.()
    state.suspended = true
    currentStroke = null
  }

  function onContextRestored() {
    if (!stage || !coating) return
    state.suspended = false
    replayAll()
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      revealWithReason('manual')
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      undo()
    }
  }

  function undo() {
    if (state.destroyed || state.revealed || !state.ready) return false
    if (history.count === 0) return false
    history.pop()
    replayAll()
    return true
  }

  function reveal() {
    revealWithReason('manual')
  }

  let latestProgress = 0
  function getProgress() {
    return latestProgress
  }

  function destroy() {
    if (state.destroyed) return
    state.destroyed = true
    mountedElements.delete(el)
    if (rafFrame) cancelAnimationFrame(rafFrame)
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    if (coverageTimer) clearTimeout(coverageTimer)
    input?.destroy()
    resizeObserver?.disconnect()
    listeners.forEach((off) => off())
    listeners.clear()
    coverageScheduler?.destroy()
    coating?.destroy()
    if (stage) {
      try {
        stage.app.destroy(
          { removeView: true },
          {
            children: true,
            texture: true,
            textureSource: false,
            context: true,
          },
        )
      } catch (err) {
        console.warn('[scratch-card] app.destroy failed:', err)
      }
    }
    fallback.remove()
    el.removeAttribute('tabindex')
    el.removeAttribute('role')
    el.removeAttribute('aria-label')
    history.clear()
  }

  el.appendChild(fallback)

  return {
    ready: readyPromise,
    reveal,
    undo,
    getProgress,
    resize() {
      applyResize()
    },
    destroy,
  }
}
