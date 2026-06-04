const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Kill running MPlayer (Windows only, silent fail otherwise)
if (process.platform === 'win32') {
  try {
    execSync('taskkill /f /im MPlayer.exe', { stdio: 'ignore' });
  } catch {
    // Process not running, ignore
  }
}

// Clean build output directories
for (const dir of ['dist', 'dist-electron']) {
  const target = path.join(process.cwd(), dir);
  fs.rmSync(target, { recursive: true, force: true });
}
