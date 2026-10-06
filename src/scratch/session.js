/**
 * session.js — 会话序列化 / 反序列化（DESIGN.md §11.3）。
 * 纯数据、纯逻辑，不 import PixiJS；导出数据保证可 JSON.stringify。
 *
 * 数据格式（version: 1）：
 *   {
 *     version: 1,
 *     card: { width, height, threshold, brushSize, revealOnThreshold, coating, prize },
 *     progress: number,
 *     strokes: [ [{x, y}, ...], ... ]   // 每笔 = 点序列（与 strokeHistory 同构）
 *   }
 * 配置项只保留可序列化子集：回调函数、PIXI.Texture 等运行时对象一律不落盘
 * （coating/prize 仅在 string/number 时导出，否则为 null）。
 */

export const SESSION_VERSION = 1

/**
 * 由运行中卡片状态构造会话数据（纯函数，深拷贝点数据，与卡内状态解耦）。
 * @param {object} opts 合并后的卡片配置
 * @param {object} state 卡片内部状态（取 logicalW/logicalH/progress）
 * @param {object} history 笔画栈（{ strokes: [{ points: [{x,y}] }] }）
 */
export function serializeSession(opts, state, history) {
  const serializable = (v) => typeof v === 'string' || typeof v === 'number'
  return {
    version: SESSION_VERSION,
    card: {
      width: state.logicalW,
      height: state.logicalH,
      threshold: opts.threshold,
      brushSize: opts.brushSize,
      revealOnThreshold: opts.revealOnThreshold,
      coating: serializable(opts.coating) ? opts.coating : null,
      prize: typeof opts.prize === 'string' ? opts.prize : null,
    },
    progress: state.progress,
    strokes: history.strokes.map((s) => s.points.map((p) => ({ x: p.x, y: p.y }))),
  }
}

/**
 * 校验并规范化会话数据；非法数据抛 TypeError（版本不符 / 结构残缺 / 点坐标非有限数）。
 * @returns {{ strokes: [{ points: [{x:number, y:number}] }] }}
 */
export function validateSession(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('replaySession: data 必须是对象')
  }
  if (data.version !== SESSION_VERSION) {
    throw new TypeError(
      `replaySession: 不支持的会话格式版本 ${data.version}（当前 ${SESSION_VERSION}）`
    )
  }
  if (!Array.isArray(data.strokes)) {
    throw new TypeError('replaySession: data.strokes 必须是数组')
  }
  const strokes = data.strokes.map((s, i) => {
    const pts = Array.isArray(s) ? s : s && s.points
    if (!Array.isArray(pts)) {
      throw new TypeError(`replaySession: 第 ${i} 笔不是点数组`)
    }
    const points = pts.map((p, j) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw new TypeError(`replaySession: 第 ${i} 笔第 ${j} 个点坐标非法`)
      }
      return { x: p.x, y: p.y }
    })
    return { points }
  })
  return { strokes }
}
