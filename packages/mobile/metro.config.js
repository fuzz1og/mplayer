const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro 在 Windows 上会 watch 整个 monorepo，任何被外部进程删除的目录都会导致
// watcher 崩溃（ENOENT: watch）。blockList 排除易消失的构建/工具产物目录。
// 注意：不能排除 dist/ —— @mplayer/core 的入口就是 packages/core/dist/index.js。
config.resolver.blockList = [
  ...(config.resolver.blockList || []),
  /node_modules[\\/]\.(istanbul|vitest|tmp|cache|store|bin)-[^\\/]*[\\/]/,
  /[\\/]\.expo[\\/]/,
  /[\\/]android[\\/]build[\\/]/,
  /[\\/]ios[\\/]build[\\/]/,
  /[\\/]coverage[\\/]/,
  /[\\/]test-results[\\/]/,
  /[\\/]e2e[\\/]screenshots[\\/]/,
];

module.exports = config;
