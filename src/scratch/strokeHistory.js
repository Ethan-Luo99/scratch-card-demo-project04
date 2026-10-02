/**
 * strokeHistory.js — 笔画级命令栈（DESIGN.md §4.4）。
 * 只存纯点数据（体量小）；撤销 = 弹栈 + 清 RT 重放剩余笔画，零额外显存。
 */
export function createHistory() {
  return { strokes: [] }
}

export function pushStroke(history, stroke) {
  history.strokes.push(stroke)
}

export function popStroke(history) {
  return history.strokes.pop() || null
}

export function clearHistory(history) {
  history.strokes.length = 0
}

export function strokeCount(history) {
  return history.strokes.length
}
