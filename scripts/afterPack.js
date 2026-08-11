// 打包后清理：移除 Electron 自带的 Chromium 许可声明文件（约 18MB）
// 注意：该文件由 electron-builder 的 unpack-electron 步骤拷贝，files 排除模式对其不生效，
// 只能通过 afterPack 钩子删除。macOS 端 electron-builder 本身就会删除此文件。
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  const licenseFile = path.join(appOutDir, 'LICENSES.chromium.html');
  if (fs.existsSync(licenseFile)) {
    fs.unlinkSync(licenseFile);
    console.log(`[afterPack] removed ${licenseFile}`);
  }
};
