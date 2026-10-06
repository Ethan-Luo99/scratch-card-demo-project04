/**
 * group.js — ScratchCardGroup：一页挂载 N≥3 张刮刮卡（DESIGN.md §10 / §11.4）。
 *
 * 关键选型：每卡独立 Application（复用 mountScratchCard，不共享 stage）。
 * 理由（WebGL 上下文上限 / 显存 / 隔离性三权衡）详见 DESIGN.md §10。
 *
 * 故障隔离：
 * - 单卡挂载抛错（非法容器）→ 记入 failures，其余卡照常挂载；
 * - 单卡异步 init 失败（WebGL 不可用等）→ 经 onError 包装标记死亡，不波及邻卡；
 * - 单卡 destroy / context lost → 每卡独立 Application/GL 上下文，天然互不影响；
 * - aliveCount() 实时返回存活卡数。
 */
import { mountScratchCard } from './mountScratchCard.js'

/**
 * @param {Array<HTMLElement | {el: HTMLElement, options?: object}>} entries 卡槽列表
 * @param {object} [baseOptions] 全组共享配置（被每项 entry.options 覆盖）
 */
export function mountScratchCardGroup(entries, baseOptions = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('mountScratchCardGroup: entries 必须是非空数组')
  }

  const slots = entries.map((entry, index) => {
    const el = entry && entry.el ? entry.el : entry
    const perOptions = (entry && entry.options) || {}
    const slot = { index, handle: null, error: null, alive: false }
    try {
      const opts = { ...baseOptions, ...perOptions }
      const userOnError = opts.onError
      opts.onError = (err) => {
        slot.alive = false // 异步 init 失败：只标记本卡，不抛出、不影响邻卡
        userOnError?.(err)
      }
      slot.handle = mountScratchCard(el, opts)
      slot.alive = true
      // 包装 destroy：调用方直接 card.destroy() 时组内计数同步准确
      const rawDestroy = slot.handle.destroy
      slot.handle.destroy = () => {
        rawDestroy()
        slot.alive = false
      }
      slot.handle.ready.catch(() => {
        slot.alive = false // init  Promise 拒绝（未走 onError 的兜底）
      })
    } catch (err) {
      slot.error = err // 同步挂载失败（非法容器/重复挂载）：隔离到本槽位
    }
    return slot
  })

  const isAlive = (slot) =>
    slot.alive && slot.handle && slot.handle.diagnostics().phase !== 'destroyed'

  return {
    /** 成功挂载的卡句柄数组（失败槽位为 null，与 entries 索引对齐） */
    cards: slots.map((s) => s.handle),
    /** 挂载期失败明细：[{ index, error }] */
    failures: slots.filter((s) => s.error).map((s) => ({ index: s.index, error: s.error })),
    /** 当前存活卡数（未销毁且未 init 失败） */
    aliveCount: () => slots.filter(isAlive).length,
    /** 全部存活卡复位（revealed → ready）；非 revealed 卡由各自 reset 返回 false 跳过 */
    resetAll() {
      return slots.map((s) => (s.handle && isAlive(s) ? s.handle.reset() : false))
    },
    /** 导出全部存活卡的会话数据（失败/已销毁槽位为 null，索引对齐） */
    exportSessions() {
      return slots.map((s) => (s.handle && isAlive(s) ? s.handle.exportSession() : null))
    },
    /** 销毁全部卡（幂等；单卡销毁异常不中断其余卡） */
    destroy() {
      for (const s of slots) {
        if (!s.handle) continue
        try {
          s.handle.destroy()
        } catch {
          /* 单卡销毁异常隔离，继续销毁其余卡 */
        }
        s.alive = false
      }
    },
  }
}
