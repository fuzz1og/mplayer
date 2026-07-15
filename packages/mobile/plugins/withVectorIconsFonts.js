const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const VECTOR_ICONS_FONTS_DIR = path.join(
  require.resolve('@expo/vector-icons/package.json'),
  '..',
  'build',
  'vendor',
  'fonts'
);

/**
 * @expo/vector-icons fontFamily name for each icon font file.
 * Maps source filename → destination basename (without .ttf).
 * Android font scanner registers filename as fontFamily;
 * RNVI create-icon-set uses fontFamily (from createIconSet 2nd param) as fontReference on Android.
 */
const FONT_FAMILY_MAP = {
  'AntDesign.ttf': 'anticon',
  'Entypo.ttf': 'entypo',
  'EvilIcons.ttf': 'evilicons',
  'Feather.ttf': 'feather',
  'FontAwesome.ttf': 'FontAwesome',
  'FontAwesome5_Brands.ttf': null,  // FA5 uses createMultiStyleIconSet, different mechanism
  'FontAwesome5_Regular.ttf': null,
  'FontAwesome5_Solid.ttf': null,
  'FontAwesome6_Brands.ttf': null,  // FA6 same
  'FontAwesome6_Regular.ttf': null,
  'FontAwesome6_Solid.ttf': null,
  'Fontisto.ttf': 'Fontisto',
  'Foundation.ttf': 'foundation',
  'Ionicons.ttf': 'ionicons',
  'MaterialCommunityIcons.ttf': 'material-community',
  'MaterialIcons.ttf': 'Material Icons',
  'Octicons.ttf': 'Octicons',
  'SimpleLineIcons.ttf': 'simple-line-icons',
  'Zocial.ttf': 'zocial',
};

module.exports = function withVectorIconsFonts(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const targetDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'fonts'
      );

      if (!fs.existsSync(VECTOR_ICONS_FONTS_DIR)) {
        console.warn('[withVectorIconsFonts] vendor fonts directory not found, skipping');
        return config;
      }

      fs.mkdirSync(targetDir, { recursive: true });

      const files = fs.readdirSync(VECTOR_ICONS_FONTS_DIR).filter(f => f.endsWith('.ttf'));
      let copied = 0;
      let skipped = 0;

      for (const file of files) {
        const src = path.join(VECTOR_ICONS_FONTS_DIR, file);
        const family = FONT_FAMILY_MAP[file];

        if (!family) {
          console.log(`[withVectorIconsFonts] skip ${file} (no fontFamily mapping)`);
          skipped++;
          continue;
        }

        const dstName = `${family}.ttf`;
        const dst = path.join(targetDir, dstName);

        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          console.log(`[withVectorIconsFonts] copy ${file} → ${dstName}`);
          copied++;
        } else {
          console.log(`[withVectorIconsFonts] skip ${file} → ${dstName} (already exists)`);
          skipped++;
        }
      }

      console.log(
        `[withVectorIconsFonts] done: ${copied} copied, ${skipped} skipped (${targetDir})`
      );

      return config;
    },
  ]);
};
