import React, { useState } from 'react';
import { Database, Folder, Bell, Shield, Download } from 'lucide-react';
import { Button, Group, Input, Row, Section, Tag } from '@/renderer/ui';

type ThemeMode = 'system' | 'light' | 'dark';

const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
};

/**
 * 原语实验室：所有 UI 原语的单一展示位。
 * 只允许用类名表达样式——本页同时是 design-lint 严格模式的样板。
 */
const UiLabPage: React.FC = () => {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [checked, setChecked] = useState(true);

  const choose = (next: ThemeMode) => {
    setMode(next);
    applyTheme(next);
  };

  return (
    <div className="ui-lab">
      <h1 className="ui-lab__title">UI 原语</h1>
      <p className="ui-lab__note">1.9.0 重构底座：分组卡、行、按钮、标签、输入。暗亮两套都由 token 驱动。</p>

      <div className="ui-lab__toolbar">
        <Button size="sm" variant={mode === 'system' ? 'secondary' : 'ghost'} onClick={() => choose('system')}>
          跟随系统
        </Button>
        <Button size="sm" variant={mode === 'light' ? 'secondary' : 'ghost'} onClick={() => choose('light')}>
          浅色
        </Button>
        <Button size="sm" variant={mode === 'dark' ? 'secondary' : 'ghost'} onClick={() => choose('dark')}>
          深色
        </Button>
      </div>

      <Section title="分组与行" footer="行高 44，发丝线左内缩 47；无图标行缩进 14。">
        <Group>
          <Row icon={<Database size={13} />} label="缓存管理" detail="1.24 GB" chevron onClick={() => undefined} />
          <Row icon={<Folder size={13} />} label="下载目录" detail="D:\\Music" chevron onClick={() => undefined} />
          <Row
            icon={<Bell size={13} />}
            label="桌面通知"
            trailing={
              <Button size="sm" variant={checked ? 'secondary' : 'ghost'} onClick={() => setChecked((v) => !v)}>
                {checked ? '开' : '关'}
              </Button>
            }
          />
          <Row label="无图标行（发丝线缩进 14）" detail="次要信息" onClick={() => undefined} />
          <Row icon={<Shield size={13} />} label="当前选中项" selected onClick={() => undefined} />
          <Row icon={<Download size={13} />} label="禁用行" disabled onClick={() => undefined} />
        </Group>
      </Section>

      <Section title="按钮">
        <div className="ui-lab__demo">
          <Button variant="primary">主操作</Button>
          <Button>次操作</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="plain">文字按钮</Button>
          <Button variant="danger">危险操作</Button>
          <Button variant="primary" size="sm">
            小号
          </Button>
          <Button variant="primary" size="lg">
            大号
          </Button>
          <Button variant="primary" disabled>
            禁用
          </Button>
        </div>
      </Section>

      <Section title="标签">
        <div className="ui-lab__demo">
          <Tag>默认</Tag>
          <Tag tone="accent">直连</Tag>
          <Tag tone="success">可用</Tag>
          <Tag tone="warning">延迟</Tag>
          <Tag tone="danger">失败</Tag>
        </div>
      </Section>

      <Section title="输入">
        <div className="ui-lab__demo">
          <Input placeholder="搜索歌曲、歌手、专辑" aria-label="搜索示例" />
          <Input placeholder="禁用输入" aria-label="禁用示例" disabled />
        </div>
      </Section>

      <Section title="表面 token" footer="窗口 / 内容 / 卡片 / 选中 / 发丝线 / 强调色。">
        <Group>
          <div className="ui-lab__tokens">
            <div className="ui-lab__token">
              <span className="ui-lab__chip ui-lab__chip--window" />
              窗口
            </div>
            <div className="ui-lab__token">
              <span className="ui-lab__chip ui-lab__chip--content" />
              内容
            </div>
            <div className="ui-lab__token">
              <span className="ui-lab__chip ui-lab__chip--card" />
              卡片
            </div>
            <div className="ui-lab__token">
              <span className="ui-lab__chip ui-lab__chip--selected" />
              选中
            </div>
            <div className="ui-lab__token">
              <span className="ui-lab__chip ui-lab__chip--hairline" />
              发丝线
            </div>
            <div className="ui-lab__token">
              <span className="ui-lab__chip ui-lab__chip--accent" />
              强调色
            </div>
          </div>
        </Group>
      </Section>
    </div>
  );
};

export default UiLabPage;
