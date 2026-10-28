/**
 * Persistence service for Vision-AI.
 *
 * Master configuration and inspection history are persisted in station-local
 * IndexedDB first. Optional Supabase synchronization is explicitly opt-in.
 * Legacy localStorage history is migrated without deleting it until the
 * IndexedDB transaction has committed. No service-role key is used in-browser.
 */

import { InspectionRecord, InspectionStats } from '../types/inspection';
import { MasterProduct } from '../types/master';
import { InternalServerStorageAdapter } from './storage/InternalServerStorageAdapter';
import { readStorageConfig } from './storage/storageConfig';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const HISTORY_TABLE = 'inspection_history';
const MASTER_DB_NAME = 'vision-ai-station';
const MASTER_DB_VERSION = 2;
const MASTER_STORE = 'masters';
const HISTORY_STORE = 'inspection-history';
const LOCAL_HISTORY_KEY = 'vision-ai-inspection-history';
const CLOUD_SYNC_ENABLED = import.meta.env.VITE_ENABLE_SUPABASE_SYNC === 'true';

class DatabaseService {
  private readonly internalServer = new InternalServerStorageAdapter();

  private usesInternalServer(): boolean {
    return readStorageConfig().target === 'internal-server';
  }

  private masterDbPromise: Promise<IDBDatabase> | null = null;
  private syncPromise: Promise<{ synced: number }> | null = null;

  private getCloudConfig() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error(
        'Cloud database is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
      );
    }
    return { url: `${SUPABASE_URL}/rest/v1/${HISTORY_TABLE}`, key: SUPABASE_KEY };
  }

  private async request<T = unknown>(path = '', init: RequestInit = {}): Promise<T> {
    const config = this.getCloudConfig();
    const response = await fetch(`${config.url}${path}`, {
      ...init,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud database error ${response.status}: ${body || response.statusText}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // --- Persistent station-local master configuration ---
  private openMasterDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('This browser does not support IndexedDB; master settings cannot be persisted.'));
    }
    if (!this.masterDbPromise) {
      this.masterDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(MASTER_DB_NAME, MASTER_DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(MASTER_STORE)) {
            database.createObjectStore(MASTER_STORE, { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains(HISTORY_STORE)) {
            database.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.masterDbPromise = null;
          reject(request.error || new Error('Unable to open local master database.'));
        };
        request.onblocked = () => {
          this.masterDbPromise = null;
          reject(new Error('Master database upgrade is blocked by another open station tab. Close other tabs and retry.'));
        };
      });
    }
    return this.masterDbPromise;
  }

  public async getAllMasters(): Promise<MasterProduct[]> {
    if (this.usesInternalServer()) return this.internalServer.getMasters();
    const database = await this.openMasterDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction(MASTER_STORE, 'readonly').objectStore(MASTER_STORE).getAll();
      request.onsuccess = () => resolve((request.result as MasterProduct[]).sort((a, b) => a.productCode.localeCompare(b.productCode)));
      request.onerror = () => reject(request.error || new Error('Unable to read saved master settings.'));
    });
  }

  public async getMasterById(id: string): Promise<MasterProduct | null> {
    if (this.usesInternalServer()) return this.internalServer.getMasterById(id);
    const database = await this.openMasterDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction(MASTER_STORE, 'readonly').objectStore(MASTER_STORE).get(id);
      request.onsuccess = () => resolve((request.result as MasterProduct | undefined) || null);
      request.onerror = () => reject(request.error || new Error('Unable to read master setting.'));
    });
  }

  public async deleteMaster(id: string): Promise<void> {
    if (this.usesInternalServer()) return this.internalServer.deleteMaster(id);
    const database = await this.openMasterDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MASTER_STORE, 'readwrite');
      transaction.objectStore(MASTER_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to delete master setting.'));
      transaction.onabort = () => reject(transaction.error || new Error('Master deletion was aborted.'));
    });
  }

  public async saveMaster(master: MasterProduct): Promise<void> {
    if (this.usesInternalServer()) return this.internalServer.saveMaster(master);
    const database = await this.openMasterDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MASTER_STORE, 'readwrite');
      transaction.objectStore(MASTER_STORE).put(master);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to save master setting.'));
      transaction.onabort = () => reject(transaction.error || new Error('Master save was aborted.'));
    });
  }

  // --- IndexedDB-first inspection history with safe legacy migration ---
  private async getLocalHistory(): Promise<InspectionRecord[]> {
    const database = await this.openMasterDb();
    const legacyRecords = this.readLegacyLocalHistory();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(HISTORY_STORE, 'readwrite');
      const store = transaction.objectStore(HISTORY_STORE);
      const getRequest = store.getAll();
      let records: InspectionRecord[] = [];
      getRequest.onsuccess = () => {
        const merged = new Map<string, InspectionRecord>();
        for (const record of (getRequest.result as InspectionRecord[])) merged.set(record.id, record);
        // Preserve the legacy queue's pending state. Existing IndexedDB records
        // win when IDs collide because they are the newer durable source.
        for (const record of legacyRecords) if (!merged.has(record.id)) merged.set(record.id, record);
        records = Array.from(merged.values());
        for (const record of records) store.put(record);
      };
      transaction.oncomplete = () => {
        // Remove legacy data only after IndexedDB confirms the migration commit.
        if (legacyRecords.length) {
          try { localStorage.removeItem(LOCAL_HISTORY_KEY); } catch { /* retain source if storage is unavailable */ }
        }
        resolve(records.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      };
      transaction.onerror = () => reject(transaction.error || new Error('Unable to read local inspection history.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local inspection history migration was aborted.'));
    });
  }

  private readLegacyLocalHistory(): InspectionRecord[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as InspectionRecord[] : [];
    } catch {
      // Do not erase malformed legacy data automatically; preserve it for recovery.
      return [];
    }
  }

  private async writeLocalHistory(records: InspectionRecord[]): Promise<void> {
    const database = await this.openMasterDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(HISTORY_STORE, 'readwrite');
      const store = transaction.objectStore(HISTORY_STORE);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to save local inspection history.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local history write was aborted.'));
    });
  }

  private async saveLocalHistory(record: InspectionRecord): Promise<void> {
    await this.writeLocalHistory([{ ...record, syncedToCloud: false }]);
  }

  private async removeLocalHistoryRecord(id: string): Promise<void> {
    const records = await this.getLocalHistory();
    const record = records.find((item) => item.id === id);
    if (record) await this.writeLocalHistory([{ ...record, syncedToCloud: true }]);
  }

  private mergeHistory(cloud: InspectionRecord[], local: InspectionRecord[]): InspectionRecord[] {
    const merged = new Map<string, InspectionRecord>();
    [...cloud, ...local].forEach((record) => merged.set(record.id, record));
    return Array.from(merged.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  private toCloudRecord(record: InspectionRecord) {
    return {
      id: record.id,
      timestamp: record.timestamp,
      product_id: record.productId,
      product_code: record.productCode,
      product_name: record.productName,
      master_id: record.masterId,
      master_revision_id: record.masterRevisionId,
      master_revision_code: record.masterRevisionCode,
      judgement: record.judgement,
      expected_count: record.expectedCount,
      detected_count: record.detectedCount,
      defects: record.defects,
      primary_reason: record.primaryReason,
      metrics: record.metrics,
      alignment: record.alignment,
      roi_results: record.roiResults,
      extra_objects: record.extraObjects,
      thumbnail_base64: record.thumbnailBase64 || null,
      device_id: record.deviceId,
      operator_id: record.operatorId || null,
      sequence_number: record.sequenceNumber ?? null,
      plc_interlock_state: record.plcInterlockState || null,
      plc_comm_latency_ms: record.plcCommLatencyMs ?? null,
      plc_timeline: record.plcTimeline || null,
    };
  }

  private fromCloudRecord(row: any): InspectionRecord {
    return {
      id: row.id,
      timestamp: row.timestamp,
      productId: row.product_id,
      productCode: row.product_code,
      productName: row.product_name,
      masterId: row.master_id,
      masterRevisionId: row.master_revision_id,
      masterRevisionCode: row.master_revision_code,
      judgement: row.judgement,
      expectedCount: row.expected_count,
      detectedCount: row.detected_count,
      defects: row.defects || [],
      primaryReason: row.primary_reason || '',
      metrics: row.metrics || {},
      alignment: row.alignment || {},
      roiResults: row.roi_results || [],
      extraObjects: row.extra_objects || [],
      thumbnailBase64: row.thumbnail_base64 || undefined,
      deviceId: row.device_id,
      operatorId: row.operator_id || undefined,
      syncedToCloud: true,
      sequenceNumber: row.sequence_number ?? undefined,
      plcInterlockState: row.plc_interlock_state || undefined,
      plcCommLatencyMs: row.plc_comm_latency_ms ?? undefined,
      plcTimeline: row.plc_timeline || undefined,
    };
  }

  public async saveInspectionRecord(record: InspectionRecord): Promise<void> {
    if (this.usesInternalServer()) return this.internalServer.saveInspection(record);
    // Local persistence is authoritative for the station: never require a
    // cloud round-trip before the inspection result is safely recorded.
    const localRecord = { ...record, syncedToCloud: false };
    await this.saveLocalHistory(localRecord);

    if (!CLOUD_SYNC_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      await this.request('', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(this.toCloudRecord(localRecord)),
      });
      await this.removeLocalHistoryRecord(record.id);
    } catch (error) {
      console.warn('[DatabaseService] Local inspection saved; cloud sync remains pending:', error);
    }
  }

  public async getRecentInspections(limit = 500): Promise<InspectionRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    if (this.usesInternalServer()) return this.internalServer.getInspectionHistory(safeLimit);
    const local = await this.getLocalHistory();
    if (!CLOUD_SYNC_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) {
      return local.slice(0, safeLimit);
    }

    void this.flushSyncQueue();
    try {
      const rows = await this.request<any[]>(`?select=*&order=timestamp.desc&limit=${safeLimit}`);
      const cloud = rows.map((row) => this.fromCloudRecord(row));
      const merged = this.mergeHistory(cloud, local);
      // Cache cloud history locally so the station remains usable offline.
      await this.writeLocalHistory(merged);
      return merged.slice(0, safeLimit);
    } catch (error) {
      console.warn('[DatabaseService] Cloud history read failed; using IndexedDB history:', error);
      return local.slice(0, safeLimit);
    }
  }

  /** Export station-local data explicitly for a controlled server migration. */
  public async exportLocalSnapshot(): Promise<{ masters: MasterProduct[]; inspections: InspectionRecord[] }> {
    const database = await this.openMasterDb();
    const masters = await new Promise<MasterProduct[]>((resolve, reject) => {
      const request = database.transaction(MASTER_STORE, 'readonly').objectStore(MASTER_STORE).getAll();
      request.onsuccess = () => resolve(request.result as MasterProduct[]);
      request.onerror = () => reject(request.error || new Error('Unable to export local master data.'));
    });
    const inspections = await this.getLocalHistory();
    return { masters, inspections };
  }

  public async getFilteredInspections(filters: {
    productId?: string;
    judgement?: string;
    search?: string;
    limit?: number;
  }): Promise<InspectionRecord[]> {
    const records = await this.getRecentInspections(filters.limit || 1000);
    return records.filter((item) => {
      if (filters.productId && item.productId !== filters.productId) return false;
      if (filters.judgement && filters.judgement !== 'ALL' && item.judgement !== filters.judgement) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        return (
          item.productName.toLowerCase().includes(q) ||
          item.productCode.toLowerCase().includes(q) ||
          item.primaryReason.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  public async getStats(): Promise<InspectionStats> {
    const records = await this.getRecentInspections(5000);
    let totalOk = 0;
    let totalNg = 0;
    let totalInvalid = 0;
    let totalErrors = 0;
    let totalCycleSum = 0;

    for (const record of records) {
      if (record.judgement === 'OK') totalOk++;
      else if (record.judgement === 'NG') totalNg++;
      else if (record.judgement === 'INVALID') totalInvalid++;
      else totalErrors++;
      totalCycleSum += record.metrics?.totalCycleMs || 0;
    }

    const totalInspected = records.length;
    return {
      totalInspected,
      totalOk,
      totalNg,
      totalInvalid,
      totalErrors,
      yieldRate: totalInspected > 0 ? (totalOk / totalInspected) * 100 : 100,
      lastCycleTimeMs: records[0]?.metrics?.totalCycleMs || 0,
      averageCycleTimeMs: totalInspected > 0 ? Math.round(totalCycleSum / totalInspected) : 0,
    };
  }

  public async clearInspectionHistory(): Promise<void> {
    if (this.usesInternalServer()) return this.internalServer.clearInspectionHistory();
    const database = await this.openMasterDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(HISTORY_STORE, 'readwrite');
      transaction.objectStore(HISTORY_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to clear local inspection history.'));
      transaction.onabort = () => reject(transaction.error || new Error('Clearing local inspection history was aborted.'));
    });
    try { localStorage.removeItem(LOCAL_HISTORY_KEY); } catch { /* ignore unavailable storage */ }
    if (!CLOUD_SYNC_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) return;
    await this.request('?id=not.is.null', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }

  public async getPendingSyncCount(): Promise<number> {
    if (this.usesInternalServer()) return 0;
    if (!CLOUD_SYNC_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) return 0;
    return (await this.getLocalHistory()).filter((record) => !record.syncedToCloud).length;
  }

  public async flushSyncQueue(): Promise<{ synced: number }> {
    if (this.usesInternalServer()) return { synced: 0 };
    if (!CLOUD_SYNC_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) return { synced: 0 };
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      const pending = (await this.getLocalHistory()).filter((record) => !record.syncedToCloud);
      let synced = 0;
      for (const record of pending) {
        try {
          await this.request('', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(this.toCloudRecord(record)),
          });
          await this.removeLocalHistoryRecord(record.id);
          synced++;
        } catch (error) {
          console.warn('[DatabaseService] Sync paused; records remain safely stored in IndexedDB:', error);
          break;
        }
      }
      return { synced };
    })();

    try { return await this.syncPromise; }
    finally { this.syncPromise = null; }
  }
}

export const dbService = new DatabaseService();
