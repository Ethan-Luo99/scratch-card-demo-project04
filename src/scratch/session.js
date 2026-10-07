/**
 * session.js — 会话序列化 / 反序列化 / 重放数据构建（DESIGN.md §11.3 / §12.1–§12.3）。
 * 纯数据、纯逻辑，不 import PixiJS；与 stroke.js 共用同一套点→命令推导，
 * 保证「重放结果」与「实时刮擦结果」逐命令一致（undo 等价性的根基）。
 *
 * 数据格式 v2（可 JSON.stringify 的纯数据）：
 *   {
 *     version: 2,
 *     canvas: { width, height },        // 录制时的逻辑宽高（显式画布基准）
 *     options: { threshold, brushSize, ... }, // 可序列化子集（不含尺寸）
 *     progress: number,                 // 导出时刻已提交的覆盖率快照（0..1）
 *     strokes: [ { points: [{x, y}, ...] }, ... ],  // 归一化坐标（0..1，相对 canvas）
 *   }
 *
 * 坐标基准约定（§12.1）：会话内只存归一化坐标；「归一化 → 目标逻辑尺寸」的映射
 * 只在 replaySession 入口发生一次；resize 路径的比例映射作用于运行时逻辑坐标，
 * 两处映射的基准都是逻辑坐标系，不会叠加（不会双重映射）。
 *
 * 兼容：parseSession 同时接受 v1（绝对坐标 + options.width/height）与 v2，
 * v1 在入口处无损升级为 v2 后走统一路径。
 */
import { createStroke, addPoint } from './stroke.js'

export const SESSION_VERSION = 2

/** 允许进入会话数据的配置键（回调、Texture、尺寸等一律剔除；尺寸由 canvas 承担） */
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
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 生成会话数据（v2 纯数据快照，深拷贝，与内部状态解耦）。
 * 原子性（§12.2）：本函数同步执行，JS 单线程保证拷贝期间无任何异步任务插入；
 * 只导出已提交笔画（currentStroke 未入栈，天然排除半笔）；progress 读的是
 * state.progress——它只在 epoch 校验通过后同步落库，不会读到半更新的值。
 * @param {object} opts 合并后的运行配置
 * @param {object} state 卡片内部状态（取实际逻辑尺寸与已提交 progress）
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
    progress: state.progress,
    strokes: history.strokes.map((s) => ({
      // 逻辑坐标 → 归一化；w/h 为 0 时（init 前）笔画栈必为空，不会除零
      points: s.points.map((p) => ({ x: p.x / w, y: p.y / h })),
    })),
  }
}

/** v1 → v2 无损升级：绝对坐标 ÷ 录制尺寸 = 归一化坐标（浮点精确，无舍入损失） */
function upgradeV1(data) {
  const width = data.options && data.options.width
  const height = data.options && data.options.height
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    throw new Error('replaySession: v1 会话缺少合法的 options.width/height（画布基准）')
  }
  const options = { ...data.options }
  delete options.width
  delete options.height
  return {
    version: 2,
    canvas: { width, height },
    options,
    progress: 0, // v1 无 progress 字段，视为未知（不影响重放，重放后重新测量）
    strokes: data.strokes.map((s) => ({
      points: s.points.map((p) => ({ x: p.x / width, y: p.y / height })),
    })),
  }
}

/**
 * 校验并规范化会话数据为 v2（归一化坐标）；非法数据抛错（调用方视为编程错误）。
 * @returns {{ canvas:{width:number,height:number}, options:object, progress:number,
 *             strokes: Array<{points: Array<{x:number,y:number}>}> }}
 */
export function parseSession(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('replaySession: data 必须是对象')
  }
  if (data.version !== 1 && data.version !== SESSION_VERSION) {
    throw new Error(
      `replaySession: 不支持的会话版本 ${data.version}（当前 ${SESSION_VERSION}，兼容 v1）`
    )
  }
  if (!Array.isArray(data.strokes)) {
    throw new TypeError('replaySession: data.strokes 必须是数组')
  }
  const session = data.version === 1 ? upgradeV1(data) : data
  const { canvas } = session
  if (
    !canvas ||
    !isFiniteNumber(canvas.width) ||
    !isFiniteNumber(canvas.height) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    throw new TypeError('replaySession: canvas.width/height 必须是正数（显式画布基准）')
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
        // 归一化坐标合法域 0..1；浮点噪声（如 1.0000000002）钳回边界，明显越界报错
        if (p.x < -1e-6 || p.x > 1 + 1e-6 || p.y < -1e-6 || p.y > 1 + 1e-6) {
          throw new TypeError(`replaySession: strokes[${i}].points[${j}] 超出归一化范围 0..1`)
        }
        return { x: clamp01(p.x), y: clamp01(p.y) }
      }),
    }
  })
  return {
    canvas: { width: canvas.width, height: canvas.height },
    options: session.options || {},
    progress: isFiniteNumber(session.progress) ? clamp01(session.progress) : 0,
    strokes,
  }
}

/**
 * 由会话数据重建笔画对象序列（与实时输入共用 createStroke/addPoint 推导）。
 * 归一化坐标在此一次性映射到目标卡逻辑尺寸（§12.1：唯一的仿射映射点）。
 * @param {object} session parseSession 返回的 v2 会话
 * @param {number} width 目标卡逻辑宽
 * @param {number} height 目标卡逻辑高
 */
export function buildStrokes(session, width, height) {
  return session.strokes.map((sd) => {
    const stroke = createStroke()
    for (const p of sd.points) addPoint(stroke, p.x * width, p.y * height)
    return stroke
  })
}
