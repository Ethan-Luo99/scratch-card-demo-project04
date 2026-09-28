# 前端刮刮卡效果 · 技术方案（DESIGN）

> 技术栈（锁定）：**JavaScript（ESM）+ PixiJS + Vite**。
> 本轮仅做代码理解与方案设计，不写实现代码、不新增依赖、不改动任何现有文件。
> 文档中的代码片段仅为接口签名/伪代码，每段不超过 15 行。
>
> 路径说明：下文引用的所有路径均相对本仓库根目录（即任务所称的 `main/`）；
> 脚手架的 `package.json`、`index.html`、`src/` 平铺在该目录下（git 历史最近一次提交
> 「refactor: 将项目文件移动到仓库根目录」也印证了这一布局）。新增模块落在现有 `src/` 下。

---

## 1. 现状分析

### 1.1 目录与文件证据

通读了仓库根下全部非忽略文件，事实如下（均为直接读取的结论）：

| 事实 | 证据文件 | 关键内容 |
| --- | --- | --- |
| 项目名为 `scratch-card-pixi` | `package.json:2` | `"name": "scratch-card-pixi"` |
| 仅有的依赖是 Vite，且是 devDependency | `package.json:10-12` | `devDependencies` 中只有 `"vite": "^8.3.0"`；**没有任何渲染库** |
| 实际锁定 Vite 版本 8.3.1 | `package-lock.json:719-722` | `"node_modules/vite": { "version": "8.3.1" ... }`；底层打包器为 rolldown（`@rolldown/binding-*` 条目） |
| ESM 工程，无框架 | `package.json:5` | `"type": "module"`；scripts 仅 `vite` / `vite build` / `vite preview`（`package.json:6-9`） |
| 入口 HTML 只有一个挂载点和一个 module 脚本 | `index.html:8-10` | `<div id="app"></div>` + `<script type="module" src="/src/main.js">` |
| 页面内容由 JS 注入到 `#app` | `src/main.js:7` | `document.querySelector('#app').innerHTML = \`...\`` |
| 现有交互是纯 DOM 命令式函数 | `src/counter.js:1`、`src/main.js:71` | `export function setupCounter(element)`，并在末尾 `setupCounter(document.querySelector('#counter'))` |
| 视觉资源是静态图片/SVG | `src/main.js:2-4`、`src/assets/` | `hero.png`、`javascript.svg`、`vite.svg` 经 Vite 的资源 import 引入 |
| 样式是纯 CSS（含暗色模式与响应式） | `src/style.css` | 无 CSS-in-JS、无构建期 CSS 框架 |
| Node 环境 | 本机实测 | Node v24.21.0 / npm 11.19.0；Vite 8 要求 `node ^20.19.0 || >=22.12.0`（`npm view vite@8.3.1 engines`），满足 |

### 1.2 「名字叫 pixi 但零渲染依赖」的矛盾与结论

- **矛盾是真实存在的**：`package.json:2` 命名为 `scratch-card-pixi`，但 `package.json:10-12`
  与整个 `package-lock.json` 中**不存在 `pixi.js` 或任何 Canvas/WebGL 渲染库**。
- **合理解释**：这是 Vite 官方模板（`npm create vite` 的 vanilla 模板）改了 `name` 字段后的
  空白脚手架——`src/main.js` 的 hero 图 + counter + next-steps 结构、`src/counter.js` 的
  `setupCounter`、`public/icons.svg` 都是该模板的原始内容。命名表达了「目标项目」意图，
  但依赖尚未安装，属于「先命名、后落地」的起点状态，而非已经集成失败。
- **决策**：严格按任务强制栈推进，即使用 **PixiJS 作为唯一主渲染方案**；不引入 Canvas 2D
  或其他渲染库替代。Canvas 2D 仅允许作为「读回/兜底」环节中的浏览器底层手段
  （PixiJS 自身 `extract` 内部也会用），不承担涂层渲染主链路。
- **共存策略**：现有 `setupCounter` 的 DOM 方式与 `src/main.js` 注入的 `#app` 结构保持不动；
  刮刮卡通过独立的命令式 API `mountScratchCard(el, options)` 挂载到调用方指定容器。
  本轮不改 `index.html`、不改 `src/main.js`（第 7 章给出后续如何接入，但属于下一轮实现）。

### 1.3 Vite 下接入 PixiJS 的依赖与构建影响面（下一轮执行，本轮只评估）

- 新增唯一运行时依赖：`pixijs`（npm 包名 **`pixi.js`**，下文版本以 `8.21.0` 为基准核实，
  见第 2 章来源）。版本策略：`package.json` 中锁定 `"pixijs": "8.21.0"`（精确版本，避免
  v8 小版本 API 漂移），或 `"pixijs": "^8.21.0"` 由团队选择；**不跨大版本升级到未发布的 v9**。
- 安装影响：`npm install pixi.js@8.21.0` 会写入 `dependencies`（注意不是 devDependencies），
  更新 `package-lock.json`。本轮不执行。
- 构建影响面（基于 Vite 8 / rolldown 的通用行为，具体产物数字属实测项，标注待验证）：
  - PixiJS v8 发布 ESM（`lib/index.mjs`），Vite 可直接静态分析、按需 tree-shaking；
    但 v8 的渲染器/资源系统通过扩展注册耦合，实际可摇掉的部分有限——整包压缩后约
    **~829 KB**（来源：`pixi.js@8.21.0` 发布包 `dist/pixi.min.mjs` 实测文件大小
    828,971 字节；gzip/brotli 后体积与 tree-shaking 后体积 **待验证**）。
  - 无额外 loader/插件要求，不触碰现有 CSS/静态资源管线；`vite.config` 当前不存在，
    原则上**不需要新增配置文件**（手动分块等优化属于可选增强，见第 6 章 HMR/分包）。
  - 对 `vite build` 目标的影响：PixiJS v8 优先创建 `webgl2` 上下文，失败再尝试 `webgl`
    （来源：`pixi.js@8.21.0` 包内 `lib/rendering/renderers/gl/context/GlContextSystem.js:117-126`；
    v8 官方定位为 WebGL2 优先，iOS Safari 最低版本口径 **待验证**，保守按 iOS 15+ 设计）。

---

## 2. 技术选型与 PixiJS 路线对比

### 2.1 PixiJS 版本与 API 事实（已逐项查证）

查证基准：npm 包 `pixi.js@8.21.0`（`npm view pixi.js version` 实测 latest=8.21.0，
发布时间 2026-09-17，来源 `npm view pixi.js time`）。以下均直接核对发布包内 `lib/**/*.d.ts` 与 `.js`：

| API 事实（v8） | 来源（包内路径） | 与 v7 的差异提示 |
| --- | --- | --- |
| 混合模式是**字符串字面量联合类型**，擦除值为 `'erase'` | `lib/rendering/renderers/shared/state/const.d.ts`（`BLEND_MODES` 含 `'erase'`） | v7 为枚举 `BLEND_MODES.ERASE`，v8 不可照搬旧代码 |
| WebGL 下 erase 映射为 `[gl.ZERO, gl.ONE_MINUS_SRC_ALPHA]` | `lib/rendering/renderers/gl/state/mapWebGLBlendModesToPixi.js:16` | 即目标 alpha = dst.alpha × (1−src.alpha)，是标准「dst alpha 擦除」 |
| `Application` 必须异步初始化：`new Application()` 后 `await app.init(opts)` | `lib/app/Application.d.ts`（类内 `init`，示例 `await app.init()`） | v7 支持构造函数同步传参，v8 改为 async init |
| `RenderTexture.create({ width, height, resolution, dynamic })`；支持 `resize(w,h,resolution)` | `lib/rendering/renderers/shared/texture/RenderTexture.d.ts:11-36` | — |
| 读回像素：`renderer.extract.pixels({ target, frame?, resolution? })` 返回 `{ pixels: Uint8ClampedArray, width, height }`（RGBA） | `lib/rendering/renderers/shared/extract/ExtractSystem.d.ts`、`.../texture/GenerateCanvas.d.ts:9-13` | v7 为 `extract.pixels(target)` 位置参数 |
| 容器遮罩：`container.mask = graphics`（或 `setMask({ mask, inverse, channel })`），类型 `number | Container | null` | `lib/scene/container/container-mixins/effectsMixin.d.ts:22` 及注释 | Graphics 遮罩底层走 stencil，Sprite 遮罩走纹理（默认读 red 通道） |
| Graphics 路径 API：`graphicsContext` 风格 `moveTo/lineTo/quadraticCurveTo/arc/circle/beginPath/fill` | `lib/scene/graphics/shared/GraphicsContext.d.ts:175-304` | v8 Graphics 由共享 `GraphicsContext` 支撑，几何不可变式重建 |
| 所有 Container 支持 `blendMode?: BLEND_MODES` | `lib/scene/container/Container.d.ts:206` | Sprite/Container 均可置 `'erase'` |
| 渲染器选项：`resolution`（DPR）、`autoDensity`、`preference: 'webgl'|'webgpu'|'canvas'` | `lib/rendering/renderers/shared/view/ViewSystem.d.ts:39`、`.../autoDetectRenderer.d.ts:10-26` | 强制 `preference:'webgl'` 可避免 WebGPU 行为差异（见 2.4） |
| 上下文丢失：canvas 上监听 `webglcontextlost`（内部 `event.preventDefault()`）与 `webglcontextrestored`，恢复后触发内部 `contextChange` runner 重建 GPU 资源 | `lib/rendering/renderers/gl/context/GlContextSystem.js:105-106,178-190` | PixiJS 自动重建托管资源；自管 RenderTexture 的内容需自行重绘 |
| 销毁：`app.destroy({ removeView: true }, childrenDestroyOptions)` | `lib/app/Application.d.ts:348` | — |
| 事件：`globalpointermove`/`pointercancel` 等 federated events 存在 | `lib/events/FederatedEventMap`、`lib/events/EventSystem.d.ts` | 但本方案在 canvas 上用**原生 Pointer Events** 绑定（见 4.2 与第 6 章） |

### 2.2 三种擦除路线

- **路线 A：Graphics 作为 mask（+ 混合模式）**
  涂层是普通 Sprite，`coating.mask = strokesGraphics`；`strokesGraphics` 里累积每一画过的
  圆/路径，mask 区域即被「刮开」。v8 对 Graphics mask 使用 stencil，对 Sprite mask 使用纹理。
- **路线 B：`blendMode='erase'` 的 Sprite/图形直接画涂层**
  涂层本身是一张铺满卡片的不透明 Sprite，把「擦子」Graphics 的 `blendMode` 设为 `'erase'`
  与涂层画在同一显示列表里。注意：erase 只对「同一帧缓冲内已有内容」做 dst-alpha 相减，
  直接画在屏幕上会在每帧清屏后失效——因此实践中必须配合 RenderTexture（退化为路线 C 的变体）。
- **路线 C：RenderTexture 离屏绘制（本方案采用）**
  维护一张与涂层同尺寸的 `RenderTexture`：先把涂层图案（纯色/渐变/纹理图）渲染进去；
  每次 pointer 移动，把擦子 Graphics（`blendMode='erase'`，圆头粗线段）`renderer.render`
  到这张 RT（`clear:false`，不清屏、保留上一帧）；屏幕上只放一个以该 RT 为纹理的 Sprite。
  刮开处 alpha=0，露出下方奖品层（奖品层是舞台上更底层的普通 Sprite/Container）。

### 2.3 五维对比

| 维度 | A. Graphics mask | B. erase Sprite（无 RT） | C. RenderTexture + erase（选定） |
| --- | --- | --- | --- |
| API 稳定性 | 稳定，`container.mask` 为 v8 标准 API（已核实）；但 v8 Graphics 遮罩依赖 stencil，行为与 v7 有代差 | `'erase'` 本身稳定（已核实映射），但「直接画屏幕」在每帧 clear 后无法累积，**路线本身不成立**，需退化为 C | 稳定：`RenderTexture.create`、`renderer.render({target,clear:false})`、`'erase'` 均为 v8 标准 API（均已核实） |
| 实现复杂度 | 低-中：只累积几何 | 表面低、实际需补离屏层 | 中：多一层 RT 与手动 render，但概念清晰、社区主流 |
| 移动端性能 | 路径越多 stencil 重绘区域越大；v8 Graphics 几何累积会让单条 Graphics 越来越重，快速涂抹时重绘成本随总点数上涨 | — | 每帧只向 RT 提交一条短线段（增量绘制），主舞台每帧仅 2 个精灵；GPU 填充率开销稳定，与历史笔画长度无关，最易稳 60fps |
| 内存 | 几何数据常驻 CPU/GPU，且随笔画单调增长（长会话有增长压力） | — | RT 固定一块 `W×H×4×resolution²` 的显存（一次性、可预估）；擦子几何可每笔/每帧复用重置，不随历史增长 |
| 可撤销性 | 差：遮罩是累积几何的「当前并集」，撤销一笔需重建全部几何或改用分层遮罩 | — | 好：撤销以「笔画（stroke）」为单位，重放笔画命令即可重建 RT（见 4.4）；也可做 RT 快照但显存代价高，不选 |

**取舍理由**：选 **C**。
1. B 在 PixiJS 的帧清屏模型下不能独立成立，本质会变成 C，不作为独立方案。
2. A 的撤销与长期内存最被动（几何随总点数单调增长），且快速长划时 stencil 遮罩成本不可控。
3. C 的每帧成本与历史解耦（只画增量线段），内存是一块可预估的 RT，撤销可用「命令重放」零额外显存实现；覆盖率读回也天然以这张 RT 为目标（第 5 章）。
4. 代价与应对：多一块 RT 显存（用「涂层逻辑分辨率 + capped DPR」控制，见 3.3/5.2）；
   context lost 后需把涂层与笔画重画回 RT（第 6 章，笔画命令本来就保留着，重放即可）。

### 2.4 渲染器与资源加载的锁定决策

- 创建 Application 时固定 `preference: 'webgl'`（不用默认的 webgpu 优先、也不引入 canvas
  renderer 作为主路径），理由：`'erase'` 的 WebGL 映射已逐行核实、iOS Safari WebGPU 支持
  与成熟度口径待验证、WebGL2 在目标设备覆盖最稳。canvas renderer 仅作为「WebGL 不可用」
  时的**功能降级提示**（见 8/未决问题），不作为等价实现。
- 奖品图/涂层纹理用 `Assets.load`（v8 标准）加载；跨域图必须同源或带 CORS，否则纹理被标记
  不可读，`extract.pixels` 会抛错/读回为零（详见第 6 章 CORS 行）。

---

## 3. 架构设计

### 3.1 文件结构（全部为新增，不动现有文件）

下一轮实现时，在现有 `src/` 下新增一个内聚目录 `src/scratch/`，`main.js` 仅新增
import 与挂载调用（`index.html` 不改）。本轮不创建任何文件。

```
src/scratch/
  index.js            # 唯一对外出口：export mountScratchCard
  mountScratchCard.js # 命令式 API：装配、生命周期、销毁幂等
  createStage.js      # Application 初始化(preference:webgl)、舞台层级、resize/DPR
  createCoating.js    # RenderTexture 涂层：初始填充 + erase 增量绘制 + 全揭开
  pointerInput.js     # 原生 Pointer Events 绑定、坐标换算、异常输入收口
  stroke.js           # 一笔的点序列、二次贝塞尔插值、边界裁剪
  strokeHistory.js    # 笔画栈(undo)、contextlost 后命令重放
  coverage.js         # extract.pixels 采样统计、节流/脏区、阈值判定
  math.js             # clamp/lerp/DPR 计算等纯函数
  defaultOptions.js   # 默认配置(阈值 0.7、笔宽、DPR 上限等)
```

依赖方向单向向下：`mountScratchCard` → 其余模块；`stroke`/`math` 为纯逻辑、不 import PixiJS
类型以外的东西，便于不引入测试框架时用浏览器手测/控制台断言（第 8 章）。

### 3.2 舞台层级（自下而上）

```
app.stage (Container)
└─ cardRoot (Container, 逻辑像素坐标系 CSS px)
   ├─ prizeLayer (Sprite/Container)   # 奖品内容：图或 DOM 同级皆可，默认 Pixi Sprite
   └─ coatingSprite (Sprite)          # texture = scratchRT（RenderTexture）
      └─ （不挂载为子节点）eraserGfx    # blendMode='erase'，每帧 render 进 scratchRT 后清空
```

- `prizeLayer` 在下、`coatingSprite` 在上；刮开 = `scratchRT` 对应像素 alpha 变 0，
  浏览器合成时自然露出下层。两者尺寸都以「卡片逻辑尺寸」（CSS px）为准。
- 涂层初始内容（纯色/斜纹/提示文案「刮一刮」）作为一次性渲染进 RT 的内容；
  可选涂层背景图经 `Assets.load` 载入后先 blit 进 RT。

### 3.3 `mountScratchCard` 接口签名与返回值

```js
// src/scratch/index.js
export function mountScratchCard(el, options) {}
// el: HTMLElement 挂载容器；options 见 ScratchOptions
// 返回 ScratchCardHandle（同步返回；内部 ready 为 Promise，见下）
```

```js
// 配置项（含默认值，全部可选）
// width/height:number      卡片逻辑尺寸(CSS px)；默认取容器宽高，0 时回退 300×160
// threshold:number         自动揭开阈值，默认 0.7（70%）
// brushSize:number         笔宽(CSS px)，默认 26
// maxPixelRatio:number     DPR 上限，默认 2（3x 屏仍按 2 采样，见 3.3 说明）
// prize:string|TextureSource  奖品图 URL 或已就绪纹理（同源/CORS）
// coating:string|number       涂层：颜色默认 '#b8b8c4'，或纹理 URL
// revealOnThreshold:boolean   默认 true
// onProgress:(ratio:number)=>void   // 0..1，节流回调
// onReveal:(reason:'manual'|'threshold'|'undo-empty')=>void  // 只触发一次
// onReady?:()=>void; onError?:(err)=>void
```

```js
// 返回句柄
// ready: Promise<void>              app.init/首图加载完成；失败走 onError
// reveal(): void                     一键全部揭开(清掉整层 alpha 或直接隐藏涂层)
// undo(): boolean                    撤销上一笔；无笔可撤返回 false
// getProgress(): number              最近一次覆盖率(0..1)，不触发读回
// resize(w?, h?): void               容器尺寸变化/横竖屏切换（见 3.4）
// destroy(): void                    幂等销毁：解事件、destroy RT/纹理/app、移除 canvas
```

- 与现有 `setupCounter` 共存：两者都是命令式、互不引用。调用方（下一轮在 `src/main.js`
  新增，本轮不改）可在 `#app` 内任意空容器上 `mountScratchCard`，counter 仍由
  `src/counter.js` 独立工作；`index.html` 无需改动。
- 重复挂载防护：以 `WeakSet` 记录已挂载的 `el`，同一容器重复 `mount` 先抛错或先销毁旧实例
  （选择：抛 `Error('already mounted')`，由调用方负责），从根上避免 Vite HMR 叠加（第 6 章）。

### 3.4 内部状态机

```
                 mount() + app.init/资源加载
   [idle] ───────────────────────────────▶ [ready]
     ▲                                       │  pointerdown(在卡内,未揭开)
     │ destroy()                             ▼
     │                              [scratching] ◀─pointermove─┐
     │                                       │  pointerup/cancel │
     │                                       ▼                    │
     │                                  [stroke-committed]        │
     │                              (入栈+读回判定)               │
     │                                       │ 比例≥threshold 且 revealOnThreshold
     │                                       ▼
     │                                 [revealing](一次性淡出/立即清层)
     │                                       │ 完成 → onReveal('threshold')
     └──────────────────────────────────────[revealed]
```

- `undo()` 在 `[ready]`/`[stroke-committed]` 内回到上一笔结果；撤到 0 笔时涂层恢复
  满覆盖（不触发 reveal）；`[revealed]` 为终态，pointer 输入全部忽略（键盘「揭开」除外，
  见第 5 章）。
- 笔画提交时机：`pointerup`/`pointercancel`（cancel 视为提交已画部分）/失焦/blur 时提交，
  保证「一笔」边界明确，撤销粒度与人的直觉一致。
- 自动揭开只发生一次：状态进入 `revealed` 后忽略后续涂抹与重复 `onReveal`；
  手动 `reveal()` 直接进入，reason 为 `'manual'`。

### 3.5 自适应与高 DPI 策略（概览，换算见 4.1）

- 单一事实源：卡片「逻辑尺寸」= 容器 CSS 像素尺寸（`getBoundingClientRect` 得到的宽高）。
- 渲染分辨率：`resolution = min(devicePixelRatio, maxPixelRatio)`，默认 DPR 封顶 2
  （2x/3x 都清晰且显存可控；3x 用 2 的理由与误差见 5.3）。
- `app.renderer.resize(cssW, cssH, resolution)` 配合 `autoDensity:true`：canvas 的
  `width/height` 属性 = css×resolution，而 `style.width/height` = css px，舞台坐标即 CSS px。
- 容器尺寸变化（窗口缩放、旋转、移动端地址栏收起）用 `ResizeObserver` 触发 `resize()`；
  RT 用 `dynamic:true` 创建并 `resize`，笔画坐标按缩放比例线性映射（4.6）。

---

## 4. 关键技术链路

### 4.1 坐标链路：clientX/Y → 舞台坐标 → RT 纹理像素

坐标必须经过四段换算，全部以「canvas 元素的盒模型」为基准，禁止用 `e.offsetX/offsetY`
（目标是子节点或有 CSS transform 时会变），也禁止直接把 client 坐标当纹理像素：

```js
// 伪代码（≤15 行）：pointerInput.js 的换算核心
function toTexturePx(e, canvas, res) {
  const r = canvas.getBoundingClientRect()        // ① CSS 布局盒（含缩放后实际尺寸）
  const cssX = e.clientX - r.left                  // ② 视口坐标 → canvas 内 CSS 坐标
  const cssY = e.clientY - r.top
  const sx = r.width  ? canvas.width  / r.width  : res // ③ 属性像素 / CSS 盒宽
  const sy = r.height ? canvas.height / r.height : res
  return { x: cssX * sx, y: cssY * sy,           // ④ → RT/纹理物理像素
           cssX, cssY }                            //    舞台坐标直接用 cssX/cssY
}
```

- **① getBoundingClientRect**：拿到元素在视口中的真实位置与**经过 CSS 缩放后的实际尺寸**
  （`r.width/height` 是 CSS px 的最终显示尺寸）。卡片随容器缩放、页面有 transform 时仍正确。
- **② client → 元素内 CSS 坐标**：减去 `r.left/r.top`（不需要减滚动，clientX 本就相对视口）。
- **③ 缩放系数来自实测，而非假设 = DPR**：`canvas.width / r.width` 这一比值同时吸收了
  DPR、容器 CSS 缩放、以及任何祖先 transform 的综合效果，是「不偏移」的关键。
  - 正常情况下（`autoDensity:true` 且无额外 CSS 缩放）该比值恰等于 `resolution`；
  - 一旦卡片被弹性布局/transform 改变显示尺寸，比值会自动偏离 resolution，用实测比值即自动补偿。
- **④ 舞台坐标 vs 纹理像素分离**：
  - 提交给 PixiJS 显示对象（如直接交互命中）用 CSS 坐标（`app.stage` 坐标系就是 CSS px，
    因为 renderer 用 `resize(cssW, cssH, res)` 建立）；
  - 画进 RT 的擦子位于「RT 自己的坐标系」，RT 以 `resolution` 创建，故用物理像素
    `x = cssX * 比值`。coatingSprite 再以 1/res 缩放显示，使两者在屏幕上对齐。
- **2x/3x 不发虚**：canvas 后备缓冲 = cssW×res（`autoDensity` 负责 style 尺寸），
  RT 也以同一 res 创建；纹理采样与显示 1:1 映射，无二次缩放，笔画边缘由擦子几何+
  线性过滤得到平滑 alpha。3x 屏默认 res 封顶 2（`maxPixelRatio`），用 2x 超采样在
  手机物理像素密度下肉眼无差（误差与权衡见 5.3），需要极致清晰可调高上限（显存代价）。

### 4.2 输入绑定（桌面/移动/iOS Safari 统一）

- 统一用 **Pointer Events**：`pointerdown/move/up/cancel`，一套代码覆盖鼠标、触摸、触控笔。
- 监听直接挂在 Pixi 的 `app.canvas`（DOM）上，不用 federated events：命中换算自绘、
  且要在 `pointerdown` 时 `setPointerCapture(e.pointerId)`，保证划出 canvas 仍持续收事件、
  在 `pointerup/cancel` 释放——这是笔迹不「断在边界」的前提。
- 触摸滚动冲突（iOS Safari 重点，详见第 6 章）：
  - canvas 加内联样式 `touch-action: none`（推荐，声明式，浏览器在事件产生前就不滚动，
    不依赖 passive/ preventDefault）；
  - 作为双保险，对 `touchmove` 用**非 passive** 监听并 `preventDefault()`（仅在按下刮擦期间），
    因为旧版 iOS Safari 对 document/window 上的 touch 监听强制 passive。
- 多指：只接受「当前捕获的那一根手指」（记录 `activePointerId`），其余 `pointerdown`
  在刮擦中忽略，避免两指交错把笔画撕裂。

### 4.3 快速滑动断点的根因与插值

- **根因**：浏览器按硬件/合成节奏派发事件，两事件间可能相隔 16–32ms；快速一划两点间距
  可达数十像素。若每个事件只画一个圆点（`circle`），点与点之间露出涂层，形成糖葫芦状断点；
  即使画直线段，线段相接处在拐点也有尖角/细缝。
- **方案：二次贝塞尔「中点法」平滑 + 圆头线帽**。
  - 维护上一点 `p0`、当前点 `p1`；以 `p1` 为控制点、`mid(p0,p1)` 为终点画
    `quadraticCurveTo`（用 `GraphicsContext.quadraticCurveTo(cpx,cpy,x,y)`，已核实存在，
    `lib/scene/graphics/shared/GraphicsContext.d.ts:304`）；连续段在中点相接，斜率连续，无尖角。
  - 描边用**圆头线帽/圆角连接**（v8 `setStrokeStyle({ width, cap:'round', join:'round' })`
    风格；具体键名以实现时 d.ts 为准，**待验证**），半径 = brushSize/2（CSS px × res）。
  - 笔画起点补一个圆点，避免起笔空心。

```js
// 伪代码（≤15 行）：stroke.js
function addPoint(pts, p) {                       // pts: 当前笔画点序列(CSS px)
  const n = pts.length
  if (n >= 2) {
    const m = mid(pts[n-1], p)
    pts[n-1] = mid(pts[n-2], pts[n-1])            // 上一中点作起点
    pts.push({ c: pts[n-1], e: m })              // 存为一条二次贝塞尔命令
  }
  pts.push(p)
}
// 渲染时把每条命令以 erase blend、圆头粗线 render 进 scratchRT
```

- 极端跳点（>阈值距离，如 120px）视为可能的噪声/抓帧丢失：在两点间仍以直线/贝塞尔连接
  （刮刮卡宁可连成长线也不留断点），但不做跨「取消后重新按下」的连接。

### 4.4 撤销（undo）与全揭开（reveal）

- **以笔画为单位的命令栈**：`strokeHistory` 保存每笔的点序列（纯数据，体量小）。
- `undo()`：
  1. 栈顶弹出一笔；2. **清空 RT 后整体重放**：重新渲染涂层底图，再按剩余笔画依次
  `'erase'` 重绘（`clear:true` 重建一次）。笔画通常只有几笔~几十笔，重建是一次性开销，
  不发生在 pointermove 热路径，可接受；
  3. 重放后立即做一次覆盖率读回并回调 `onProgress`；撤到空栈时涂层恢复 100% 覆盖。
- 不采用「每笔存一张 RT 快照」：N 张全屏纹理显存随笔数线性增长，违背长期无内存增长目标。
- `reveal()`：进入终态。视觉上直接把 coatingSprite 淡出（可选，受
  `prefers-reduced-motion` 约束，见第 6 章）后 `visible=false`，或一次性整层清 alpha；
  停止输入与读回；`onReveal('manual'|'threshold')` 仅触发一次。

### 4.5 异常输入收口

| 异常 | 处理 |
| --- | --- |
| `pointercancel`（来电、系统手势打断） | 结束当前笔、提交已画部分、释放 capture；不与下一按连续 |
| 划出窗口/元素 | 依赖 pointer capture 继续收 move；回入无需特殊处理 |
| 窗口失焦 `window blur` / `document visibilitychange=hidden` | 结束并提交当前笔，清空 `activePointerId`，避免 tab 切回时「悬空一笔」 |
| tab 切后台 | Pixi ticker/RAF 自动暂停；回前台 `ResizeObserver`/首帧复核尺寸与 DPR，变化则 resize+重放 |
| 多点触控 | 只跟踪 capture 的那根指针，其余忽略 |
| 坐标落在卡外 | clamp 到卡边界或直接丢弃该点，但**不结束笔画**（沿边滑动应连续） |

### 4.6 resize / 旋转 / 地址栏收起

- `ResizeObserver(el)` 回调里取新 `r = el.getBoundingClientRect()`；
- `renderer.resize(r.width, r.height, newRes)`、`scratchRT.resize(w,h,newRes)`（`dynamic:true`）；
- resize 会使 RT 内容失效/拉伸，统一策略：**按新尺寸重建 RT 并重放**（重铺底图+重放笔画，
  坐标用 `newCss/oldCss` 比例线性映射）。resize 非高频事件，重建可接受；用 rAF 合帧避免
  移动端地址栏动画期间连续重建。

### 4.7 覆盖率检测（基于 PixiJS 读回像素）

**读回方式（已核实 v8 API）**：`renderer.extract.pixels({ target: scratchRT, resolution? })`
返回 `{ pixels: Uint8ClampedArray, width, height }`（RGBA，来源
`lib/rendering/renderers/shared/extract/ExtractSystem.d.ts` 与
`.../texture/GenerateCanvas.d.ts:9-13`）。统计涂层**仍覆盖**比例：遍历 alpha 通道，
`alpha > 16` 计为「未刮开」；`刮除比例 = 1 − 未刮开像素/总像素`。
（用 RT 而非屏幕：RT 只含涂层、背景透明，读 alpha 即等价覆盖率，不受奖品图颜色干扰。）

**逐像素读回的复杂度与掉帧风险**：

- 全分辨率 RGBA 缓冲 = `W×H×res²×4` 字节。例如 375×200 CSS、res=2 → 1500×800≈120 万像素、
  约 4.8 MB；JS 逐字节循环约百万次/次。
- WebGL 的 `readPixels` 是同步 GPU→CPU 回读，会强制管线 flush 并可能等待，放在 `pointermove`
  每帧执行极易掉帧（管线 stall）。`extract.pixels` 内部还可能经过 canvas 中转，成本更高。

**组合策略（四件套，全部采用）**：

1. **降分辨率读回**：读回时传更低 `resolution`（如固定 0.5，即约 CSS 尺寸的一半栅格），
   或把采样目标设为小尺寸代理 RT。采样像素量降到约 1/4~1/16，统计仍无偏（见误差分析）。
2. **网格步进采样**：不全数遍历，按 stride（如每 4 个采一个）抽样统计，O(n/stride²)。
3. **节流 + 仅在笔后/空闲**：不在 move 中读回；改为「一笔提交后」读一次，外加刮擦中
   每 ~200ms 至多一次，并用 `requestIdleCallback`（无则回退 setTimeout）把回读移出交互帧；
   阈值附近可临时缩短间隔以求及时自动揭开。
4. **增量脏区（优化项，默认关闭）**：记录本次笔画包围盒，只读回脏区并维护「累计已刮像素」
   计数；因 erase 边缘有半透明混合、像素可能重复计入，需对边界像素用同一 alpha 判据幂等更新。
   实现复杂度较高，首版先用 1+2+3；只有实测不达标再上 4。

```js
// 伪代码（≤15 行）：coverage.js
async function measure(renderer, rt, stride = 4) {
  const { pixels, width, height } =
      await renderer.extract.pixels({ target: rt, resolution: 0.5 })
  let covered = 0, counted = 0
  for (let y = 0; y < height; y += stride)
    for (let x = 0; x < width; x += stride) {
      counted++
      if (pixels[(y * width + x) * 4 + 3] > 16) covered++
    }
  return 1 - covered / counted                 // 刮除比例 0..1
}
```

**误差分析**：

- 采样（stride/降分辨率）引入的是空间抽样误差，无系统偏差；在「刮除区域成片连通」的真实
  手势下，抽样比例收敛快，stride=4、0.5x 读回时绝对误差经验上可控制在 ±2% 以内（**具体数值
  待真机实测标定**）。
- 误差对体验的影响只在「阈值临界点」：可能提前/滞后几个百分点触发自动揭开。通过
  (a) 阈值判定加迟滞（达到 `threshold` 即揭，不做来回抖动，因为揭开是单向终态，不存在震荡）；
  (b) 临界区自动加密采样，可把误差影响降到不可感。
- alpha 判据阈值 16 会把擦子边缘抗锯齿半透明像素稳定归类，避免 0/1 抖动。

---

## 5. 风险清单（现象 → 根因 → 规避）

| # | 现象 | 根因 | 规避 |
| --- | --- | --- | --- |
| 1 | 切后台/GPU 重置后白屏或纹理丢失，刮擦无效 | WebGL context lost；自建 RenderTexture 内容不在自动托管范围 | PixiJS 内部已监听 `webglcontextlost/restored` 并 `preventDefault`、恢复时 emit `contextChange` 重建托管资源（`GlContextSystem.js:105-106,178-190`）。**我方**在 canvas 上监听 `webglcontextrestored`：重建 `scratchRT` 内容＝重铺涂层底图 + 用保留的笔画栈重放；恢复期间状态置 busy，忽略输入；监听 `webglcontextlost` 时挂起输入 |
| 2 | iOS 上手指刮擦时页面跟着滚动/下拉刷新，`preventDefault` 不生效 | iOS Safari 对 `document`/`window`/被动 target 的 touch 监听强制 passive；passive 监听里 preventDefault 被忽略 | 首选 canvas 内联 `touch-action:none`（非被动、声明式，iOS 13+ 支持）；另在 **canvas 自身**注册**非 passive** 的 `touchmove`（`{passive:false}`）仅在按刮期间 `preventDefault()`；不依赖 window 级监听。真机 iOS Safari 验证（第 7 章） |
| 3 | 涂层/奖品图跨域后，`extract.pixels` 抛 SecurityError 或读回全 0，纹理「被污染」 | WebGL 对跨域未授权纹理视为不可读；回读即安全异常 | 图片与页面同源，或 CDN 返回 `Access-Control-Allow-Origin` 且加载时带 `crossOrigin='anonymous'`（Pixi `Assets.load`/TextureSource 设 `crossorigin`）；开发期 Vite 用同源资源，不混用本地 file://；加载失败走 `onError` |
| 4 | Vite HMR 保存后出现多个叠层 canvas、事件重复触发、内存上涨 | `main.js` 反复执行而旧 Application 未销毁；Pixi ticker/事件还在 | API 层用 WeakSet 防重复挂载；实现接入时在 `main.js` 加 `import.meta.hot.dispose(() => handle.destroy())` 清理（下一轮改 `main.js`，本轮不写）；`destroy()` 必须幂等。HMR 行为属开发期，生产无此问题，但要在自测中覆盖 |
| 5 | 用户做大幅度刮擦动画/自动揭开淡出时眩晕或不适 | 动效未尊重系统无障碍设置 | 查 `window.matchMedia('(prefers-reduced-motion: reduce)')`；reduce 时取消涂层淡出，改为立即揭开；不做非必要视效 |
| 6 | 键盘/纯鼠标无拖拽、无障碍/无精确指针用户无法完成刮开 | 只有 pointer 涂抹一条路径 | 卡片容器可聚焦（`tabindex="0"`）并提供键盘替代：Enter/Space 触发 `reveal()`、Ctrl/Cmd+Z 触发 `undo()`；ARIA：容器 `role="img"`/`role="button"` 与 `aria-label` 说明「刮刮卡，按回车揭晓」；给出可见「一键揭晓」按钮（由调用方 DOM 提供，调用 `reveal()`） |
| 7 | 3x 屏显存吃紧/老 iPhone 掉帧 | res=3 时 RT 与读回缓冲按 9 倍增长 | DPR 默认封顶 2（`maxPixelRatio`），读回再降到 0.5；真机 3x 目测清晰度，不达标再按需上调 |
| 8 | 页面长期打开内存持续增长 | 笔画点数组、Graphics 几何、读回 Uint8ClampedArray、纹理未释放 | 擦子 Graphics 每帧复用（画完即 `clear()`，不 new）；读回缓冲单次分配、用完释放引用；笔画只存纯点数据（量级小）；RT 固定一块不增长；`destroy()` 调 `app.destroy({removeView:true}, {children:true, texture:true})`（具体销毁选项键名以实现时 d.ts 为准，**待验证**）并解绑全部 DOM 监听、断开 ResizeObserver |
| 9 | 某些浏览器/设备 WebGL 不可用或被策略禁用 | 隐私模式、老设备、GPU 黑名单 | `app.init` 失败捕获 → `onError`；提供明确降级：显示「一键揭晓」按钮（纯 DOM，调用即展示奖品），不用 Canvas2D 重写主渲染（遵守栈锁定） |
| 10 | 容器初始宽高为 0（display:none 时挂载） | 在隐藏容器里初始化得到 0 尺寸 RT | `mountScratchCard` 内若尺寸为 0，先以默认尺寸/等待 `ResizeObserver` 首个非 0 回调再 `init`；`ready` 在首个有效尺寸后 resolve |

---

## 6. 分阶段实施计划（下一轮执行，本轮仅规划）

每阶段都不改动 `index.html`；除阶段 0 外，对 `src/main.js` 仅做「新增 import + 挂载调用」
的最小追加，保留 `setupCounter` 原样。

- **阶段 0 · 接入依赖（不改业务）**：`npm install pixi.js@8.21.0`，确认进入 `dependencies`、
  lockfile 更新；`npm run dev` / `build` 通过；记录构建产物体积（gzip/brotli），回填第 1 章
  「待验证」项。
- **阶段 1 · 舞台与自适应**：`createStage.js`，`app.init({ preference:'webgl', resolution,
  autoDensity:true, backgroundAlpha:0 })`；奖品层 + 纯色涂层 Sprite 叠放；ResizeObserver +
  DPR 封顶；用鼠标临时画圆验证坐标对齐（桌面 1x/浏览器模拟 2x/3x）。
- **阶段 2 · RT 擦除主链路**：`createCoating.js` 用 RenderTexture + `'erase'` 擦子；
  `pointerInput.js` 原生 Pointer Events + capture + `touch-action:none`；`stroke.js`
  贝塞尔中点插值。验收「笔迹连续、快速划无断点、不偏移」。
- **阶段 3 · 覆盖率与自动揭开**：`coverage.js` 降分辨率 + stride + 空闲节流读回；阈值 0.7
  自动揭开、`onProgress/onReveal`；校准真机误差。
- **阶段 4 · 撤销/揭开/生命周期**：`strokeHistory.js` 命令栈与重放、`reveal()`、幂等
  `destroy()`、重复挂载防护、HMR dispose、contextlost 重放。
- **阶段 5 · 移动端与无障碍**：iOS Safari 真机（滚动冲突、地址栏、旋转）、高 DPI、
  reduced-motion、键盘操作与 ARIA；降级（WebGL 不可用）分支。
- **阶段 6 · 性能与长稳**：按第 7 章方法跑帧率/内存长稳；修正后冻结版本。

---

## 7. 验收标准与验证计划（不依赖测试框架）

### 7.1 功能验收（手工自测清单）

桌面（Chrome/Edge/Firefox/Safari 各一遍）：

- [ ] 鼠标慢速涂抹，涂层被刮开且露出正确奖品，边缘圆滑。
- [ ] 快速来回猛划，无糖葫芦断点、无尖角细缝；沿卡片边缘滑动不断线。
- [ ] `undo()` 逐笔恢复（Ctrl/Cmd+Z 或按钮）；撤光后涂层 100% 复原、不触发揭晓。
- [ ] 一键揭晓立即展示奖品；之后再涂抹无反应；`onReveal` 只触发一次、reason 正确。
- [ ] 刮到约 70% 自动揭开并回调；改 `threshold`（如 0.3/0.9）后行为随之变化。
- [ ] 与现有 counter 同页共存：计数按钮正常、`index.html` 与 `src/counter.js` 未被修改
      （用 `git status`/`git diff` 核对本轮零改动）。
- [ ] 键盘：聚焦卡片后 Enter/Space 揭晓、Ctrl+Z 撤销；reduced-motion 下无淡出动画。
- [ ] WebGL 不可用时（DevTools 模拟/扩展阻断）走降级，出现 DOM 揭晓入口且不白屏报错。

移动端 / 高 DPI（真机优先；模拟器补充）：

- [ ] iOS Safari（至少一台真机）：单指涂抹时**页面不滚动、不触发下拉刷新**；多指不乱绘。
- [ ] iOS Safari：切后台再回来、来电/通知打断（用 `pointercancel` 场景）后，当前笔正确收尾，
  可继续刮。
- [ ] 2x（iPhone 标准）与 3x（iPhone Pro/部分安卓）真机：笔迹与指尖对齐（**无偏移**）、
      边缘清晰（**不发虚**）；横竖屏旋转、地址栏收起后坐标仍对齐、涂层自动重建。
- [ ] 安卓 Chrome：同样验证滚动冲突、DPR、旋转。
- [ ] 弱网/跨域图：跨域未授权图片给出 `onError`，不崩溃；同源/CORS 图正常。
- [ ] HMR：dev 下反复保存 `main.js`，页面始终只有一个 canvas、无事件叠加（计数绑定不翻倍）。

### 7.2 性能与稳定性验证方法（手工 + DevTools，无测试框架）

- **帧率**：Chrome DevTools → Performance 录制「快速涂抹 10s」，查看主线程/光栅帧率，
  目标交互期稳定接近 60fps、读回发生时无明显长任务（单次读回占用应低于一帧预算，必要时
  增大 stride/降分辨率）。`chrome://gpu` 确认走的是 WebGL2 硬件加速。
- **读回开销**：在 `coverage.js` 临时用 `performance.now()` 包住 `extract.pixels` 与统计循环
  打日志（验收后删除），确认每次读回总耗时与触发频率（≤ 每 200ms / 每笔）。
- **内存长稳**：DevTools → Memory，页面打开后连续涂抹 + 多次 undo/reveal/reset 数分钟，
  多次手动 GC 后拍堆快照对比，确认 `Uint8ClampedArray`、Graphics、RT 数量不随操作次数增长
  （RT 恒为 1 块、擦子 Graphics 复用）；另用 Performance Monitor 看 JS heap size 无单调爬升。
- **GPU 内存**：`renderer.renderer.texture` 或 WebGL Inspector 观察纹理数量；反复 resize
  后纹理数不泄漏（旧 RT 被 `destroy(true)`）。
- **context lost**：Chrome DevTools 中对 WebGL canvas「Simulate WebGL context loss」
  （或扩展 WEBGL_lose_context），验证恢复后涂层与已刮笔画被正确重放、可继续刮。
- **包体**：`npm run build` 后记录 pixi chunk 的 raw/gzip/brotli 体积，确认按需加载策略
  （如把刮刮卡做成路由/懒加载块），回填 1.3 的待验证数字。

### 7.3 硬性约束自检

- [ ] 本轮 `git status` 仅显示新增 `DESIGN.md`（仓库根），无任何现有文件改动、未新增依赖
      （`package.json`/`package-lock.json` 未变）、文档内无实现代码（仅签名/≤15 行伪代码）。
- [ ] 全栈仅 JavaScript + PixiJS(8.21.0) + Vite(8.3.1)；主渲染无 Canvas2D/其他渲染库替代。
- [ ] 所有 PixiJS 结论均带版本号与来源（第 2.1 节包内路径），不确定项均标「待验证」。

---

## 8. 未决问题（实现阶段需拍板或实测确认）

1. **PixiJS 小版本锁法**：`8.21.0` 精确锁定还是 `^8.21.0`？建议精确锁定，升级单独评审。
2. **v8 描边样式键名**：圆头线帽在 v8 `setStrokeStyle` 中的确切键名（`cap/join` 的字符串值）
   以实现时 `lib/scene/graphics/shared/*.d.ts` 再核对（本设计标「待验证」）；
   `app.destroy` 的 children/texture 销毁选项键名同样以实现时 d.ts 为准。
3. **包体实测**：tree-shaking 后与 gzip/brotli 体积、是否需要把 pixi 拆成独立懒加载 chunk，
   待阶段 0 `vite build` 后用真实数字决定（第 1.3 已标注待验证）。
4. **覆盖率抽样误差标定**：stride=4 + 0.5x 读回在真机上的绝对误差与自动揭开时机的主观感受，
   需真机校准；必要时启用增量脏区（4.7 策略 4）。
5. **3x DPR 封顶**：默认 `maxPixelRatio=2` 的肉眼清晰度需在 3x 真机确认；若评审要求像素级
   锐利，评估 res=3 的显存/帧率代价后再定。
6. **iOS Safari 最低版本口径**：v8 官方支持的最低 iOS 版本未在包内直接读到（标待验证）；
   保守按 iOS 15+ 设计，需在官方文档（pixijs.com 版本说明）确认后写入对外兼容性说明。
7. **奖品内容形态**：默认用 Pixi Sprite 承载奖品图；若产品要求奖品为复杂 DOM（富文本/按钮），
   改为「DOM 奖品层 + 透明 Pixi canvas 覆盖其上」的叠放（坐标链路不变），需在阶段 1 前确认。
8. **WebGPU 是否彻底排除**：本方案锁定 `preference:'webgl'`；未来若启用 WebGPU 需重验
   `'erase'` 在 GPU 路径的语义与 iOS 支持，列入后续技术调研，不在本轮范围。
