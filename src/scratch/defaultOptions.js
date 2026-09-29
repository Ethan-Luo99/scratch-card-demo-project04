export const DEFAULT_OPTIONS = Object.freeze({
  width: undefined,
  height: undefined,
  threshold: 0.7,
  brushSize: 26,
  maxPixelRatio: 2,
  prize: undefined,
  coating: '#b8b8c4',
  revealOnThreshold: true,
  coverageResolution: 0.5,
  coverageStride: 4,
  coverageThrottleMs: 200,
  fadeDurationMs: 400,
  onProgress: undefined,
  onReveal: undefined,
  onReady: undefined,
  onError: undefined,
})

export function resolveOptions(options = {}) {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  resolved.threshold = clampNumber(resolved.threshold, 0, 1, 0.7)
  resolved.brushSize = Math.max(1, Number(resolved.brushSize) || 26)
  resolved.maxPixelRatio = Math.max(1, Number(resolved.maxPixelRatio) || 2)
  resolved.coverageResolution = Math.max(
    0.1,
    Number(resolved.coverageResolution) || 0.5,
  )
  resolved.coverageStride = Math.max(1, Math.round(resolved.coverageStride) || 4)
  resolved.coverageThrottleMs = Math.max(0, Number(resolved.coverageThrottleMs) || 200)
  resolved.fadeDurationMs = Math.max(0, Number(resolved.fadeDurationMs) || 400)
  return resolved
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n < min ? min : n > max ? max : n
}
