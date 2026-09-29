export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function resolveResolution(maxPixelRatio) {
  const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1
  return clamp(dpr, 1, maxPixelRatio)
}

export function idleCallback(task) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => task(), { timeout: 300 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(task, 1)
  return () => clearTimeout(id)
}
