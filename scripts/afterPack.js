// 打包后清理 Electron 运行时里用不到的大文件：
// - LICENSES.chromium.html：约 20MB，由 electron-builder unpack 步骤拷贝，files 排除项管不到（#718）
// - dxcompiler.dll / dxil.dll：Windows WebGPU(Dawn/D3D12) 着色器编译器，应用不使用 WebGPU
const fs = require('fs');
const path = require('path');

const ROOT_REMOVALS = ['LICENSES.chromium.html'];
const WINDOWS_REMOVALS = ['dxcompiler.dll', 'dxil.dll'];

function removeIfExists(appOutDir, name) {
  const file = path.join(appOutDir, name);
  if (!fs.existsSync(file)) return;
  fs.unlinkSync(file);
  console.log(`[afterPack] removed ${file}`);
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  for (const name of ROOT_REMOVALS) removeIfExists(appOutDir, name);
  if (electronPlatformName === 'win32') {
    for (const name of WINDOWS_REMOVALS) removeIfExists(appOutDir, name);
  }
};
