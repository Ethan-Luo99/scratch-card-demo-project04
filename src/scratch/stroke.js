/**
 * stroke.js — 一笔的点序列与二次贝塞尔「中点法」平滑（DESIGN.md §4.3）。
 * 纯数据、纯逻辑，不 import PixiJS。
 *
 * 命令模型（交给渲染层解释）：
 *   { t:'dot',  x, y }                  圆点（起笔/收尾，半径=笔宽一半，圆头效果）
 *   { t:'quad', fx, fy, cx, cy, x, y }  从 (fx,fy) 以 (cx,cy) 为控制点到 (x,y) 的二次贝塞尔
 *   { t:'line', fx, fy, x, y }          收尾直线段（最后中点 → 终点，圆头线帽自动圆尾）
 *
 * 中点法：相邻两点的中点作为线段端点、原始点作为控制点，
 * 连续段在中点相接、斜率连续，快速划动无断点、无尖角。
 */
import { mid } from './math.js'

export function createStroke() {
  return { points: [] }
}

/** 第 i 个点对应的绘制命令（增量与重放共用同一推导，保证笔迹一致） */
function commandAt(pts, i) {
  if (i === 0) return { t: 'dot', x: pts[0].x, y: pts[0].y }
  const prev = pts[i - 1]
  const from = i === 1 ? prev : mid(pts[i - 2], prev)
  const to = mid(prev, pts[i])
  return { t: 'quad', fx: from.x, fy: from.y, cx: prev.x, cy: prev.y, x: to.x, y: to.y }
}

/** 追加一个点，返回本次需要增量绘制的命令（1 条） */
export function addPoint(stroke, x, y) {
  stroke.points.push({ x, y })
  return commandAt(stroke.points, stroke.points.length - 1)
}

/** 收尾：从最后中点连线到终点（中点法欠最后半段；圆头线帽使末端为圆尾） */
export function endStroke(stroke) {
  const pts = stroke.points
  const n = pts.length
  if (n < 2) return null
  const last = pts[pts.length - 1]
  const from = mid(pts[n - 2], last)
  return { t: 'line', fx: from.x, fy: from.y, x: last.x, y: last.y }
}

/** 重放用：由点序列重建整笔的全部命令（undo / context lost / resize 重放） */
export function strokeCommands(stroke) {
  const pts = stroke.points
  const cmds = pts.map((_, i) => commandAt(pts, i))
  const tail = endStroke(stroke)
  if (tail) cmds.push(tail)
  return cmds
}
