import { Assets, Container, Graphics, RenderTexture, Sprite, Text } from 'pixi.js'

// Owns exactly one RenderTexture for the whole card lifetime (resized, never
// re-created) plus two reusable Graphics: the coating base and the eraser.
export class Coating {
  constructor(renderer, { width, height, resolution, coating, brushSize }) {
    this._renderer = renderer
    this._brushSize = brushSize
    this.renderTexture = RenderTexture.create({
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      resolution,
      dynamic: true,
    })
    this.sprite = new Sprite(this.renderTexture)

    this._base = new Container()
    this._eraser = new Graphics()
    // WebGL 'erase' maps to (ZERO, ONE_MINUS_SRC_ALPHA): painted shapes punch
    // destination alpha to 0. Dots are filled discs; the smoothed path is a
    // round-capped stroke, both sharing the same opaque white style.
    this._eraserFill = { color: 0xffffff, alpha: 1 }
    this._eraserStroke = {
      width: brushSize,
      cap: 'round',
      join: 'round',
      color: 0xffffff,
      alpha: 1,
    }

    this._coatingSpec = coating
  }

  async buildBase(width, height) {
    this._base.removeChildren().forEach((child) =>
      child.destroy({ children: true, texture: false }),
    )
    const fill = new Graphics()
    fill.rect(0, 0, Math.max(1, width), Math.max(1, height))
      .fill({ color: this.resolveColor(this._coatingSpec) })
    this._base.addChild(fill)
    const texture = await this.resolveCoatingTexture(this._coatingSpec)
    if (texture) {
      const img = new Sprite(texture)
      img.width = width
      img.height = height
      this._base.addChild(img)
    }
    const hint = new Text({
      text: '刮一刮',
      style: {
        fill: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: Math.max(16, Math.round(Math.min(width, height) * 0.16)),
        fontWeight: '700',
        align: 'center',
      },
    })
    hint.anchor.set(0.5)
    hint.alpha = 0.85
    hint.position.set(width / 2, height / 2)
    this._base.addChild(hint)
  }

  resolveColor(spec) {
    if (typeof spec === 'number') return spec
    if (typeof spec === 'string' && /^#[0-9a-f]{3,8}$/i.test(spec)) return spec
    return '#b8b8c4'
  }

  async resolveCoatingTexture(spec) {
    if (typeof spec !== 'string') return null
    if (!/\.(png|jpe?g|webp|avif)(\?.*)?$/i.test(spec)) return null
    return Assets.load(spec)
  }

  // Wipe the RT and repaint base + every surviving stroke (undo replay,
  // resize rebuild, context-loss restore).
  rebuild(width, height, resolution, history, paintStroke) {
    this.renderTexture.resize(
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height)),
      resolution,
    )
    this.sprite.width = width
    this.sprite.height = height
    this._renderer.render(this._base, {
      target: this.renderTexture,
      clear: true,
    })
    if (history && paintStroke) {
      for (const stroke of history) this.paintStroke(stroke, paintStroke)
    }
  }

  // Erases one incremental segment (CSS-px RT coordinate space).
  eraseSegment(stroke, prevPoint, curPoint) {
    this._eraser.clear()
    this._eraser
      .fill(this._eraserFill)
      .setStrokeStyle({ ...this._eraserStroke, width: stroke.brushSize })
    stroke.paintIncrement(this._eraser, prevPoint, curPoint)
    this._renderer.render(this._eraser, {
      target: this.renderTexture,
      clear: false,
    })
  }

  paintStroke(stroke, paintStroke) {
    this._eraser.clear()
    this._eraser
      .fill(this._eraserFill)
      .setStrokeStyle({ ...this._eraserStroke, width: stroke.brushSize })
    paintStroke(this._eraser, stroke)
    this._renderer.render(this._eraser, {
      target: this.renderTexture,
      clear: false,
    })
  }

  // One-shot full reveal: punch a single rect covering the whole RT.
  eraseAll(width, height) {
    this._eraser.clear()
    this._eraser.rect(-1, -1, width + 2, height + 2).fill(this._eraserFill)
    this._renderer.render(this._eraser, {
      target: this.renderTexture,
      clear: false,
    })
  }

  destroy() {
    this._eraser.destroy({ context: true, texture: false })
    this._base.destroy({ children: true, texture: false })
    this.sprite.destroy({ texture: false })
    this.renderTexture.destroy(true)
    this._renderer = null
  }
}
