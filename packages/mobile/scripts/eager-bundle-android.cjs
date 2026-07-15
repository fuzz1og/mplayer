/**
 * Pre-bundle Android JS + assets for eager Gradle build.
 * Writes __EXPO_EAGER_BUNDLE_OPTIONS JSON to a temp file for CI to read.
 */
const fs = require('fs');
const path = require('path');
const { exportEagerAsync } = require('@expo/cli/build/src/export/embed/exportEager');

const projectRoot = process.cwd();
const outFile = process.argv[2] || path.join(projectRoot, 'dist-eager', 'eager-options.json');

(async () => {
  const result = await exportEagerAsync(projectRoot, {
    dev: false,
    platform: 'android',
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result));
  console.log('Eager options written to', outFile);
})().catch((err) => {
  console.error('Eager bundle failed:', err);
  process.exit(1);
});
