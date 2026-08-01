const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const result = spawnSync(
  'npx vitest run --config vitest.main.config.ts --coverage.enabled=false src/__tests__/main/chartAggregator.test.ts',
  { cwd: root, stdio: 'inherit', shell: true }
);

process.exit(result.status === null ? 1 : result.status);
