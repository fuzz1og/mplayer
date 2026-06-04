// 必须在所有模块之前加载，设置 @electron/get 的 proxy 开关
// @electron/get 在模块加载时检查 ELECTRON_GET_USE_PROXY
process.env.ELECTRON_GET_USE_PROXY = '1';
