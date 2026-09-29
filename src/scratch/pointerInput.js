// Native Pointer Events binder (no Pixi federated events): one captured
// pointer at a time, getBoundingClientRect-scaled coordinates, full abort
// surface for cancel / blur / multi-touch.
export function bindPointerInput(canvas, handlers) {
  let activePointerId = null
  let lastPoint = null

  const toCssPoint = (event) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  const onPointerDown = (event) => {
    if (activePointerId !== null) return // second finger ignored
    if (event.button !== undefined && event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    const point = toCssPoint(event)
    if (!point) return
    activePointerId = event.pointerId
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // capture best-effort; move still works within bounds
    }
    lastPoint = null
    handlers.onStart?.(point)
    lastPoint = point
  }

  const onPointerMove = (event) => {
    if (event.pointerId !== activePointerId) return
    const point = toCssPoint(event)
    if (!point) return
    handlers.onMove?.(point, lastPoint)
    lastPoint = point
  }

  const finishPointer = (event, canceled) => {
    if (event.pointerId !== activePointerId) return
    try {
      canvas.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    activePointerId = null
    lastPoint = null
    handlers.onEnd?.(canceled)
  }

  const onPointerUp = (event) => finishPointer(event, false)
  const onPointerCancel = (event) => finishPointer(event, true)

  // Declared via style too; non-passive touchmove is the iOS backstop.
  const onTouchMove = (event) => {
    if (activePointerId !== null) event.preventDefault()
  }

  const abortStroke = () => {
    if (activePointerId === null) return
    activePointerId = null
    lastPoint = null
    handlers.onEnd?.(true)
  }
  const onWindowBlur = () => abortStroke()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') abortStroke()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    get active() {
      return activePointerId !== null
    },
    abort: abortStroke,
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
