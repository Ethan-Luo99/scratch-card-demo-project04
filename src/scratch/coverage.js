/**
 * coverage.js — 覆盖率读回（DESIGN.md §4.7）。
 * 组合策略：降分辨率读回（resolution<1）+ 网格 stride 抽样 + 调用方节流/空闲调度。
 * 本模块不做节流（由 mountScratchCard 调度），保证不在 pointermove 热路径同步读回。
 *
 * 读回缓冲（Uint8ClampedArray）单次分配、统计完即释放引用（局部变量随作用域回收），
 * 不在模块级常驻，满足「长期打开无内存增长」。
 */

/**
 * @returns {{ratio:number, ms:number, sampled:number, width:number, height:number}}
 *   ratio = 刮除比例 0..1；ms = 本次读回+统计耗时（诊断用）
 */
export async function measureCoverage(renderer, rt, options = {}) {
  const { resolution = 0.5, stride = 4, alphaThreshold = 16 } = options
  const t0 = performance.now()
  const { pixels, width, height } = await renderer.extract.pixels({
    target: rt,
    resolution,
  })
  let covered = 0
  let counted = 0
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      counted++
      // RT 只含涂层、背景透明：alpha>阈值 即「仍覆盖」
      if (pixels[(y * width + x) * 4 + 3] > alphaThreshold) covered++
    }
  }
  const ms = performance.now() - t0
  return {
    ratio: counted ? 1 - covered / counted : 0,
    ms,
    sampled: counted,
    width,
    height,
  }
}
