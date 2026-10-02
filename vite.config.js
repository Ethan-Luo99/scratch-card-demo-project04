import { defineConfig } from 'vite'

// 唯一的构建定制：把 pixi.js 强制合并为单个名为 pixi 的手动 chunk。
// 背景：pixi.js 在 src/scratch/mountScratchCard.js 中通过 import('pixi.js') 动态引入，
// 本身已是懒加载；但 rolldown 默认把 node_modules 碎成十余个异步 chunk
// （含多个 <1 kB 转发块），不利于「独立懒加载 chunk」的确定性断言与长期缓存。
// 决策与 §1.3「原则上不需要新增配置文件」的冲突取舍已记录在 DESIGN.md §9。
export default defineConfig({
  build: {
    // 关闭 modulePreload：否则 __vitePreload 运行时会被打进 pixi chunk，
    // 入口为引用它而静态 import pixi chunk，懒加载失效（实测验证，见 DESIGN.md §9）
    modulePreload: false,
    rollupOptions: {
      output: {
        // rolldown 的 manualChunks 仅支持函数形式（对象形式会构建报错，实测）
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js')) return 'pixi'
          // __vitePreload 运行时的模块 id 为 \0vite/preload-helper.js（实测）；
          // 不干预时会被 rolldown 分进 pixi chunk，迫使入口静态引用它 → 懒加载失效。
          // 实测 rolldown 对该虚拟模块只认「并入已有入口名」，返回新 chunk 名会被忽略，
          // 故返回入口名 index（产物为一个 ~1.4 kB 的同名小 chunk，入口静态引用它，pixi 保持懒加载）
          if (id.includes('vite/preload-helper')) return 'index'
        },
      },
    },
  },
})
