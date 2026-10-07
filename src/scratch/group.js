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
 *
 * 组级连锁揭晓（chainReveal，默认关，DESIGN.md §12.4）：
 * 任一卡揭晓（用户/阈值触发）→ 其余存活卡锁输入 → 逐卡延迟 100ms 执行
 * reset+reveal 的演示动画 → 解锁。连锁 reveal 不触发用户 onReveal、不再传播。
 */
import { mountScratchCard } from './mountScratchCard.js'

/**
 * @param {Array<HTMLElement | {el: HTMLElement, options?: object}>} entries 卡槽列表
 * @param {object} [baseOptions] 全组共享配置（被每项 entry.options 覆盖）；
 *   组级专有键：chainReveal（boolean，默认 false）、chainRevealDelay（ms，默认 100）
 */
export function mountScratchCardGroup(entries, baseOptions = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('mountScratchCardGroup: entries 必须是非空数组')
  }

  const { chainReveal = false, chainRevealDelay = 100, ...cardBaseOptions } = baseOptions
  const slots = []
  let chainActive = false // 连锁进行中：防止连锁 reveal 递归触发新一轮连锁
  let chainTimers = []

  const isAlive = (slot) =>
    slot.alive && slot.handle && slot.handle.diagnostics().phase !== 'destroyed'

  /** 连锁演示：源卡揭晓后，其余存活卡逐卡延迟 reset+reveal（纯演示，不回调） */
  const runChain = (sourceSlot) => {
    if (!chainReveal || chainActive) return
    chainActive = true
    const targets = slots.filter((s) => s !== sourceSlot && isAlive(s))
    for (const s of targets) s.handle.lock() // 连锁期间拒绝用户输入
    targets.forEach((s, i) => {
      chainTimers.push(
        setTimeout(() => {
          try {
            if (!isAlive(s)) return // 中途 destroy：跳过本卡，不影响其余卡
            s.suppressReveal = true // 演示性质：不触发用户 onReveal、不再传播连锁
            s.handle.reset() // revealed → ready；非 revealed 返回 false 无副作用
            s.handle.reveal()
          } catch {
            /* 单卡连锁异常隔离，不中断其余卡 */
          } finally {
            if (s.handle) s.handle.unlock()
          }
        }, i * chainRevealDelay)
      )
    })
    chainTimers.push(
      setTimeout(() => {
        chainActive = false
        chainTimers = []
      }, targets.length * chainRevealDelay + 50)
    )
  }

  entries.forEach((entry, index) => {
    const el = entry && entry.el ? entry.el : entry
    const perOptions = (entry && entry.options) || {}
    const slot = { index, handle: null, error: null, alive: false, suppressReveal: false }
    slots.push(slot)
    try {
      const opts = { ...cardBaseOptions, ...perOptions }
      const userOnError = opts.onError
      opts.onError = (err) => {
        slot.alive = false // 异步 init 失败：只标记本卡，不抛出、不影响邻卡
        userOnError?.(err)
      }
      const userOnReveal = opts.onReveal
      opts.onReveal = (reason) => {
        if (slot.suppressReveal) {
          slot.suppressReveal = false // 连锁演示的 reveal：吞掉，不回调、不传播
          return
        }
        userOnReveal?.(reason)
        runChain(slot) // 真实揭晓：触发组级连锁（chainReveal 关闭时为空操作）
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
  })

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
      for (const t of chainTimers) clearTimeout(t) // 取消未执行的连锁，杜绝销毁后回调
      chainTimers = []
      chainActive = false
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
