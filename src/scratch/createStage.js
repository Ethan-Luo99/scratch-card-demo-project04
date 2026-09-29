import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { clamp } from './math.js'

// Creates the Pixi Application (WebGL-locked) and the two-layer card stage:
//   cardRoot (CSS-px coordinates)
//   ├─ prizeLayer    (bottom)
//   └─ coatingLayer  (top, provided by createCoating)
export async function createStage({ el, width, height, resolution, prize }) {
  const app = new Application()
  await app.init({
    preference: 'webgl',
    width,
    height,
    resolution,
    autoDensity: true,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: false,
  })

  const canvas = app.canvas
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'

  const cardRoot = new Container()
  const prizeLayer = new Container()
  cardRoot.addChild(prizeLayer)
  app.stage.addChild(cardRoot)

  await paintPrize(prizeLayer, prize, width, height)

  el.appendChild(canvas)

  return {
    app,
    canvas,
    cardRoot,
    prizeLayer,
    resize(widthCss, heightCss, newResolution) {
      app.renderer.resize(widthCss, heightCss, newResolution)
    },
    render() {
      app.renderer.render(app.stage)
    },
  }
}

async function paintPrize(layer, prize, width, height) {
  layer.removeChildren().forEach((child) => child.destroy({ children: true }))
  if (prize) {
    try {
      const texture = typeof prize === 'string'
        ? await Assets.load(prize)
        : prize instanceof Texture ? prize : null
      if (texture) {
        const sprite = new Sprite(texture)
        fitCover(sprite, width, height)
        layer.addChild(sprite)
        return
      }
    } catch (err) {
      // Fall through to the default prize; caller may also surface via onError.
      console.warn('[scratch-card] prize texture load failed:', err)
    }
  }
  const bg = new Graphics()
  bg.roundRect(0, 0, width, height, 12)
    .fill({ color: 0xffd54a })
  layer.addChild(bg)
  const label = new Text({
    text: '🎉 恭喜中奖 🎉',
    style: {
      fill: '#7a4b00',
      fontFamily: 'system-ui, sans-serif',
      fontSize: Math.max(18, Math.round(Math.min(width, height) * 0.14)),
      fontWeight: '700',
      align: 'center',
    },
  })
  label.anchor.set(0.5)
  label.position.set(width / 2, height / 2)
  layer.addChild(label)
}

function fitCover(sprite, width, height) {
  const tex = sprite.texture
  const scale = Math.max(width / tex.width, height / tex.height)
  sprite.scale.set(scale)
  sprite.anchor.set(0.5)
  sprite.position.set(width / 2, height / 2)
  sprite.width = Math.min(sprite.width, width)
  sprite.height = Math.min(sprite.height, height)
}

export function refitPrize(prizeLayer, width, height) {
  const label = prizeLayer.children.find((c) => c instanceof Text)
  if (label) {
    label.style.fontSize = Math.max(
      18,
      Math.round(Math.min(width, height) * 0.14),
    )
    label.position.set(width / 2, height / 2)
  }
  const bg = prizeLayer.children.find((c) => c instanceof Graphics)
  if (bg) {
    bg.clear()
    bg.roundRect(0, 0, Math.max(1, width), Math.max(1, height), 12)
      .fill({ color: 0xffd54a })
  }
  const sprite = prizeLayer.children.find((c) => c instanceof Sprite)
  if (sprite) {
    const scale = clamp(
      Math.min(width / sprite.texture.width, height / sprite.texture.height),
      0.0001,
      Number.POSITIVE_INFINITY,
    )
    sprite.scale.set(scale)
    sprite.position.set(width / 2, height / 2)
  }
}
