/**
 * Pre-bundle Android JS + assets for eager Gradle build.
 * Replicates what `npx expo run:android` does internally:
 *   1. exportEagerAsync → bundle + assets → temp dir
 *   2. JSON.stringify({ options, key }) → stdout
 *   3. CI captures stdout and sets __EXPO_EAGER_BUNDLE_OPTIONS
 *   4. Gradle's createBundleReleaseJsAndAssets reads the env var,
 *      compares keys, and copies pre-bundled output instead of re-bundling.
 */
const { exportEagerAsync } = require('@expo/cli/build/src/export/embed/exportEager');

const projectRoot = process.cwd();

(async () => {
  const result = await exportEagerAsync(projectRoot, {
    dev: false,
    platform: 'android',
    // resetCache defaults to !CI, so it's false in CI
  });
  // result = { options: Options, key: string }
  // __EXPO_EAGER_BUNDLE_OPTIONS expects JSON.parse → { options, key }
  process.stdout.write(JSON.stringify(result));
})().catch((err) => {
  console.error('Eager bundle failed:', err);
  process.exit(1);
});
