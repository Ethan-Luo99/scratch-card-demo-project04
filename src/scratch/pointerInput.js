/**
 * pointerInput.js — 原生 Pointer Events 绑定、坐标换算、异常输入收口
 * （DESIGN.md §4.1 / §4.2 / §4.5）。
 *
 * 坐标链路（四段换算，以 canvas 盒模型为基准，禁用 offsetX/offsetY）：
 *   ① r = canvas.getBoundingClientRect()   CSS 缩放后的真实显示盒
 *   ② cssX = clientX - r.left              视口坐标 → 元素内显示坐标
 *   ③ k = canvas.width / r.width / res     实测缩放比（吸收 DPR + CSS transform）归一到逻辑坐标
 *   ④ x = cssX * k                         舞台/RT 逻辑坐标（CSS px）
 * 无 CSS 缩放时 k≡1；有 transform 时自动补偿，笔迹不偏移。
 *
 * 异常收口：pointer capture 保证划出边界不断线；只跟踪捕获指针（多指忽略）；
 * pointercancel / 窗口失焦 / 页面隐藏 → 提交当前笔。
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {() => number} getResolution 当前渲染分辨率（DPR 封顶后）
 * @param {object} handlers { onStrokeStart(x,y), onStrokeMove(x,y), onStrokeEnd() }
 * @returns {() => void} detach 解绑全部监听
 */
export function attachPointerInput(canvas, getResolution, handlers) {
  let activeId = null

  const toLogical = (e) => {
    const r = canvas.getBoundingClientRect()
    const res = getResolution() || 1
    const kx = r.width ? canvas.width / r.width / res : 1
    const ky = r.height ? canvas.height / r.height / res : 1
    return { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * ky }
  }

  function onPointerDown(e) {
    if (activeId !== null) return // 多指：只跟踪已捕获指针
    if (e.pointerType === 'mouse' && e.button !== 0) return
    activeId = e.pointerId
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件/旧浏览器无活动指针时忽略 */
    }
    const p = toLogical(e)
    handlers.onStrokeStart(p.x, p.y)
    if (e.cancelable) e.preventDefault() // 阻止文本选择/兼容鼠标事件；滚动由 touch-action 收口
  }

  function onPointerMove(e) {
    if (e.pointerId !== activeId) return
    const p = toLogical(e)
    handlers.onStrokeMove(p.x, p.y)
  }

  function endStroke(e) {
    if (e.pointerId !== activeId) return
    activeId = null
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* 同上 */
    }
    handlers.onStrokeEnd() // pointerup / pointercancel 均视为提交当前笔
  }

  function onWindowBlur() {
    if (activeId === null) return
    activeId = null
    handlers.onStrokeEnd() // 失焦：提交当前笔，避免切回后「悬空一笔」
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') onWindowBlur()
  }

  // iOS 旧版 Safari 双保险：canvas 自身非 passive 监听，按刮期间阻止滚动
  function onTouchMove(e) {
    if (activeId !== null && e.cancelable) e.preventDefault()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', endStroke)
  canvas.addEventListener('pointercancel', endStroke)
  canvas.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibility)

  return function detach() {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', endStroke)
    canvas.removeEventListener('pointercancel', endStroke)
    canvas.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('blur', onWindowBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    activeId = null
  }
}
