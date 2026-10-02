/**
 * math.js — 纯函数工具，不依赖 PixiJS，可独立在控制台断言。
 */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

export const lerp = (a, b, t) => a + (b - a) * t

/** 两点中点 */
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** 两点距离 */
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * 渲染分辨率：devicePixelRatio 封顶 maxPixelRatio（默认 2）。
 * 3x 屏按 2x 采样，显存/读回开销可控，清晰度代价见 DESIGN.md §5.3。
 */
export function resolveDPR(maxPixelRatio) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return clamp(dpr, 1, maxPixelRatio)
}
