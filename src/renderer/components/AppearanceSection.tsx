import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorSmartphone, Moon, Play, Rows3, Sparkles, Type } from 'lucide-react';
import { THEME_MODES, type ThemeMode } from '@/renderer/theme/theme';
import { useThemeMode } from '@/renderer/theme/ThemeManager';
import {
  readPrefs,
  subscribeAppearance,
  writePrefs,
  type Density,
  type FontScale,
  type LyricsSize,
} from '@/renderer/theme/appearancePrefs';
import { usePlayerStore } from '@/renderer/store/playerStore';
import SongCover from '@/renderer/components/SongCover';
import { Button, Group, Row, Section, Segmented, Switch } from '@/renderer/ui';

/** Segmented 只显示中文 label，值↔label 的映射留在组件内（原语只收 string 数组）。 */
const THEME_LABELS = THEME_MODES.map((option) => option.label);
const labelToTheme = new Map(THEME_MODES.map((option) => [option.label, option.value]));
const themeToLabel = (mode: ThemeMode): string => THEME_MODES.find((option) => option.value === mode)?.label ?? '跟随系统';

const DENSITY_LABELS: Record<Density, string> = { standard: '标准', compact: '紧凑' };
const densityLabels = [DENSITY_LABELS.standard, DENSITY_LABELS.compact];
const FONT_LABELS: Record<FontScale, string> = { small: '小', standard: '标准', large: '大' };
const fontLabels = [FONT_LABELS.small, FONT_LABELS.standard, FONT_LABELS.large];
const LYRICS_LABELS: Record<LyricsSize, string> = { standard: '标准', large: '更大' };
const lyricsLabels = [LYRICS_LABELS.standard, LYRICS_LABELS.large];

function invert<T extends string>(map: Record<T, string>): (label: string, fallback: T) => T {
  const entries = Object.entries(map) as [T, string][];
  return (label, fallback) => entries.find(([, value]) => value === label)?.[0] ?? fallback;
}

/**
 * 外观页（1.9.0 原型 §2）：外观 / 文字与动效 / 预览 三组。
 * 密度·材质·字号·动效·歌词字号存 localStorage 并写 html[data-*]；主题仍以 db 为事实源。
 */
const AppearanceSection: React.FC = () => {
  const { mode, setMode } = useThemeMode();
  const [prefs, setPrefs] = useState(readPrefs);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const play = usePlayerStore((s) => s.play);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  useEffect(() => subscribeAppearance(setPrefs), []);

  const update = useCallback(
    (patch: Parameters<typeof writePrefs>[0]) => setPrefs(writePrefs(patch)),
    [],
  );

  const handleTheme = (label: string) => {
    const next = labelToTheme.get(label) ?? 'system';
    setMode(next);
  };

  const handlePlay = () => {
    if (!currentSong) return;
    if (isPlaying) togglePlay();
    else void play(currentSong);
  };

  // 「与系统同步」不是独立开关：mode = 跟随系统 即已开启（只读展示，避免两个状态源）
  const syncedDetail = useMemo(() => (mode === 'system' ? '已开启' : '已关闭'), [mode]);

  return (
    <section id="appearance">
      <div className="settings-page__head">
        <h1>外观</h1>
        <p className="settings-page__lead">主题、密度与材质</p>
      </div>

      <div className="settings-page__stack">
        <Section
          title="外观"
          footer="材质依赖系统模糊效果，关闭后改为不透明表面，性能更稳定。"
        >
          <Group>
            <Row
              icon={<MonitorSmartphone size={13} />}
              label="主题"
              trailing={
                <Segmented
                  options={THEME_LABELS}
                  value={themeToLabel(mode)}
                  onChange={handleTheme}
                  ariaLabel="主题"
                />
              }
            />
            <Row
              icon={<Moon size={13} />}
              label="外观与系统同步时，自动跟随 Windows 主题"
              trailing={<span className="appearance-readout">{syncedDetail}</span>}
            />
            <Row
              icon={<Rows3 size={13} />}
              label="界面密度"
              trailing={
                <Segmented
                  options={densityLabels}
                  value={DENSITY_LABELS[prefs.density]}
                  onChange={(label) => update({ density: invert(DENSITY_LABELS)(label, 'standard') })}
                  ariaLabel="界面密度"
                />
              }
            />
            <Row
              label="侧栏与播放栏使用半透明材质"
              trailing={
                <Switch
                  checked={prefs.material === 'on'}
                  onChange={(checked) => update({ material: checked ? 'on' : 'off' })}
                  ariaLabel="侧栏与播放栏使用半透明材质"
                />
              }
            />
          </Group>
        </Section>

        <Section title="文字与动效">
          <Group>
            <Row
              icon={<Type size={13} />}
              label="字号"
              trailing={
                <Segmented
                  options={fontLabels}
                  value={FONT_LABELS[prefs.fontScale]}
                  onChange={(label) => update({ fontScale: invert(FONT_LABELS)(label, 'standard') })}
                  ariaLabel="字号"
                />
              }
            />
            <Row
              icon={<Sparkles size={13} />}
              label="减弱动态效果"
              trailing={
                <Switch
                  checked={prefs.reduceMotion === 'on'}
                  onChange={(checked) => update({ reduceMotion: checked ? 'on' : 'off' })}
                  ariaLabel="减弱动态效果"
                />
              }
            />
            <Row
              label="歌词字号"
              trailing={
                <Segmented
                  options={lyricsLabels}
                  value={LYRICS_LABELS[prefs.lyricsSize]}
                  onChange={(label) => update({ lyricsSize: invert(LYRICS_LABELS)(label, 'standard') })}
                  ariaLabel="歌词字号"
                />
              }
            />
          </Group>
        </Section>

        <Section title="预览">
          <Group>
            <div className="appearance-preview">
              <span className="appearance-preview__cover">
                <SongCover src={currentSong?.cover} alt={currentSong?.name ?? ''} variant="gradient" />
              </span>
              {currentSong ? (
                <span className="appearance-preview__text">
                  <span className="appearance-preview__title">{currentSong.name}</span>
                  <span className="appearance-preview__artist">
                    {currentSong.artist + (currentSong.album ? ' · ' + currentSong.album : '')}
                  </span>
                </span>
              ) : (
                <span className="appearance-preview__empty">当前没有播放中的歌曲</span>
              )}
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={13} />}
                disabled={!currentSong}
                onClick={handlePlay}
              >
                播放
              </Button>
            </div>
          </Group>
        </Section>
      </div>
    </section>
  );
};

export default AppearanceSection;
