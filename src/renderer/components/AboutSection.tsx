import React, { useEffect, useState } from 'react';
import { ExternalLink, Music } from 'lucide-react';
import { Group, Row, Section } from '@/renderer/ui';

const ipcRenderer = window.electronAPI;

/** 版本之外的事实行：左标签右取值，取值走 Row 的 detail（等宽数字）。 */
const FACTS = [
  { label: '作者', value: 'tomystack' },
  { label: '技术栈', value: 'Electron + React + TypeScript' },
  { label: '数据源', value: '网易云 / QQ / 酷狗 等' },
  { label: '项目类型', value: '桌面音乐播放器' },
];

/**
 * 外链一律 target="_blank"走 window.open：主进程的 setWindowOpenHandler 把 http(s)
 * 交给系统浏览器，应用内不新开窗口（见 src/main/main.ts）。
 */
const LINKS = [
  { label: 'GitHub', href: 'https://github.com/fuzz1og', text: 'github.com/fuzz1og' },
  { label: '项目仓库', href: 'https://github.com/fuzz1og/mplayer', text: 'github.com/fuzz1og/mplayer' },
  {
    label: '开源许可',
    href: 'https://polyformproject.org/licenses/noncommercial/1.0.0/',
    text: 'PolyForm Noncommercial 1.0.0',
  },
];

/**
 * 设置页「关于」区段：版本、作者、技术栈、数据源、仓库与开源许可。
 * 「检查更新」是设置导航里的独立区段（UpdateSection），本区只报身份信息，不复述更新入口。
 */
const AboutSection: React.FC = () => {
  const [version, setVersion] = useState('');

  useEffect(() => {
    ipcRenderer.invoke('update:getVersion').then(setVersion).catch(() => {});
  }, []);

  return (
    <section id="about" className="ui-about">
      <Section title="关于">
        <Group>
          <div className="ui-about__brand">
            <span className="ui-about__mark" aria-hidden="true">
              <Music size={20} />
            </span>
            <span className="ui-about__brand-text">
              <span className="ui-about__name">MPlayer</span>
              <span className="ui-about__tagline">简约优雅的桌面音乐播放器，聚合多个音乐来源。</span>
            </span>
          </div>

          <Row label="版本" detail={`v${version || '...'}`} />
          {FACTS.map((fact) => (
            <Row key={fact.label} label={fact.label} detail={fact.value} />
          ))}
        </Group>

        <Group>
          {LINKS.map((link) => (
            <Row
              key={link.label}
              label={link.label}
              trailing={
                <a className="ui-about__link" href={link.href} target="_blank" rel="noreferrer">
                  {link.text}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              }
            />
          ))}
        </Group>
      </Section>
    </section>
  );
};

export default AboutSection;
