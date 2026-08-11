const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const VECTOR_ICONS_FONTS_DIR = path.join(
  require.resolve('@expo/vector-icons/package.json'),
  '..',
  'build',
  'vendor',
  'react-native-vector-icons',
  'Fonts'
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
  'MaterialIcons.ttf': 'material',
  'Octicons.ttf': 'octicons',
  'SimpleLineIcons.ttf': 'simple-line-icons',
  'Zocial.ttf': 'zocial',
};

// 只拷贝实际用到的字体族，避免 APK 内嵌全部 19 个图标字体
// （移动端代码仅深度导入 Ionicons / MaterialCommunityIcons，见各组件 import）
const ALLOWED_FONTS = new Set(['Ionicons.ttf', 'MaterialCommunityIcons.ttf']);

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
        if (!ALLOWED_FONTS.has(file)) {
          console.log(`[withVectorIconsFonts] skip ${file} (not in ALLOWED_FONTS)`);
          skipped++;
          continue;
        }
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
