export type StorageTarget = 'local' | 'internal-server';

export interface StorageRuntimeConfig {
  target: StorageTarget;
  endpoint: string;
  stationName: string;
  accessToken: string;
  readEnabled: boolean;
  writeEnabled: boolean;
}

export const STORAGE_CONFIG_KEY = 'vision_storage_target_config_v1';

export const DEFAULT_STORAGE_CONFIG: StorageRuntimeConfig = {
  target: 'local',
  endpoint: '',
  stationName: 'STAND-CAM-01',
  accessToken: '',
  readEnabled: true,
  writeEnabled: true,
};

export function readStorageConfig(): StorageRuntimeConfig {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_STORAGE_CONFIG };
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_STORAGE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<StorageRuntimeConfig>;
    return {
      target: parsed.target === 'internal-server' ? 'internal-server' : 'local',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint.trim().replace(/\\/$/, '') : '',
      stationName: typeof parsed.stationName === 'string' && parsed.stationName.trim()
        ? parsed.stationName.trim()
        : DEFAULT_STORAGE_CONFIG.stationName,
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : '',
      readEnabled: parsed.readEnabled !== false,
      writeEnabled: parsed.writeEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_STORAGE_CONFIG };
  }
}

export function writeStorageConfig(config: StorageRuntimeConfig): void {
  if (typeof localStorage === 'undefined') throw new Error('Browser storage configuration is unavailable.');
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
}
