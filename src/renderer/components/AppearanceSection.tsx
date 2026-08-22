import React from 'react';
import { Palette } from 'lucide-react';
import { THEME_MODES } from '@/renderer/theme/theme';
import { useThemeMode } from '@/renderer/theme/ThemeManager';

/** 外观：主题三态切换（跟随系统/浅色/深色），与移动端一致 */
const AppearanceSection: React.FC = () => {
  const { mode, setMode } = useThemeMode();

  return (
    <section id="appearance" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Palette size={20} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>外观</h2>
      </div>
      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-default)' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
          主题模式：跟随系统时随操作系统深浅色自动切换，也可手动指定。
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {THEME_MODES.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'var(--accent)' : 'var(--bg-hover)',
                  color: active ? 'var(--text-inverse)' : 'var(--text-secondary)',
                  border: active ? '1px solid var(--accent)' : '1px solid var(--border-default)',
                  transition: 'background 0.15s ease, color 0.15s ease',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default AppearanceSection;
