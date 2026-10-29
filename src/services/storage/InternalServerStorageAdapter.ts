import type { InspectionRecord } from '../../types/inspection';
import type { MasterProduct } from '../../types/master';
import type { StorageAdapter } from './StorageAdapter';
import { readStorageConfig } from './storageConfig';

export interface StorageSnapshot {
  masters: MasterProduct[];
  inspections: InspectionRecord[];
}

export class InternalServerStorageAdapter implements StorageAdapter {
  readonly kind = 'internal-server' as const;

  private config() {
    const config = readStorageConfig();
    if (!config.endpoint) throw new Error('Internal server API URL is not configured.');
    if (!config.accessToken.trim()) throw new Error('Internal server access token is not configured.');
    return { ...config, endpoint: config.endpoint.replace(/\/$/, '') };
  }

  private async request<T>(path: string, init: RequestInit = {}, requireRead = false, requireWrite = false): Promise<T> {
    const config = this.config();
    if (requireRead && !config.readEnabled) throw new Error('Read access is disabled in Storage & Server settings.');
    if (requireWrite && !config.writeEnabled) throw new Error('Write access is disabled in Storage & Server settings.');
    const response = await fetch(`${config.endpoint}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'X-Vision-Station': config.stationName,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Internal server API ${response.status}: ${message || response.statusText}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{ ok: boolean; service: string; version: string }> {
    return this.request('/health', { method: 'GET' });
  }

  async getMasters(): Promise<MasterProduct[]> {
    return this.request('/masters', { method: 'GET' }, true);
  }

  async getMasterById(id: string): Promise<MasterProduct | null> {
    const masters = await this.getMasters();
    return masters.find((master) => master.id === id) || null;
  }

  async saveMaster(master: MasterProduct): Promise<void> {
    await this.request('/masters', { method: 'POST', body: JSON.stringify(master) }, false, true);
  }

  async deleteMaster(id: string): Promise<void> {
    await this.request(`/masters/${encodeURIComponent(id)}`, { method: 'DELETE' }, false, true);
  }

  async getInspectionHistory(limit = 500): Promise<InspectionRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    return this.request(`/inspections?limit=${safeLimit}`, { method: 'GET' }, true);
  }

  async saveInspection(record: InspectionRecord): Promise<void> {
    await this.request('/inspections', { method: 'POST', body: JSON.stringify(record) }, false, true);
  }

  async clearInspectionHistory(): Promise<void> {
    await this.request('/inspections', { method: 'DELETE' }, false, true);
  }

  async importSnapshot(snapshot: StorageSnapshot): Promise<{ mastersImported: number; inspectionsImported: number }> {
    return this.request('/migrate', { method: 'POST', body: JSON.stringify(snapshot) }, false, true);
  }
}
