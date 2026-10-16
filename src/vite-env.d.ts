/// <reference types="vite/client" />

// TypeScript 6 起 noUncheckedSideEffectImports 默认开启，副作用导入也必须能解析到模块，否则报 
// TS2882（#480 的 CI 就是被这条挡住的）。
