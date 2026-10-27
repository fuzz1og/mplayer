import React from 'react';
import { Palette } from 'lucide-react';
import { THEME_MODES } from '@/renderer/theme/theme';
import { useThemeMode } from '@/renderer/theme/ThemeManager';
import { Segmented } from '@/renderer/ui';

/** 外观：主题三态（跟随系统 / 浅色 / 深色），选中态用表面差而不是品牌蓝。 */
const AppearanceSection: React.FC = () => {
  const { mode, setMode } = useThemeMode();

  return (
    <section id="appearance">
      <div className="settings-page__title">
        <Palette size={16} aria-hidden="true" />
        <h1>外观</h1>
      </div>

      <div className="settings-page__lead">跟随系统时随操作系统的深浅色自动切换，也可以手动指定。</div>

      <Segmented
        options={THEME_MODES.map((option) => option.value)}
        value={mode}
        onChange={(value) => setMode(value as typeof mode)}
        ariaLabel="主题模式"
      />

      <p className="settings-page__footnote">
        {THEME_MODES.map((option) => (option.value === mode ? option.label : null)).filter(Boolean)}
        ：主题切换即时生效，重启后保持上次选择。
      </p>
    </section>
  );
};

export default AppearanceSection;
