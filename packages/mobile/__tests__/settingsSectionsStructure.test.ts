import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');

const SECTIONS = [
  'AppearanceSection',
  'PlaybackSection',
  'DirectStatusSection',
  'Tier3Section',
  'DiagnosticsSection',
  'CacheSection',
  'AboutSection',
  'UpdateSection',
] as const;

/**
 * #425 结构守卫：设置页拆段后「页面只做布局、区段自治」这个形状不能回潮。
 *
 * 拆段的意义是 locality：页面不再持有任何区段状态，各区段自己订阅自己的 store。
 * 一旦有人把状态挪回页面（或让区段互相传 props），重渲染面又会扩散回整棵设置树，
 * 用例就红。
 */
describe('设置页拆段结构（#425）', () => {
  it('页面只剩布局：不持状态、不订阅 store、不直连服务层', () => {
    const page = read('app/settings.tsx');
    expect(page).not.toMatch(/useState/);
    expect(page).not.toMatch(/useEffect/);
    expect(page).not.toMatch(/useSettingsStore/);
    // 服务层副作用（tier3 / 诊断导出 / 缓存 / 更新检查）都归属各自的区段
    expect(page).not.toMatch(/services\//);
    expect(page).not.toMatch(/@mplayer\/core/);
    // 页面应是薄布局（拆段前 926 行）
    expect(page.split('\n').length).toBeLessThan(120);
  });

  it('页面按拆段前的顺序渲染各区段', () => {
    const page = read('app/settings.tsx');
    let last = -1;
    for (const name of ['AppearanceSection', 'PlaybackSection', 'DirectStatusSection', 'Tier3Section', 'DiagnosticsSection', 'CacheSection', 'AboutSection']) {
      const at = page.indexOf('<' + name + ' />');
      expect(at, name).toBeGreaterThan(last);
      last = at;
    }
    // 更新区段挂在「关于」卡片内（与拆段前同一张 group，视觉零变化）
    expect(read('components/settings/AboutSection.tsx')).toContain('<UpdateSection />');
  });

  it('区段自订阅自己的 store 字段（选择器到字段，不整 store 订阅）', () => {
    const owned: Record<string, string[]> = {
      AppearanceSection: ['s.themeMode', 's.setThemeMode'],
      PlaybackSection: ['s.autoSkipOnError', 's.setAutoSkipOnError'],
      Tier3Section: ['s.tier3Enabled', 's.tier3Subscriptions'],
      UpdateSection: ['s.updateChannel', 's.setUpdateChannel'],
    };
    for (const [name, fields] of Object.entries(owned)) {
      const src = read('components/settings/' + name + '.tsx');
      for (const field of fields) {
        expect(src, name + ' → ' + field).toContain('useSettingsStore((s) => ' + field + ')');
      }
      // 禁止整 store 订阅（无选择器调用）
      expect(src, name).not.toMatch(/useSettingsStore\(\)/);
    }
  });

  it('区段各自挂载：每个文件都导出默认组件', () => {
    for (const name of SECTIONS) {
      const src = read('components/settings/' + name + '.tsx');
      expect(src, name).toMatch(new RegExp('export default function ' + name + '\\('));
    }
  });

  it('样式与度量只有 settingsStyles.ts 一个定义点（#416 同源约定）', () => {
    for (const name of SECTIONS) {
      const src = read('components/settings/' + name + '.tsx');
      expect(src, name).not.toMatch(/StyleSheet\.create/);
      expect(src, name).toContain("from './settingsStyles'");
    }
    expect(read('components/settings/settingsStyles.ts')).toMatch(/export const makeSettingsStyles/);
  });
});
