import { realpathSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
const ALLOW = path.resolve('.qoder/worktrees/agent-general-purpose-75b1a43e/packages/core/dist');
const target = path.resolve(process.argv[2] || ALLOW);
if (target !== ALLOW) { console.error('refuse: not allowlisted', target); process.exit(1); }
if (!existsSync(target)) { console.log('already gone'); process.exit(0); }
const real = realpathSync(target);
if (!real.split(path.sep).includes('.qoder')) { console.error('refuse: escaped .qoder ->', real); process.exit(1); }
rmSync(real, { recursive: true, force: true });
console.log('deleted build output:', real);
