// 动态配置管理器
// 优先级：数据库设置（用户） > 环境变量（开发） > 空

import { db } from './storage/db';

let cachedApiUrl: string | null = null;

export function getApiUrl(): string {
  if (cachedApiUrl !== null) return cachedApiUrl;

  // 1. 优先使用数据库设置（用户在设置页面配置）
  try {
    const setting = db.getSettingSync<string>('apiUrl');
    if (setting) {
      cachedApiUrl = setting;
      return cachedApiUrl;
    }
  } catch {
    // db 可能未初始化，继续检查环境变量
  }

  // 2. 其次使用环境变量（开发者用 .env.local）
  if (process.env.MUSIC_API_URL) {
    cachedApiUrl = process.env.MUSIC_API_URL;
    return cachedApiUrl;
  }

  cachedApiUrl = '';
  return cachedApiUrl;
}

export function reloadConfig() {
  cachedApiUrl = null;
}

export const config = {
  get API_BASE_URL(): string {
    return getApiUrl();
  },
  REQUEST_TIMEOUT: 30000,
  CACHE_EXPIRE_DAYS: 7,
  URL_CACHE_EXPIRE_HOURS: 12,
};