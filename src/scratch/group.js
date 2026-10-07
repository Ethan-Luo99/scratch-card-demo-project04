/**
 * group.js — ScratchCardGroup：一页挂载 N≥3 张刮刮卡（DESIGN.md §10 / §11.4 / §12.4）。
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
 * 组级连锁揭晓（baseOptions.chainReveal，默认关，DESIGN.md §12.4）：
 * 组内任一卡「真实揭晓」（onReveal）时，其余存活的 ready 卡先 arm（立即拒绝输入），
 * 再按 100ms 步长依次 _chainPlay（reset + 静默 reveal）；全程窗口 300ms
 * （触发卡 + 后续最多 3 张，延迟 0/100/200/300ms）。
 */
import { mountScratchCard } from './mountScratchCard.js'

const CHAIN_STEP_MS = 100 // 逐卡延迟
const CHAIN_WINDOW_MS = 300 // 连锁窗口上限（300ms 内依次执行）

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
    const slot = { index, handle: null, error: null, alive: false, chainTimer: 0 }
    try {
      const opts = { ...baseOptions, ...perOptions }
      const chainEnabled = opts.chainReveal === true
      const userOnError = opts.onError
      const userOnReveal = opts.onReveal
      // 真实揭晓（threshold/manual）经 onReveal 上报；连锁演示走 silent 路径，
      // 不触发 onReveal，因此不会回流造成连锁的连锁（无递归、无重复编排）。
      opts.onReveal = (reason) => {
        userOnReveal?.(reason)
        if (chainEnabled) scheduleChain(slot)
      }
      opts.onError = (err) => {
        slot.alive = false // 异步 init 失败：只标记本卡，不抛出、不影响邻卡
        userOnError?.(err)
      }
      slot.handle = mountScratchCard(el, opts)
      slot.alive = true
      // 包装 destroy：调用方直接 card.destroy() 时组内计数同步准确，
      // 且必须清掉本槽位的连锁定时器——中途 destroy 不得打断/污染其余卡连锁
      const rawDestroy = slot.handle.destroy
      slot.handle.destroy = () => {
        if (slot.chainTimer) {
          clearTimeout(slot.chainTimer)
          slot.chainTimer = 0
        }
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

  /**
   * 编排一次连锁（DESIGN.md §12.4）。
   * 两阶段：① 同步 arm——只在此刻存活且 ready 的卡上预约并锁定输入，
   * arm 失败的卡（已揭晓/busy/销毁）不参与、不锁定；② 按 100ms 步长排定时器，
   * 延迟超过 300ms 窗口的卡不参与连锁。每个定时器独立：任一卡中途 destroy 只清自己
   * 的定时器，其余定时器照常触发；_chainPlay 内部再做 destroyed/相位兜底，
   * 任何异常都被收口在本槽位，绝不产生未捕获异常。
   */
  function scheduleChain(triggerSlot) {
    let step = 0
    for (const slot of slots) {
      if (slot === triggerSlot || !isAlive(slot)) continue
      // 窗口内逐卡 100ms：第 1 张 100ms、第 2 张 200ms、第 3 张 300ms（含端点）
      const delay = (step + 1) * CHAIN_STEP_MS
      if (delay > CHAIN_WINDOW_MS) break
      const handle = slot.handle
      const armed = typeof handle._chainArm === 'function' && handle._chainArm()
      if (!armed) continue // 非 ready（已揭晓/忙碌/锁定中）：跳过且不排定时器
      const delayMs = (step + 1) * CHAIN_STEP_MS
      slot.chainTimer = setTimeout(() => {
        slot.chainTimer = 0
        try {
          handle._chainPlay()
        } catch {
          // 单卡演示异常隔离：不影响后续卡（它们各自持有独立定时器）
        }
      }, delayMs)
      step++
    }
  }

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
    /** 销毁全部卡（幂等；单卡销毁异常不中断其余卡；连锁定时器一并清理） */
    destroy() {
      for (const s of slots) {
        if (!s.handle) continue
        try {
          s.handle.destroy() // 包装过的 destroy：内部 clearTimeout(s.chainTimer)
        } catch {
          /* 单卡销毁异常隔离，继续销毁其余卡 */
        }
        s.alive = false
      }
    },
  }
}
