/**
 * defaultOptions.js — 默认配置（DESIGN.md §3.3）。
 * 全部可选；mountScratchCard 内部做浅合并。
 */
export const DEFAULT_OPTIONS = {
  // 卡片逻辑尺寸（CSS px）；0 = 取容器实测宽高；容器为 0 时等待 ResizeObserver 首个非 0 尺寸
  width: 0,
  height: 0,
  // 自动揭开阈值（刮除比例 0..1）
  threshold: 0.7,
  // 笔宽（CSS px）
  brushSize: 26,
  // DPR 上限
  maxPixelRatio: 2,
  // 奖品：图片 URL（同源/CORS）| PIXI.Texture | null（内置默认奖品面板）
  prize: null,
  // 涂层：CSS 颜色（'#b8b8c4' / 0xb8b8c4）或纹理 URL
  coating: '#b8b8c4',
  // 达到阈值是否自动揭开
  revealOnThreshold: true,
  // 覆盖率读回参数（DESIGN.md §4.7：降分辨率 + stride 抽样 + 节流）
  coverageResolution: 0.5,
  coverageStride: 4,
  coverageInterval: 200, // ms，刮擦中读回的最小间隔
  // 揭开淡出时长（ms）；prefers-reduced-motion 下强制为 0（立即隐藏）
  revealFadeMs: 300,
  // 回调
  onProgress: null, // (ratio:number)=>void，节流
  onReveal: null, // (reason:'manual'|'threshold')=>void，只触发一次
  onReady: null,
  onError: null,
}
