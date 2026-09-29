export class StrokeHistory {
  constructor() {
    this.strokes = []
  }

  push(stroke) {
    this.strokes.push(stroke)
  }

  pop() {
    return this.strokes.pop() ?? null
  }

  clear() {
    this.strokes.length = 0
  }

  get count() {
    return this.strokes.length
  }

  [Symbol.iterator]() {
    return this.strokes[Symbol.iterator]()
  }

  mapScale(sx, sy) {
    const scaled = new StrokeHistory()
    scaled.strokes = this.strokes.map((s) => s.scale(sx, sy))
    return scaled
  }
}
