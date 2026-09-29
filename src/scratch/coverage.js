import { idleCallback } from './math.js'

// Reads the coating RenderTexture at reduced resolution and samples the alpha
// channel on a coarse grid. WebGL readPixels returns rows bottom-up, but the
// coverage ratio is row-order independent.
export function measureCoverage(renderer, renderTexture, resolution, stride) {
  const { pixels, width, height } = renderer.extract.pixels({
    target: renderTexture,
    resolution,
  })
  let covered = 0
  let counted = 0
  for (let y = 0; y < height; y += stride) {
    const rowBase = y * width
    for (let x = 0; x < width; x += stride) {
      counted += 1
      if (pixels[(rowBase + x) * 4 + 3] > 16) covered += 1
    }
  }
  return {
    clearedRatio: counted === 0 ? 0 : 1 - covered / counted,
    samples: counted,
    width,
    height,
  }
}

// Schedules at most one readback per throttle interval, always outside the
// interaction frame (requestIdleCallback when available).
export class CoverageScheduler {
  constructor({ renderer, renderTextureProvider, resolution, stride, throttleMs, onResult }) {
    this._renderer = renderer
    this._renderTextureProvider = renderTextureProvider
    this._resolution = resolution
    this._stride = stride
    this._throttleMs = throttleMs
    this._onResult = onResult
    this._running = false
    this._scheduled = false
    this._cancelIdle = null
    this._lastRunAt = 0
    this._timer = 0
  }

  request() {
    if (this._scheduled || this._running) return
    this._scheduled = true
    const elapsed = Date.now() - this._lastRunAt
    const wait = Math.max(0, this._throttleMs - elapsed)
    this._timer = setTimeout(() => {
      this._cancelIdle = idleCallback(() => this._run())
    }, wait)
  }

  // Runs immediately (still off the pointermove path: only used after a stroke
  // commits and for undo), cancelling any pending run.
  runNow() {
    this._cancelPending()
    this._run()
  }

  _cancelPending() {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = 0
    }
    if (this._cancelIdle) {
      this._cancelIdle()
      this._cancelIdle = null
    }
    this._scheduled = false
  }

  async _run() {
    this._timer = 0
    this._cancelIdle = null
    this._scheduled = false
    if (this._running) return
    const target = this._renderTextureProvider()
    if (!target) return
    this._running = true
    let result
    try {
      result = measureCoverage(
        this._renderer,
        target,
        this._resolution,
        this._stride,
      )
      this._lastRunAt = Date.now()
    } finally {
      this._running = false
    }
    this._onResult?.(result)
  }

  destroy() {
    this._cancelPending()
    this._onResult = null
    this._renderer = null
    this._renderTextureProvider = null
  }
}
