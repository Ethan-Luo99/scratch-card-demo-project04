/**
 * createStage.js — Application 初始化（preference:'webgl'）、舞台层级、奖品层。
 * 层级（自下而上）：app.stage → cardRoot → prizeLayer → coatingSprite（由 createCoating 提供）。
 * 舞台坐标系 = CSS px（renderer.resize(cssW, cssH, res) + autoDensity 建立）。
 */

/**
 * @param {object} PIXI 动态 import('pixi.js') 的命名空间（懒加载，见 mountScratchCard）
 */
export async function createStage(PIXI, host, { width, height, resolution, prize }) {
  const app = new PIXI.Application()
  await app.init({
    preference: 'webgl', // 锁定 WebGL（DESIGN.md §2.4）：'erase' 语义已逐行核实
    width,
    height,
    resolution,
    autoDensity: true, // canvas 属性像素 = css×res，style 尺寸 = css px
    backgroundAlpha: 0,
    antialias: true,
  })

  const canvas = app.canvas
  canvas.style.display = 'block'
  canvas.style.touchAction = 'none' // 声明式禁止触摸滚动（DESIGN.md §4.2 / 风险#2）
  host.appendChild(canvas)

  const cardRoot = new PIXI.Container()
  const prizeLayer = new PIXI.Container()
  cardRoot.addChild(prizeLayer)
  app.stage.addChild(cardRoot)

  await buildPrize(PIXI, prizeLayer, prize, width, height)

  return { app, canvas, cardRoot, prizeLayer }
}

/** 奖品层内容：URL / Texture / 内置默认面板 */
export async function buildPrize(PIXI, layer, prize, w, h) {
  layer.removeChildren().forEach((c) =>
    c.destroy({ children: true, context: true, texture: false })
  )
  if (prize && typeof prize === 'object' && prize.source) {
    const s = new PIXI.Sprite(prize)
    s.width = w
    s.height = h
    layer.addChild(s)
    return
  }
  if (typeof prize === 'string') {
    const tex = await PIXI.Assets.load(prize) // 跨域未授权会抛错 → 由上层 onError 收口
    const s = new PIXI.Sprite(tex)
    s.width = w
    s.height = h
    layer.addChild(s)
    return
  }
  // 内置默认奖品：绿底 + 边框 + 文案
  const g = new PIXI.Graphics()
  g.rect(0, 0, w, h).fill(0x2e7d32)
  g.rect(4, 4, Math.max(0, w - 8), Math.max(0, h - 8)).stroke({
    width: 3,
    color: 0xffeb3b,
    alpha: 0.85,
  })
  const label = new PIXI.Text({
    text: '🎉 恭喜中奖 🎉',
    style: {
      fill: 0xffffff,
      fontSize: Math.max(18, Math.min(w, h) * 0.2),
      fontWeight: 'bold',
    },
  })
  label.anchor.set(0.5)
  label.position.set(w / 2, h / 2)
  layer.addChild(g, label)
}
