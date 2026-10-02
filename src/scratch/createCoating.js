/**
 * createCoating.js — RenderTexture 涂层（DESIGN.md §2.2 路线 C / §3.2）。
 *
 * - scratchRT：与卡片同逻辑尺寸、同 resolution 的离屏 RenderTexture（dynamic）。
 *   初始内容 = 涂层底图（颜色/斜纹/提示文案，或纹理图），一次性渲染进 RT。
 * - 擦子 eraser：唯一一块复用的 Graphics（blendMode 'erase'），
 *   每批命令画完即 render 进 RT（clear:false 增量累积），随后 clear() 复用——
 *   不新建 Graphics、不随笔画历史增长（DESIGN.md §5 风险#8）。
 * - 屏幕上只放一个以该 RT 为纹理的 Sprite；刮开处 alpha=0 露出下层奖品。
 *
 * 坐标系：RT 以 resolution 创建，Pixi 渲染进 RT 时按 RT 逻辑尺寸建立投影，
 * 因此擦子命令直接使用 CSS px 逻辑坐标（实测验证记录见 DESIGN.md §4.1 回填）。
 */
export function createCoating(PIXI, app, options) {
  const { width, height, resolution, coating, brushSize } = options

  const rt = PIXI.RenderTexture.create({ width, height, resolution, dynamic: true })
  const sprite = new PIXI.Sprite(rt)

  // 实测（pixi.js 8.21.0 / WebGL）：renderer.render({container, target}) 的根节点
  // 自身 blendMode 不生效，须包一层 Container、把 'erase' 设在子级 Graphics 上
  const eraserLayer = new PIXI.Container()
  const eraser = new PIXI.Graphics()
  eraser.blendMode = 'erase'
  eraserLayer.addChild(eraser)

  let base = null // 涂层底图容器：按尺寸重建、重放时复用渲染

  const isColorInput = (v) =>
    typeof v === 'number' ||
    (typeof v === 'string' && (/^#/.test(v) || /^(rgb|hsl)/i.test(v) || /^[a-z]+$/i.test(v)))

  async function buildBase(w, h) {
    if (base) {
      base.destroy({ children: true, context: true, texture: false })
      base = null
    }
    const root = new PIXI.Container()
    if (isColorInput(coating)) {
      const g = new PIXI.Graphics()
      g.rect(0, 0, w, h).fill(coating)
      // 斜纹肌理
      const gap = 22
      for (let x = -h; x < w + h; x += gap) {
        g.moveTo(x, 0).lineTo(x + h, h).stroke({ width: 5, color: 0xffffff, alpha: 0.16 })
      }
      root.addChild(g)
    } else {
      const tex = await PIXI.Assets.load(coating) // 纹理 URL；失败由上层 onError 收口
      const s = new PIXI.Sprite(tex)
      s.width = w
      s.height = h
      root.addChild(s)
    }
    const label = new PIXI.Text({
      text: '刮一刮',
      style: {
        fill: 0xffffff,
        fontSize: Math.max(16, Math.min(w, h) * 0.16),
        fontWeight: 'bold',
      },
    })
    label.anchor.set(0.5)
    label.position.set(w / 2, h / 2)
    root.addChild(label)
    base = root
  }

  /** 重铺底图（clear:true，RT 全量重建为满覆盖） */
  function paintBase() {
    app.renderer.render({ container: base, target: rt, clear: true })
  }

  /** 把一批擦除命令增量画进 RT（clear:false，保留既有擦除结果） */
  function drawCommands(cmds) {
    eraser.clear()
    const r = brushSize / 2
    for (const c of cmds) {
      if (c.t === 'dot') {
        eraser.circle(c.x, c.y, r).fill(0xffffff)
      } else if (c.t === 'line') {
        eraser
          .moveTo(c.fx, c.fy)
          .lineTo(c.x, c.y)
          .stroke({ width: brushSize, cap: 'round', join: 'round', color: 0xffffff })
      } else {
        eraser
          .moveTo(c.fx, c.fy)
          .quadraticCurveTo(c.cx, c.cy, c.x, c.y)
          .stroke({ width: brushSize, cap: 'round', join: 'round', color: 0xffffff })
      }
    }
    app.renderer.render({ container: eraserLayer, target: rt, clear: false })
    eraser.clear() // 立即释放几何，复用同一 Graphics
  }

  return {
    sprite,
    rt,
    /** 初始化：建底图并铺进 RT */
    async init() {
      await buildBase(width, height)
      paintBase()
    },
    /** 增量擦除一批命令 */
    erase(cmds) {
      if (cmds.length) drawCommands(cmds)
    },
    /** 清 RT 重放：重铺底图 + 重放剩余全部笔画命令（undo / context lost / resize） */
    replay(cmds) {
      paintBase()
      if (cmds.length) drawCommands(cmds)
    },
    /** 尺寸/DPR 变化：RT 重建（内容失效）+ 底图重建；笔画由调用方重放 */
    async resize(w, h, res) {
      rt.resize(w, h, res)
      await buildBase(w, h)
    },
    destroy() {
      if (base) {
        base.destroy({ children: true, context: true, texture: false })
        base = null
      }
      eraserLayer.destroy({ children: true, context: true })
      // rt 由 coatingSprite 随 app.destroy({texture:true, textureSource:true}) 一并释放
    },
  }
}
