/**
 * src/scratch/index.js — 唯一对外出口（DESIGN.md §3.1）。
 * 与现有 setupCounter 互不引用、可同页共存。
 */
export { mountScratchCard } from './mountScratchCard.js'
export { mountScratchCardGroup } from './group.js'
