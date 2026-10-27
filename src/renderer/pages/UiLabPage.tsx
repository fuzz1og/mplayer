import React, { useState } from 'react';
import { Database, Folder, Bell, Shield, Download } from 'lucide-react';
import { Alert, Button, Checkbox, Group, Input, Progress, Row, Section, Segmented, Stepper, Switch, Tag } from '@/renderer/ui';

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
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [notify, setNotify] = useState(false);
  const [remembersPosition, setRemembersPosition] = useState(true);
  const [segment, setSegment] = useState('全部');
  const [viewMode, setViewMode] = useState('列表');
  const [volume, setVolume] = useState(60);

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

      <Section
        title="表单控件"
        footer="开关 38×23；分段选中用表面明度差表达；Tab 聚焦、方向键切换、空格/Enter 触发，焦点环沿用强调色。"
      >
        <Group>
          <Row
            label="自动更新"
            detail="启动时检查"
            trailing={<Switch checked={autoUpdate} onChange={setAutoUpdate} ariaLabel="自动更新" />}
          />
          <Row label="桌面通知" trailing={<Switch checked={notify} onChange={setNotify} ariaLabel="桌面通知" />} />
          <Row
            label="禁用开关"
            trailing={<Switch checked={false} onChange={() => undefined} ariaLabel="禁用开关" disabled />}
          />
        </Group>

        <Group>
          <div className="ui-lab__demo">
            <Checkbox checked={remembersPosition} onChange={setRemembersPosition} label="记住播放位置" />
            <Checkbox checked={false} onChange={() => undefined} label="禁用选项" disabled />
          </div>
          <div className="ui-lab__demo">
            <Segmented
              options={['全部', '歌曲', '专辑', '歌手']}
              value={segment}
              onChange={setSegment}
              ariaLabel="资料库筛选"
            />
            <Segmented
              size="sm"
              options={['列表', '网格']}
              value={viewMode}
              onChange={setViewMode}
              ariaLabel="视图模式"
            />
          </div>
        </Group>

        <Group>
          <div className="ui-lab__form-stack">
            <Progress value={64} label="缓存占用" ariaLabel="缓存占用" />
            <Progress value={38} tone="success" label="下载进度" ariaLabel="下载进度" />
          </div>
        </Group>

        <Group>
          <div className="ui-lab__form-stack">
            <Alert
              tone="info"
              title="直连可用"
              action={
                <Button size="sm" variant="plain">
                  查看来源
                </Button>
              }
            >
              网易云与 QQ 音乐当前都能直连，无需走第三方解析源。
            </Alert>
            <Alert tone="warning" title="延迟偏高">
              最近一次请求耗时 1.8s，建议检查网络或切换解析源。
            </Alert>
            <Alert
              tone="danger"
              title="解析失败"
              action={
                <Button size="sm" variant="plain">
                  重试
                </Button>
              }
            >
              当前歌曲没有可播放地址，已自动跳转到下一首。
            </Alert>
            <Alert tone="success" title="缓存清理完成">
              释放 1.24 GB，播放记录与收藏不受影响。
            </Alert>
          </div>
        </Group>

        <Group>
          <div className="ui-lab__demo">
            <Stepper label="音量" value={volume} min={0} max={100} step={5} onChange={setVolume} />
          </div>
        </Group>
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
