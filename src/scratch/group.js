/**
 * group.js — ScratchCardGroup：一个页面挂载 N≥3 张卡（DESIGN.md §10）。
 *
 * 选型：每卡独立 PIXI.Application（决策与三维权衡见 DESIGN.md §10.1）。
 * 故障隔离（§11.4）：
 *   - 单卡挂载/初始化失败（非法容器、WebGL 不可用、资源加载失败）只标记该卡，
 *     不影响其余卡的挂载与运行；
 *   - 单卡 destroy / webglcontextlost 只波及自己的 canvas 与 Application，
 *     邻卡拥有独立 GL 上下文，结构上互不感知；
 *   - aliveCount() 实时反映「已挂载、未失败、未销毁」的卡数。
 */
import { mountScratchCard } from './mountScratchCard.js'

const DEFAULT_CELL_STYLE =
  'width:320px;height:180px;border-radius:12px;overflow:hidden;'

/**
 * @param {HTMLElement} el 组容器
 * @param {number|object[]} cards 卡数量（N≥1，演示用 3）或逐卡配置数组；
 *   每项可含 `el`（自带容器，非法容器仅该卡失败）与 `cellStyle`（覆盖默认格子样式），
 *   其余字段透传 mountScratchCard 的 options
 * @param {object} options 全组共享的卡片配置（逐卡配置优先）
 */
export function mountScratchCardGroup(el, cards = 3, options = {}) {
  if (!el || typeof el.appendChild !== 'function') {
    throw new TypeError('mountScratchCardGroup: el 必须是 DOM 元素')
  }
  const specs = Array.isArray(cards)
    ? cards
    : Array.from({ length: Math.max(1, Math.floor(cards) || 1) }, () => ({}))

  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;justify-content:center;'
  el.appendChild(wrap)

  // 逐卡独立 try/catch：任何一张卡挂载抛错只记录该卡，循环继续（故障隔离 #1）
  const entries = specs.map((spec) => {
    const { el: host, cellStyle, ...cardOptions } = spec || {}
    const cell = host || document.createElement('div')
    if (!host) {
      cell.style.cssText = cellStyle || DEFAULT_CELL_STYLE
      wrap.appendChild(cell)
    }
    const entry = { handle: null, failed: false, error: null, cell }
    try {
      entry.handle = mountScratchCard(cell, { ...options, ...cardOptions })
      // 异步 init 失败（WebGL 不可用 / 奖品或涂层纹理加载失败）同样只标记该卡
      entry.handle.ready.catch((err) => {
        entry.failed = true
        entry.error = err
      })
    } catch (err) {
      entry.failed = true
      entry.error = err
    }
    return entry
  })

  let destroyed = false

  /** 存活卡数：已挂载 && 未失败 && 未 destroy */
  function aliveCount() {
    return entries.filter(
      (e) => e.handle && !e.failed && e.handle.diagnostics().phase !== 'destroyed'
    ).length
  }

  /** 全部存活卡复位（revealed → ready）；返回成功复位的卡数 */
  function resetAll() {
    let n = 0
    for (const e of entries) {
      if (e.handle && !e.failed && e.handle.reset()) n++
    }
    return n
  }

  /** 幂等销毁：逐卡 destroy（单卡异常不中断其余卡），并移除组容器 */
  function destroy() {
    if (destroyed) return
    destroyed = true
    for (const e of entries) {
      try {
        e.handle?.destroy()
      } catch {
        /* 单卡销毁异常不波及其余卡 */
      }
    }
    wrap.remove()
  }

  return {
    /** 逐卡句柄（挂载失败的卡对应位置为 null） */
    cards: entries.map((e) => e.handle),
    /** 组级就绪：全部卡 settle（含失败），不 reject */
    ready: Promise.allSettled(entries.map((e) => (e.handle ? e.handle.ready : e.error))),
    aliveCount,
    resetAll,
    destroy,
  }
}
