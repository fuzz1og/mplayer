const tseslint = require('typescript-eslint');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');

// ScalePress 绞杀白名单（#261 批4）：确需 TouchableOpacity 的 mobile UI 文件
// 登记于此获得豁免（登记时注释理由），绞杀已清零，期望本表恒为空。
const mobileTouchableWhitelist = [];

module.exports = tseslint.config(
  // Global ignores
  {
    // e2e/artifacts/：真机验收的驱动脚本与产物（截图/report），已被 .gitignore 覆盖。
    // 不排掉的话，每次做验收都会因为驱动脚本里的调试性 unused var 让 `npm run lint` 变红——
    // 而 lint 只该管入库的代码。
    ignores: ['dist/', 'dist-electron/', 'coverage/', 'node_modules/', 'packages/core/dist/', 'packages/core/coverage/', '.expo/', 'packages/mobile/.expo/', 'src/main/storage/fileStorage.ts', '.dsh-worktrees/', '.claude/worktrees/', 'e2e/artifacts/'],
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
  // React Hooks 规则：`rules-of-hooks` 是唯一能静态拦住「hook 落在早返回之后」这类
  // Render Error 的门禁。本仓库此前**没装 eslint-plugin-react-hooks**，该规则从未运行——
  // 于是 discover-playlist/[id].tsx 的 useCallback 落在两处 early return 之后也一路绿灯，
  // 页面一加载完就崩（Rendered more hooks than during the previous render）。
  // 只开 rules-of-hooks（正确性），不开 exhaustive-deps（风格/性能，历史代码噪音大）。
  {
    files: ['src/**/*.{ts,tsx}', 'packages/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
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
