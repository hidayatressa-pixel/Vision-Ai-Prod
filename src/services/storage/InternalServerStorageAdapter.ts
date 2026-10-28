import type { InspectionRecord } from '../../types/inspection';
import type { MasterProduct } from '../../types/master';
import type { StorageAdapter } from './StorageAdapter';

/**
 * Deliberate placeholder for the company's future internal API.
 * No network requests are made until endpoint, authentication, payload
 * contract, and retry/conflict rules have been approved and implemented.
 */
export class InternalServerStorageAdapter implements StorageAdapter {
  readonly kind = 'internal-server' as const;

  constructor(private readonly endpoint?: string) {}

  private notConfigured(): never {
    throw new Error(
      this.endpoint
        ? 'Internal server adapter is not implemented yet; no request was sent.'
        : 'Internal server adapter is disabled. Configure the approved endpoint and protocol first.'
    );
  }

  async getMasters(): Promise<MasterProduct[]> { return this.notConfigured(); }
  async saveMaster(_master: MasterProduct): Promise<void> { return this.notConfigured(); }
  async getInspectionHistory(_limit?: number): Promise<InspectionRecord[]> { return this.notConfigured(); }
  async saveInspection(_record: InspectionRecord): Promise<void> { return this.notConfigured(); }
}
