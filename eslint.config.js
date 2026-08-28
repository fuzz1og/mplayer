const tseslint = require('typescript-eslint');
const globals = require('globals');

// ScalePress 绞杀白名单（#261 批4）：确需 TouchableOpacity 的 mobile UI 文件
// 登记于此获得豁免（登记时注释理由），绞杀已清零，期望本表恒为空。
const mobileTouchableWhitelist = [];

module.exports = tseslint.config(
  // Global ignores
  {
    ignores: ['dist/', 'dist-electron/', 'coverage/', 'node_modules/', 'packages/core/dist/', 'packages/core/coverage/', '.expo/', 'packages/mobile/.expo/', 'src/main/storage/fileStorage.ts', '.dsh-worktrees/', '.claude/worktrees/'],
  },
  // Base recommended rules
  ...tseslint.configs.recommended,
  // Project configuration
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-case-declarations': 'off',
    },
  },
  // ScalePress 绞杀防回潮（#261）：mobile UI 禁用 TouchableOpacity——
  // 按压反馈统一 ScalePress（弹簧缩放），遮罩/拦截器等无动画语义用 Pressable；
  // 选型依据见 packages/mobile/components/ScalePress.tsx 头注释。
  // selector 同时拦普通标识符与 RN.TouchableOpacity 成员表达式写法
  {
    files: ['packages/mobile/components/**/*.tsx', 'packages/mobile/app/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "JSXOpeningElement[name.name='TouchableOpacity'], JSXOpeningElement[name.property.name='TouchableOpacity']",
        message: 'mobile UI 禁用 TouchableOpacity：按压反馈用 ScalePress（components/ScalePress.tsx），无动画语义（遮罩/拦截器）用 Pressable；确需豁免登记 eslint.config.js 的 mobileTouchableWhitelist',
      }],
    },
  },
  // 白名单豁免块：空表时不生成配置块。
  // 注意是规则级豁免——本仓库 no-restricted-syntax 仅此一条 selector，故无连带；
  // 将来若增加其他受限语法，须改为 selector 级豁免（拆独立规则）。
  ...(mobileTouchableWhitelist.length > 0
    ? [{
        files: mobileTouchableWhitelist,
        rules: { 'no-restricted-syntax': 'off' },
      }]
    : []),
);
