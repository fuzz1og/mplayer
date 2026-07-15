/**
 * Pre-bundle Android JS + assets for eager Gradle build.
 * Also copies asset files to Gradle's expected output path.
 *
 * Why copy: Gradle's createBundleReleaseJsAndAssets calls export:embed
 * WITHOUT --assets-dest, so Metro assets (fonts, images) are never written
 * to the APK's assets/ directory. Only the JS bundle ends up there.
 * expo-asset on Android reads from assets/, so fonts appear missing.
 *
 * This script copies the pre-bundled assets to the same directory Gradle
 * uses for the bundle, so they're included in the final APK.
 */
const fs = require('fs');
const path = require('path');
const { exportEagerAsync } = require('@expo/cli/build/src/export/embed/exportEager');

const projectRoot = process.cwd();
const outFile = process.argv[2] || path.join(projectRoot, 'dist-eager', 'eager-options.json');

// Gradle's createBundleReleaseJsAndAssets writes the bundle here.
// Assets should be alongside it so mergeReleaseAssets picks them up.
const gradleAssetsDir = path.join(
  projectRoot,
  'android', 'app', 'build', 'generated', 'assets', 'createBundleReleaseJsAndAssets'
);

(async () => {
  const result = await exportEagerAsync(projectRoot, {
    dev: false,
    platform: 'android',
  });

  // Write eager options for Gradle (even with key mismatch, assets pre-cached)
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result));

  // Copy pre-bundled assets to Gradle's expected output directory.
  // This ensures .ttf and other asset files appear in APK's assets/.
  if (result.options.assetsDest && fs.existsSync(result.options.assetsDest)) {
    fs.mkdirSync(gradleAssetsDir, { recursive: true });
    const entries = fs.readdirSync(result.options.assetsDest, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(result.options.assetsDest, entry.name);
      const dst = path.join(gradleAssetsDir, entry.name);
      if (entry.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, dst);
      }
    }
    console.log(`Copied ${entries.length} asset files to ${gradleAssetsDir}`);
  } else {
    console.warn('No assets directory found in eager output:', result.options.assetsDest);
  }

  console.log('Eager options written to', outFile);
})().catch((err) => {
  console.error('Eager bundle failed:', err);
  process.exit(1);
});
