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
        console.warn('[@expo/vector-icons] fonts directory not found, skipping');
        return config;
      }

      fs.mkdirSync(targetDir, { recursive: true });

      const files = fs.readdirSync(VECTOR_ICONS_FONTS_DIR).filter(f => f.endsWith('.ttf'));
      for (const file of files) {
        const src = path.join(VECTOR_ICONS_FONTS_DIR, file);
        const dst = path.join(targetDir, file.toLowerCase());
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
        }
      }
      console.log(`[withVectorIconsFonts] copied ${files.length} icon fonts to ${targetDir}`);

      return config;
    },
  ]);
};
