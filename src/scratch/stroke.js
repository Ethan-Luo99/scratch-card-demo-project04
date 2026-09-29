import { midpoint } from './math.js'

// One stroke = ordered raw points (CSS px at capture time) + the brush width
// captured at stroke start, so undo/resize replay is deterministic.
export class Stroke {
  constructor(brushSize) {
    this.brushSize = brushSize
    this.points = []
  }

  addPoint(x, y) {
    this.points.push({ x, y })
  }

  get size() {
    return this.points.length
  }

  scale(sx, sy) {
    const scaled = new Stroke(this.brushSize)
    scaled.points = this.points.map((p) => ({ x: p.x * sx, y: p.y * sy }))
    return scaled
  }

  // Full midpoint-quadratic smoothing path ending exactly at the last point.
  // Caller owns the Graphics style lifecycle; geometry uses fill dot + stroked
  // path so the first touch erases a filled disc and joins stay round.
  paintFull(graphics, sx = 1, sy = 1) {
    const pts = this.points
    if (pts.length === 0) return
    const p = (pt) => ({ x: pt.x * sx, y: pt.y * sy })
    const first = p(pts[0])
    graphics.circle(first.x, first.y, this.brushSize * 0.5).fill()
    if (pts.length < 2) return
    graphics.moveTo(first.x, first.y)
    for (let i = 1; i < pts.length - 1; i++) {
      const control = p(pts[i])
      const end = midpoint(control, p(pts[i + 1]))
      graphics.quadraticCurveTo(control.x, control.y, end.x, end.y)
    }
    const last = p(pts[pts.length - 1])
    graphics.quadraticCurveTo(last.x, last.y, last.x, last.y)
    graphics.stroke()
  }

  // Incremental segment rendered on every pointermove. Erase is idempotent:
  // the tail reaches the cursor, and overlapping segments merge seamlessly.
  paintIncrement(graphics, prevPoint, curPoint) {
    graphics.circle(curPoint.x, curPoint.y, this.brushSize * 0.5).fill()
    if (!prevPoint) return
    const mid = midpoint(prevPoint, curPoint)
    graphics
      .moveTo(prevPoint.x, prevPoint.y)
      .quadraticCurveTo(prevPoint.x, prevPoint.y, mid.x, mid.y)
      .quadraticCurveTo(curPoint.x, curPoint.y, curPoint.x, curPoint.y)
      .stroke()
  }
}
