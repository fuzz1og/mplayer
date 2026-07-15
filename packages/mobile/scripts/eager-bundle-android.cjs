/**
 * Pre-bundle Android JS + assets for eager Gradle build.
 * Writes __EXPO_EAGER_BUNDLE_OPTIONS JSON to a temp file for CI to read.
 *
 * Why sourcemapOutput is needed:
 * Gradle's createBundleReleaseJsAndAssets passes --sourcemap-output to
 * @expo/cli export:embed. The eager key (getExportEmbedOptionsKey) strips
 * bundleOutput/assetsDest/verbose/maxWorkers/resetCache but NOT sourcemapOutput.
 * Without matching sourcemapOutput, keys mismatch → eager assets discarded,
 * Gradle re-bundles from scratch → font .ttf files may not be included correctly.
 */
const fs = require('fs');
const path = require('path');
const { exportEagerAsync } = require('@expo/cli/build/src/export/embed/exportEager');

const projectRoot = process.cwd();
const outFile = process.argv[2] || path.join(projectRoot, 'dist-eager', 'eager-options.json');

// Match the sourcemap path that Gradle's createBundleReleaseJsAndAssets uses.
// This is a well-known path from react-native Gradle plugin / expo's build.gradle.
const sourcemapOutput = path.join(
  projectRoot,
  'android',
  'app',
  'build',
  'intermediates',
  'sourcemaps',
  'react',
  'release',
  'index.android.bundle.packager.map'
);

(async () => {
  const result = await exportEagerAsync(projectRoot, {
    dev: false,
    platform: 'android',
    sourcemapOutput,
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result));
  console.log('Eager options written to', outFile);
})().catch((err) => {
  console.error('Eager bundle failed:', err);
  process.exit(1);
});
