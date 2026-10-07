import './style.css'
import heroImg from './assets/hero.png'
import javascriptLogo from './assets/javascript.svg'
import viteLogo from './assets/vite.svg'
import { setupCounter } from './counter.js'
import { mountScratchCardGroup } from './scratch/index.js'

document.querySelector('#app').innerHTML = `
<section id="center">
  <div class="hero">
    <img src="${heroImg}" class="base" width="170" height="179">
    <img src="${javascriptLogo}" class="framework" alt="JavaScript logo"/>
    <img src="${viteLogo}" class="vite" alt="Vite logo" />
  </div>
  <div>
    <h1>Get started</h1>
    <p>Edit <code>src/main.js</code> and save to test <code>HMR</code></p>
  </div>
  <button id="counter" type="button" class="counter"></button>
</section>

<div class="ticks"></div>

<section id="next-steps">
  <div id="docs">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="/icons.svg#documentation-icon"></use></svg>
    <h2>Documentation</h2>
    <p>Your questions, answered</p>
    <ul>
      <li>
        <a href="https://vite.dev/" target="_blank">
          <img class="logo" src="${viteLogo}" alt="" />
          Explore Vite
        </a>
      </li>
      <li>
        <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript" target="_blank">
          <img class="button-icon" src="${javascriptLogo}" alt="">
          Learn more
        </a>
      </li>
    </ul>
  </div>
  <div id="social">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="/icons.svg#social-icon"></use></svg>
    <h2>Connect with us</h2>
    <p>Join the Vite community</p>
    <ul>
      <li><a href="https://github.com/vitejs/vite" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#github-icon"></use></svg>GitHub</a></li>
      <li><a href="https://chat.vite.dev/" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#discord-icon"></use></svg>Discord</a></li>
      <li><a href="https://x.com/vite_js" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#x-icon"></use></svg>X.com</a></li>
      <li><a href="https://bsky.app/profile/vite.dev" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#bluesky-icon"></use></svg>Bluesky</a></li>
    </ul>
  </div>
</section>

<div class="ticks"></div>
<section id="spacer"></section>
`

setupCounter(document.querySelector('#counter'))

const scratchHosts = []
for (let i = 0; i < 3; i++) {
  const host = document.createElement('div')
  host.className = 'scratch-card'
  host.style.cssText =
    'width:320px;height:180px;margin:24px auto;border-radius:12px;overflow:hidden;'
  document.querySelector('#app').appendChild(host)
  scratchHosts.push(host)
}
const scratchGroup = mountScratchCardGroup(scratchHosts)
window.__scratchGroup = scratchGroup // 人工验证挂钩（DESIGN.md §12.6）

// —— 增强包二期：重放演示（唯一追加块）——
// 一个按钮演示两件事：
// ① 跨尺寸会话重放：导出第 1 张卡的会话，重放进一张 300×240（宽高比不同）的新卡，
//    笔迹应按「录制尺寸 → 目标尺寸」仿射映射（刮到哪里、重放就在哪里）；
// ② 组级连锁揭晓：随重放卡新建一个 chainReveal:true 的 3 卡组，
//    把该组任一卡刮到自动揭晓（或聚焦后按回车），其余两卡应在约 100/200ms 后
//    依次自行演示揭晓，且控制台只有真实揭晓那一条 onReveal 日志。
{
  const replayBtn = document.createElement('button')
  replayBtn.type = 'button'
  replayBtn.className = 'counter'
  replayBtn.textContent = '重放演示（跨尺寸 + 连锁揭晓）'
  replayBtn.style.cssText = 'display:block;margin:0 auto 24px;'
  replayBtn.addEventListener('click', async () => {
    const source = scratchGroup.cards[0]
    if (!source) return
    await source.ready
    let session
    try {
      session = source.exportSession()
    } catch (err) {
      window.alert(`重放演示导出失败：${err.message}`)
      return
    }
    const section = document.createElement('section')
    section.style.cssText = 'text-align:center;'
    const hosts = []
    for (let i = 0; i < 3; i++) {
      const host = document.createElement('div')
      host.className = 'scratch-card'
      host.style.cssText =
        'display:inline-block;width:300px;height:240px;margin:12px;border-radius:12px;overflow:hidden;'
      section.appendChild(host)
      hosts.push(host)
    }
    document.querySelector('#app').appendChild(section)
    const demoGroup = mountScratchCardGroup(hosts, {
      chainReveal: true,
      onReveal: (reason) => console.log('[demo] 真实揭晓 onReveal:', reason),
    })
    window.__lastDemoGroup = demoGroup // 人工验证挂钩（DESIGN.md §12.6 步骤 4）
    await demoGroup.cards[0].ready
    demoGroup.cards[0].replaySession(session)
  })
  document.querySelector('#app').appendChild(replayBtn)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => scratchGroup.destroy())
}
