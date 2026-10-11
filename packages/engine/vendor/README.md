# engine/vendor

只发 ESM 的库，用 esbuild 打成**全局变量的 IIFE**，项目里在 `META.vendor` 里按名字引用（`vendor: ['three']` → `vendor/three.js`，全局 `THREE`）。

不用 ES 模块 + import map：页面是 file:// 打开的，Chromium 会以 CORS（origin null）拦掉所有 module 脚本，预览和出片都加载不了（2026-10-08 实测）。

重新打包（升级版本或要加 addons 时改 entry）：

```bash
cd packages/engine && npx esbuild vendor/three.entry.mjs --bundle --format=iife --global-name=THREE --minify --outfile=vendor/three.js
```
