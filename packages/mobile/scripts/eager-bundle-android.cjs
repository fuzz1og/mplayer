/**
 * Pre-bundle Android JS + assets for eager Gradle build.
 * Replicates exportEagerAsync but preserves sourcemapOutput for key matching.
 */
const fs = require('fs');
const path = require('path');
const { resolveEagerOptionsAsync, getExportEmbedOptionsKey } = require('@expo/cli/build/src/export/embed/resolveOptions');
const { exportEmbedInternalAsync } = require('@expo/cli/build/src/export/embed/exportEmbedAsync');

const projectRoot = process.cwd();
const outFile = process.argv[2] || path.join(projectRoot, 'dist-eager', 'eager-options.json');

const sourcemapOutput = path.join(
  projectRoot,
  'android', 'app', 'build', 'intermediates', 'sourcemaps', 'react', 'release',
  'index.android.bundle.packager.map'
);

(async () => {
  const options = await resolveEagerOptionsAsync(projectRoot, {
    dev: false,
    platform: 'android',
    sourcemapOutput,
    resetCache: false,
  });

  await exportEmbedInternalAsync(projectRoot, options);

  const result = { options, key: getExportEmbedOptionsKey(options) };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result));
  console.log('Eager options written to', outFile);
})().catch((err) => {
  console.error('Eager bundle failed:', err);
  process.exit(1);
});
