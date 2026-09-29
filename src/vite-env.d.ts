/// <reference types="vite/client" />

// Vite 处理的资源导入（`import './styles/global.css'`、`*.svg` 等）在构建期由 Vite 解析，
// 但类型层面需要声明。TypeScript 6 起 noUncheckedSideEffectImports 默认开启，
// 副作用导入也必须能解析到模块，否则报 TS2882（#480 的 CI 就是被这条挡住的）。
// vite/client 正好提供这组声明（含 *.css / 静态资源与 import.meta.env），
// 这也是 Vite 官方脚手架生成的同名文件；本仓库此前漏了它，被 TS 6 暴露出来。
