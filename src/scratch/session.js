/**
 * session.js — 会话序列化 / 反序列化 / 重放数据构建（DESIGN.md §11.3）。
 * 纯数据、纯逻辑，不 import PixiJS；与 stroke.js 共用同一套点→命令推导，
 * 保证「重放结果」与「实时刮擦结果」逐命令一致（undo 等价性的根基）。
 *
 * 数据格式（可 JSON.stringify 的纯数据）：
 *   {
 *     version: 1,                        // 格式版本号，不兼容变更时递增
 *     options: { width, height, threshold, brushSize, coating, ... }, // 可序列化子集
 *     strokes: [ { points: [{x, y}, ...] }, ... ],
 *   }
 */
import { createStroke, addPoint } from './stroke.js'

export const SESSION_VERSION = 1

/** 允许进入会话数据的配置键（回调、Texture 等不可序列化项一律剔除） */
const OPTION_KEYS = [
  'threshold',
  'brushSize',
  'maxPixelRatio',
  'revealOnThreshold',
  'coverageResolution',
  'coverageStride',
  'coverageInterval',
  'revealFadeMs',
]

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * 生成会话数据（纯数据快照，深拷贝，与内部状态解耦）。
 * @param {object} opts 合并后的运行配置
 * @param {object} state 卡片内部状态（取实际逻辑尺寸）
 * @param {object} history 笔画栈
 */
export function createSession(opts, state, history) {
  const options = { width: state.logicalW, height: state.logicalH }
  for (const key of OPTION_KEYS) options[key] = opts[key]
  // coating 仅颜色值可序列化；纹理 URL 可序列化；PIXI.Texture 等对象剔除
  if (typeof opts.coating === 'string' || typeof opts.coating === 'number') {
    options.coating = opts.coating
  }
  if (typeof opts.prize === 'string' || opts.prize === null) {
    options.prize = opts.prize
  }
  return {
    version: SESSION_VERSION,
    options,
    strokes: history.strokes.map((s) => ({
      points: s.points.map((p) => ({ x: p.x, y: p.y })),
    })),
  }
}

/**
 * 校验并规范化会话数据；非法数据抛错（调用方视为编程错误）。
 * @returns {{ options: object, strokes: Array<{points: Array<{x:number,y:number}>}> }}
 */
export function parseSession(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('replaySession: data 必须是对象')
  }
  if (data.version !== SESSION_VERSION) {
    throw new Error(`replaySession: 不支持的会话版本 ${data.version}（当前 ${SESSION_VERSION}）`)
  }
  if (!Array.isArray(data.strokes)) {
    throw new TypeError('replaySession: data.strokes 必须是数组')
  }
  const strokes = data.strokes.map((s, i) => {
    if (!s || !Array.isArray(s.points)) {
      throw new TypeError(`replaySession: strokes[${i}].points 必须是数组`)
    }
    return {
      points: s.points.map((p, j) => {
        if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
          throw new TypeError(`replaySession: strokes[${i}].points[${j}] 坐标非法`)
        }
        return { x: p.x, y: p.y }
      }),
    }
  })
  return { options: data.options || {}, strokes }
}

/** 由会话数据重建笔画对象序列（与实时输入共用 createStroke/addPoint 推导） */
export function buildStrokes(session) {
  return session.strokes.map((sd) => {
    const stroke = createStroke()
    for (const p of sd.points) addPoint(stroke, p.x, p.y)
    return stroke
  })
}
