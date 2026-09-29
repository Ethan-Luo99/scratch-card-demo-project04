// Public shell: zero Pixi imports here so PixiJS (and the whole rendering
// runtime) lands in a separate chunk that is fetched lazily on the first
// mountScratchCard() call, instead of blocking the initial page load.
const mountedElements = new WeakSet()
let runtimePromise = null

function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('./scratchRuntime.js')
  }
  return runtimePromise
}

export function mountScratchCard(el, options = {}) {
  if (!(el instanceof HTMLElement)) {
    throw new TypeError('mountScratchCard: el must be an HTMLElement')
  }
  if (mountedElements.has(el)) {
    throw new Error('mountScratchCard: element already has a scratch card mounted')
  }
  mountedElements.add(el)

  let inner = null
  let destroyed = false
  const pending = []
  let readyResolve
  let readyReject
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  loadRuntime()
    .then(({ mountScratchCardRuntime }) => {
      if (destroyed) return
      inner = mountScratchCardRuntime(el, options)
      inner.ready.then(readyResolve, readyReject)
      while (pending.length) {
        const call = pending.shift()
        call(inner)
      }
    })
    .catch((err) => {
      if (!destroyed) {
        options.onError?.(err)
        readyReject(err)
      }
    })

  function runWhenReady(call) {
    if (inner) call(inner)
    else pending.push(call)
  }

  return {
    ready: readyPromise,
    reveal() {
      if (destroyed) return
      runWhenReady((handle) => handle.reveal())
    },
    undo() {
      if (destroyed) return false
      if (inner) return inner.undo()
      return false
    },
    getProgress() {
      return inner ? inner.getProgress() : 0
    },
    resize() {
      inner?.resize()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      pending.length = 0
      mountedElements.delete(el)
      inner?.destroy()
    },
  }
}
