import { DEFAULT_CONFIG, type MusicServiceConfig } from './types/config.js';

/**
 * Config manager for core package.
 * Platforms inject their config via setMusicServiceConfig().
 * All core functions read from this singleton.
 */
class ConfigManager {
  private config: MusicServiceConfig = { ...DEFAULT_CONFIG };

  setConfig(partial: Partial<MusicServiceConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): MusicServiceConfig {
    return { ...this.config };
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
  }
}

export const configManager = new ConfigManager();

/** Convenience exports */
export function setMusicServiceConfig(partial: Partial<MusicServiceConfig>): void {
  configManager.setConfig(partial);
}

export function getMusicServiceConfig(): MusicServiceConfig {
  return configManager.getConfig();
}
