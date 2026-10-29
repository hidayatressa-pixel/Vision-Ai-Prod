/**
 * Storage contracts for local-first persistence and future on-premise sync.
 * The internal server adapter is intentionally not activated by default.
 */
import type { InspectionRecord } from '../../types/inspection';
import type { MasterProduct } from '../../types/master';

export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'internal-server';
  getMasters(): Promise<MasterProduct[]>;
  saveMaster(master: MasterProduct): Promise<void>;
  getInspectionHistory(limit?: number): Promise<InspectionRecord[]>;
  saveInspection(record: InspectionRecord): Promise<void>;
}
