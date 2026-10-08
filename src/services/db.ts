/**
 * Persistence service for Vision-AI.
 *
 * Master configuration is persisted in station-local IndexedDB. Inspection
 * history is cloud-first with a durable local outbox: records that cannot be
 * written to Supabase remain locally queued until a later sync succeeds.
 * No service-role key is ever used in the browser.
 */

import { InspectionRecord, InspectionStats } from '../types/inspection';
import { MasterProduct } from '../types/master';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const HISTORY_TABLE = 'inspection_history';
const MASTER_DB_NAME = 'vision-ai-station';
const MASTER_DB_VERSION = 1;
const MASTER_STORE = 'masters';
const LOCAL_HISTORY_KEY = 'vision-ai-inspection-history';

class DatabaseService {
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
    const database = await this.openMasterDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction(MASTER_STORE, 'readonly').objectStore(MASTER_STORE).getAll();
      request.onsuccess = () => resolve((request.result as MasterProduct[]).sort((a, b) => a.productCode.localeCompare(b.productCode)));
      request.onerror = () => reject(request.error || new Error('Unable to read saved master settings.'));
    });
  }

  public async getMasterById(id: string): Promise<MasterProduct | null> {
    const database = await this.openMasterDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction(MASTER_STORE, 'readonly').objectStore(MASTER_STORE).get(id);
      request.onsuccess = () => resolve((request.result as MasterProduct | undefined) || null);
      request.onerror = () => reject(request.error || new Error('Unable to read master setting.'));
    });
  }

  public async deleteMaster(id: string): Promise<void> {
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
    const database = await this.openMasterDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MASTER_STORE, 'readwrite');
      transaction.objectStore(MASTER_STORE).put(master);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to save master setting.'));
      transaction.onabort = () => reject(transaction.error || new Error('Master save was aborted.'));
    });
  }

  // --- Durable local outbox for cloud inspection history ---
  private getLocalHistory(): InspectionRecord[] {
    try {
      const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as InspectionRecord[] : [];
    } catch {
      return [];
    }
  }

  private writeLocalHistory(records: InspectionRecord[]): void {
    // Keep the newest records first. Unsynced records are never silently
    // discarded in favor of older synced history when the limit is reached.
    const ordered = [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    try {
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(ordered.slice(0, 5000)));
    } catch (error) {
      console.error('[DatabaseService] Local history/outbox write failed:', error);
      throw new Error('Local inspection history could not be saved. Check browser storage capacity before continuing.');
    }
  }

  private saveLocalHistory(record: InspectionRecord): void {
    const existing = this.getLocalHistory().filter((item) => item.id !== record.id);
    this.writeLocalHistory([{ ...record, syncedToCloud: false }, ...existing]);
  }

  private removeLocalHistoryRecord(id: string): void {
    this.writeLocalHistory(this.getLocalHistory().filter((item) => item.id !== id));
  }

  private mergeHistory(cloud: InspectionRecord[], local: InspectionRecord[]): InspectionRecord[] {
    const merged = new Map<string, InspectionRecord>();
    [...local, ...cloud].forEach((record) => merged.set(record.id, record));
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
    try {
      await this.request('', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(this.toCloudRecord(record)),
      });
      this.removeLocalHistoryRecord(record.id);
    } catch (error) {
      this.saveLocalHistory(record);
      console.warn('[DatabaseService] Cloud history queued locally for retry:', error);
    }
  }

  public async getRecentInspections(limit = 500): Promise<InspectionRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    const local = this.getLocalHistory();
    if (!SUPABASE_URL || !SUPABASE_KEY) return local.slice(0, safeLimit);

    // Reading history is also a safe retry point for records saved while offline.
    void this.flushSyncQueue();

    try {
      const rows = await this.request<any[]>(`?select=*&order=timestamp.desc&limit=${safeLimit}`);
      return this.mergeHistory(rows.map((row) => this.fromCloudRecord(row)), local).slice(0, safeLimit);
    } catch (error) {
      console.warn('[DatabaseService] Cloud history read failed; using local history:', error);
      return local.slice(0, safeLimit);
    }
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
    this.writeLocalHistory([]);
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    await this.request('?id=not.is.null', {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }

  public async getPendingSyncCount(): Promise<number> {
    return this.getLocalHistory().filter((record) => !record.syncedToCloud).length;
  }

  public async flushSyncQueue(): Promise<{ synced: number }> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return { synced: 0 };
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      const pending = this.getLocalHistory().filter((record) => !record.syncedToCloud);
      let synced = 0;
      for (const record of pending) {
        try {
          await this.request('', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(this.toCloudRecord(record)),
          });
          this.removeLocalHistoryRecord(record.id);
          synced++;
        } catch (error) {
          // Stop at the first failed write; remaining records stay queued.
          console.warn('[DatabaseService] Outbox sync paused; records remain queued:', error);
          break;
        }
      }
      return { synced };
    })();

    try {
      return await this.syncPromise;
    } finally {
      this.syncPromise = null;
    }
  }
}

export const dbService = new DatabaseService();
