/**
 * session.js — 会话序列化 / 反序列化 / 重放数据构建（DESIGN.md §11.3 / §12）。
 * 纯数据、纯逻辑，不 import PixiJS；与 stroke.js 共用同一套点→命令推导，
 * 保证「重放结果」与「实时刮擦结果」逐命令一致（undo 等价性的根基）。
 *
 * v2 数据格式（可 JSON.stringify 的纯数据）：
 *   {
 *     version: 2,
 *     canvas: { width, height },        // 显式画布基准：录制时的逻辑宽高（CSS px）
 *     options: { threshold, brushSize, ... }, // 可序列化子集（不再含 width/height）
 *     strokes: [ { points: [{x, y}, ...] }, ... ], // x/y 为归一化 0..1 浮点
 *   }
 *
 * v1 数据格式（仅在入口被升级，升级后内部只有一条 v2 路径）：
 *   {
 *     version: 1,
 *     options: { width, height, ... },  // 基准尺寸在 options 内
 *     strokes: [ { points: [{x, y}] } ], // 坐标为录制尺寸下的逻辑像素
 *   }
 */
import { createStroke, addPoint } from './stroke.js'
import { clamp } from './math.js'

export const SESSION_VERSION = 2

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
 * 生成 v2 会话数据（纯数据快照，深拷贝，与内部状态解耦）。
 * 坐标一律归一化：调用方必须保证导出瞬间不存在半提交笔画（见 mountScratchCard
 * 的 exportSession 守卫）；归一化基准 = state 当前逻辑尺寸（DESIGN.md §12.2）。
 * @param {object} opts 合并后的运行配置
 * @param {object} state 卡片内部状态（取实际逻辑尺寸）
 * @param {object} history 笔画栈（仅已提交笔画）
 */
export function createSession(opts, state, history) {
  const w = state.logicalW
  const h = state.logicalH
  const options = {}
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
    canvas: { width: w, height: h },
    options,
    strokes: history.strokes.map((s) => ({
      points: s.points.map((p) => ({ x: w ? p.x / w : 0, y: h ? p.y / h : 0 })),
    })),
  }
}

/**
 * v1 → v2 无损升级（DESIGN.md §12.3）：
 * 逻辑像素坐标除以录制基准尺寸得到归一化坐标，基准尺寸从 options 提升为顶层 canvas。
 * 只做除一次常数的确定性换算，不做点增删、不做命令重推，故为无损升级。
 */
function upgradeV1(data) {
  const srcOptions = data.options || {}
  const baseW = srcOptions.width
  const baseH = srcOptions.height
  if (!isFiniteNumber(baseW) || !isFiniteNumber(baseH) || baseW <= 0 || baseH <= 0) {
    throw new Error('replaySession: v1 会话缺少合法的 options.width/height 基准，无法升级')
  }
  const options = {}
  for (const key of OPTION_KEYS) {
    if (key in srcOptions) options[key] = srcOptions[key]
  }
  if ('coating' in srcOptions) options.coating = srcOptions.coating
  if ('prize' in srcOptions) options.prize = srcOptions.prize
  return {
    version: 2,
    canvas: { width: baseW, height: baseH },
    options,
    strokes: data.strokes.map((s) => ({
      points: s.points.map((p) => ({ x: p.x / baseW, y: p.y / baseH })),
    })),
  }
}

/**
 * 校验并规范化会话数据；v1 入口处无损升级为 v2，后续只有一条 v2 路径。
 * 非法数据（版本不支持 / 字段缺失 / 坐标越界）一律显式抛错（调用方视为编程错误）。
 * @returns {{ version:number, canvas:{width:number,height:number}, options:object,
 *             strokes: Array<{points: Array<{x:number,y:number}>}> }}
 *           归一化 v2 会话（坐标 0..1）
 */
export function parseSession(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('replaySession: data 必须是对象')
  }
  if (data.version !== 1 && data.version !== SESSION_VERSION) {
    throw new Error(
      `replaySession: 不支持的会话版本 ${data.version}（支持 1、${SESSION_VERSION}）`
    )
  }
  const session = data.version === 1 ? upgradeV1(data) : data
  if (!session.canvas || !isFiniteNumber(session.canvas.width) ||
      !isFiniteNumber(session.canvas.height) ||
      session.canvas.width <= 0 || session.canvas.height <= 0) {
    throw new TypeError('replaySession: canvas.width/height 必须为正数（显式画布基准）')
  }
  if (!Array.isArray(session.strokes)) {
    throw new TypeError('replaySession: strokes 必须是数组')
  }
  const strokes = session.strokes.map((s, i) => {
    if (!s || !Array.isArray(s.points)) {
      throw new TypeError(`replaySession: strokes[${i}].points 必须是数组`)
    }
    return {
      points: s.points.map((p, j) => {
        if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
          throw new TypeError(`replaySession: strokes[${i}].points[${j}] 坐标非法`)
        }
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
          throw new RangeError(
            `replaySession: strokes[${i}].points[${j}] 归一化坐标越界（应为 0..1）`
          )
        }
        return { x: p.x, y: p.y }
      }),
    }
  })
  return {
    version: 2,
    canvas: { width: session.canvas.width, height: session.canvas.height },
    options: session.options && typeof session.options === 'object' ? session.options : {},
    strokes,
  }
}

/**
 * 由归一化会话重建笔画对象序列：归一化点 × 目标卡逻辑尺寸做线性仿射映射
 * （录制基准 → 目标尺寸；x/y 独立比例，宽高比变化也不扭曲语义），
 * 映射后 clamp 到目标画布边界——与实时输入 onStrokeStart/Move 的 clamp 口径一致。
 * 与实时输入共用 createStroke/addPoint 推导，保证映射后 undo 等价性成立。
 */
export function buildStrokes(session, targetW, targetH) {
  return session.strokes.map((sd) => {
    const stroke = createStroke()
    for (const p of sd.points) {
      const x = clamp(p.x * targetW, 0, targetW)
      const y = clamp(p.y * targetH, 0, targetH)
      addPoint(stroke, x, y)
    }
    return stroke
  })
}
