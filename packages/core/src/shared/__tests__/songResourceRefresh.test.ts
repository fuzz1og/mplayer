import { describe, expect, it, vi } from 'vitest';
import type { PlayableResource, Song } from '../../types/index.js';
import { refreshSongResource } from '../songResourceRefresh.js';
import type { SongResourceRefreshDeps } from '../songResourceRefresh.js';

/** 已退役的旧签名端点（core isLegacyDeadUrl 的判定样本） */
const LEGACY_DEAD = 'https://api.example.com/api.php?get=url&id=1';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: '1',
    name: '晴天',
    artist: '周杰伦',
    album: '',
    url: '',
    cover: '',
    lrc: '',
    duration: 240,
    sourceType: 'netease',
    ...overrides,
  };
}

function resource(url: string, nonFull = false, ts = 1000): PlayableResource {
  return { url, nonFull, ts };
}

interface TestDeps extends SongResourceRefreshDeps {
  readCache: ReturnType<typeof vi.fn>;
  writeCache: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<SongResourceRefreshDeps> = {}): TestDeps {
  return {
    readCache: vi.fn(async () => null),
    writeCache: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    ...overrides,
  } as TestDeps;
}

describe('refreshSongResource 编排', () => {
  it('a. 缓存命中且非死链 → 直接返回，不搜索、不写缓存', async () => {
    const cached = resource('https://cdn.example.com/hit.mp3');
    const deps = makeDeps({ readCache: vi.fn(async () => cached) });

    await expect(refreshSongResource(song(), deps)).resolves.toEqual(cached);
    expect(deps.search).not.toHaveBeenCalled();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('a. 缓存命中但为旧签名死链 → 走搜索（旧缓存不得抢先命中）', async () => {
    const deps = makeDeps({
      readCache: vi.fn(async () => resource(LEGACY_DEAD)),
      search: vi.fn(async () => [song({ url: 'https://cdn.example.com/new.mp3' })]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toMatchObject({
      url: 'https://cdn.example.com/new.mp3',
    });
    expect(deps.search).toHaveBeenCalledTimes(1);
  });

  it('a. isDeadUrl 可注入（平台自定义死链判定）', async () => {
    const isDeadUrl = vi.fn((url: string) => url.includes('dead'));
    const deps = makeDeps({
      readCache: vi.fn(async () => resource('https://cdn.example.com/dead.mp3')),
      search: vi.fn(async () => [song({ url: 'https://cdn.example.com/new.mp3' })]),
      isDeadUrl,
    });

    await refreshSongResource(song(), deps);

    expect(isDeadUrl).toHaveBeenCalledWith('https://cdn.example.com/dead.mp3');
    expect(deps.writeCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ url: 'https://cdn.example.com/new.mp3' }),
    );
  });

  it('b. 未命中 → 搜索，仅精确匹配被采用并写缓存（ts 来自注入时钟）', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [song({ url: 'https://cdn.example.com/match.mp3' })]),
      now: () => 4242,
    });

    await expect(refreshSongResource(song(), deps)).resolves.toEqual({
      url: 'https://cdn.example.com/match.mp3',
      nonFull: false,
      ts: 4242,
    });
    expect(deps.writeCache).toHaveBeenCalledWith(song(), {
      url: 'https://cdn.example.com/match.mp3',
      nonFull: false,
      ts: 4242,
    });
  });

  it('b. 同名不同歌手（非精确匹配）不采用——热榜第 6 份漏守卫的通用修复', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [song({ name: '晴天', artist: '其他歌手', url: 'https://cdn.example.com/wrong.mp3' })]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toBeNull();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('c. preview 候选的 nonFull 必须保留（不得被收窄成完整版）', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [
        song({ url: 'https://cdn.example.com/trial.mp3', audioTag: 'preview' as const }),
      ]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toMatchObject({
      url: 'https://cdn.example.com/trial.mp3',
      nonFull: true,
    });
  });

  it('c. candidate.nonFull=true 也保留（T12 权威标记）', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [song({ url: 'https://cdn.example.com/trial.mp3', nonFull: true })]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toMatchObject({ nonFull: true });
  });

  it('c. invalid 候选不写缓存', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [
        song({ url: 'https://cdn.example.com/dead.mp3', audioTag: 'invalid' as const }),
      ]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toBeNull();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('c. 候选 url 非 http 不写缓存', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [song({ url: 'not-a-url' })]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toBeNull();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('c. 候选为旧签名死链不写缓存', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [song({ url: LEGACY_DEAD })]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toBeNull();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('d. 缓存死链 + 无精确匹配 → null，且不写任何东西（null 不覆盖有效旧值）', async () => {
    const deps = makeDeps({
      readCache: vi.fn(async () => resource(LEGACY_DEAD)),
      search: vi.fn(async () => [song({ artist: '翻唱歌手', url: 'https://cdn.example.com/cover.mp3' })]),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toBeNull();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('e. 搜索抛错 → 失败打开返回 null，不抛给调用方', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => {
        throw new Error('网络断了');
      }),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toBeNull();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('e. 搜索抛错打诊断日志（可选 log 钩子）', async () => {
    const log = vi.fn();
    const deps = makeDeps({
      search: vi.fn(async () => {
        throw new Error('网络断了');
      }),
      log,
    });

    await refreshSongResource(song(), deps);

    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('网络断了'));
  });

  it('writeBack 端口收到匹配候选；写回抛错不影响采用结果', async () => {
    const matched = song({ url: 'https://cdn.example.com/full.mp3', cover: 'https://cover' });
    const writeBack = vi.fn(async () => {
      throw new Error('DB 挂了');
    });
    const deps = makeDeps({
      search: vi.fn(async () => [matched]),
      writeBack,
    });

    await expect(refreshSongResource(song(), deps)).resolves.toMatchObject({
      url: 'https://cdn.example.com/full.mp3',
    });
    expect(writeBack).toHaveBeenCalledWith(song(), matched);
  });

  it('写缓存抛错不影响采用结果（缓存是加速器，不是事实源）', async () => {
    const deps = makeDeps({
      search: vi.fn(async () => [song({ url: 'https://cdn.example.com/full.mp3' })]),
      writeCache: vi.fn(async () => {
        throw new Error('磁盘满了');
      }),
    });

    await expect(refreshSongResource(song(), deps)).resolves.toMatchObject({
      url: 'https://cdn.example.com/full.mp3',
    });
  });
});
