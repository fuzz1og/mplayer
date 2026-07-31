import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../main/storage/db', () => ({
  db: {
    getSettingSync: vi.fn(),
  },
}));

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.MUSIC_API_URL;
  });

  it('returns empty string when no db setting and no env var', async () => {
    const { db } = await import('../../main/storage/db');
    vi.mocked(db.getSettingSync).mockReturnValue(undefined);

    const { getApiUrl } = await import('../../main/config');
    expect(getApiUrl()).toBe('');
  });

  it('returns db setting when available', async () => {
    const { db } = await import('../../main/storage/db');
    vi.mocked(db.getSettingSync).mockReturnValue('https://api.example.com');

    const { getApiUrl } = await import('../../main/config');
    expect(getApiUrl()).toBe('https://api.example.com');
  });

  it('returns env var when no db setting', async () => {
    const { db } = await import('../../main/storage/db');
    vi.mocked(db.getSettingSync).mockReturnValue(undefined);
    process.env.MUSIC_API_URL = 'https://env-api.example.com';

    const { getApiUrl } = await import('../../main/config');
    expect(getApiUrl()).toBe('https://env-api.example.com');
  });

  it('caches result after first call', async () => {
    const { db } = await import('../../main/storage/db');
    vi.mocked(db.getSettingSync).mockReturnValue('https://cached.example.com');

    const { getApiUrl } = await import('../../main/config');
    getApiUrl(); // first call — reads db
    getApiUrl(); // second call — cached

    expect(db.getSettingSync).toHaveBeenCalledTimes(1);
  });

  it('reloadConfig clears cached value', async () => {
    const { db } = await import('../../main/storage/db');
    vi.mocked(db.getSettingSync).mockReturnValueOnce('https://old.example.com');
    vi.mocked(db.getSettingSync).mockReturnValueOnce('https://new.example.com');

    const { getApiUrl, reloadConfig } = await import('../../main/config');
    expect(getApiUrl()).toBe('https://old.example.com');

    reloadConfig();
    expect(getApiUrl()).toBe('https://new.example.com');
    expect(db.getSettingSync).toHaveBeenCalledTimes(2);
  });

  it('falls back from db to env when db throws', async () => {
    const { db } = await import('../../main/storage/db');
    vi.mocked(db.getSettingSync).mockImplementation(() => { throw new Error('db not ready'); });
    process.env.MUSIC_API_URL = 'https://fallback.example.com';

    const { getApiUrl } = await import('../../main/config');
    expect(getApiUrl()).toBe('https://fallback.example.com');
  });
});
