import React, { useState } from 'react';
import { Layers, Plus, ScanSearch, X, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { MasterProduct, MasterRevision, InspectionROI } from '../../types/master';
import { SEED_PRODUCT_A } from '../../services/sampleData';

type FocusZone = 'A' | 'B' | 'C';

interface NewProductDetails {
  productName: string;
  productCode: string;
  description: string;
  focusZone: FocusZone;
  objectClass: string;
  objectCount: number;
}

interface MasterSetupEntryModalProps {
  isOpen: boolean;
  exampleMaster: MasterProduct;
  onClose: () => void;
  onUseExample: () => void;
  onCreateProduct: (master: MasterProduct) => Promise<void> | void;
}

const ZONES: Record<FocusZone, { label: string; box: MasterRevision['detectionZone'] }> = {
  A: { label: 'Zone A · Left', box: { x: 0.05, y: 0.1, width: 0.3, height: 0.8 } },
  B: { label: 'Zone B · Center', box: { x: 0.35, y: 0.1, width: 0.3, height: 0.8 } },
  C: { label: 'Zone C · Right', box: { x: 0.65, y: 0.1, width: 0.3, height: 0.8 } },
};

function makeRois(count: number, zone: FocusZone, objectClass: string): InspectionROI[] {
  const box = ZONES[zone].box;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: `roi-${Date.now()}-${index + 1}`,
      name: `${objectClass} #${index + 1}`,
      objectType: objectClass.toLowerCase() === 'screw' || objectClass.toLowerCase() === 'bolt' || objectClass.toLowerCase() === 'fastener' ? 'screw' : 'component',
      objectClass: objectClass.trim(),
      focusZone: zone,
      x: box.x + box.width * ((col + 1) / (columns + 1)),
      y: box.y + box.height * ((row + 1) / (rows + 1)),
      radius: 0.04,
      toleranceRadius: 0.035,
      minConfidence: 0.65,
      isRequired: true,
    };
  });
}

export const MasterSetupEntryModal: React.FC<MasterSetupEntryModalProps> = ({
  isOpen, exampleMaster, onClose, onUseExample, onCreateProduct,
}) => {
  const [step, setStep] = useState<'choice' | 'form'>('choice');
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [description, setDescription] = useState('');
  const [focusZone, setFocusZone] = useState<FocusZone>('A');
  const [objectClass, setObjectClass] = useState('screw');
  const [objectCount, setObjectCount] = useState(8);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const reset = () => {
    setStep('choice'); setProductName(''); setProductCode(''); setDescription('');
    setFocusZone('A'); setObjectClass('screw'); setObjectCount(8); setError('');
  };

  const createProduct = async () => {
    const name = productName.trim();
    const code = productCode.trim().toUpperCase();
    const objectLabel = objectClass.trim();
    if (!name || !code || !objectLabel) { setError('Product name, part number, and component class are required.'); return; }
    if (!Number.isInteger(objectCount) || objectCount < 1 || objectCount > 100) { setError('Component quantity must be between 1 and 100.'); return; }

    const now = new Date().toISOString();
    const productId = `prd-${Date.now()}`;
    const revisionId = `rev-01-${Date.now()}`;
    const base = SEED_PRODUCT_A.revisions[0];
    const revision: MasterRevision = {
      ...base,
      id: revisionId,
      masterId: productId,
      revisionCode: 'REV-01',
      revisionNote: `Initial master · Zone ${focusZone} · ${objectCount} ${objectLabel}`,
      expectedObjectCount: objectCount,
      anchors: base.anchors.map((anchor) => ({ ...anchor })),
      inspectionROIs: makeRois(objectCount, focusZone, objectLabel),
      referenceImages: [],
      masterImageUrl: '',
      masterWidth: 0,
      masterHeight: 0,
      detectionZone: { ...ZONES[focusZone].box },
      focusZone,
      createdAt: now,
      updatedAt: now,
      createdBy: 'System Engineer',
    };
    const product: MasterProduct = {
      id: productId,
      productCode: code,
      productName: name,
      description: description.trim() || `Inspection master for ${objectCount} ${objectLabel} component(s) in Zone ${focusZone}.`,
      activeRevisionId: revisionId,
      revisions: [revision],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: 'System Engineer',
    };

    setSaving(true); setError('');
    try { await onCreateProduct(product); reset(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to create product master.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-cyan-400">Perception Viewport · Master Setup</div>
            <h2 className="mt-1 text-lg font-bold text-white">{step === 'choice' ? 'Choose master workflow' : 'Register new product'}</h2>
            <p className="mt-1 text-xs text-slate-400">{step === 'choice' ? 'Choose a known example or configure a clean product master.' : 'ROI count and class are generated from this product definition.'}</p>
          </div>
          <button onClick={() => { reset(); onClose(); }} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {step === 'choice' ? (
          <div className="grid gap-4 p-6 md:grid-cols-2">
            <button onClick={() => { onUseExample(); reset(); }} className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-5 text-left transition hover:border-cyan-400 hover:bg-cyan-500/15">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300"><Layers className="h-6 w-6" /></div>
              <div className="text-base font-bold text-white">Example Master</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">Open the existing {exampleMaster.productName} example with 8 screw ROIs and its reference set. No reset or overwrite.</p>
              <div className="mt-4 inline-flex items-center gap-2 text-xs font-mono text-cyan-300"><CheckCircle2 className="h-4 w-4" /> 8 SCREW ROI · EXISTING MASTER</div>
            </button>
            <button onClick={() => setStep('form')} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-left transition hover:border-emerald-400">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><Plus className="h-6 w-6" /></div>
              <div className="text-base font-bold text-white">New Product</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">Create a clean master with no inherited ROI or reference images. Define part number, detection zone, class and quantity.</p>
              <div className="mt-4 inline-flex items-center gap-2 text-xs font-mono text-emerald-300"><ScanSearch className="h-4 w-4" /> DYNAMIC ROI CONFIGURATION</div>
            </button>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <button onClick={() => setStep('choice')} className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to master choice</button>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-xs text-slate-300"><span>Product name *</span><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Bracket Assy LH" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" /></label>
              <label className="space-y-1.5 text-xs text-slate-300"><span>Part number *</span><input value={productCode} onChange={(e) => setProductCode(e.target.value)} placeholder="e.g. ABC-12345" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm uppercase text-white outline-none focus:border-cyan-400" /></label>
              <label className="space-y-1.5 text-xs text-slate-300 md:col-span-2"><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional product notes" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" /></label>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold text-slate-200">Focus zone</div>
              <div className="grid grid-cols-3 gap-2">
                {(['A', 'B', 'C'] as FocusZone[]).map((zone) => (
                  <button key={zone} onClick={() => setFocusZone(zone)} className={`rounded-xl border p-3 text-left ${focusZone === zone ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-700 bg-slate-950'}`}>
                    <div className="text-sm font-bold text-white">Zone {zone}</div><div className="mt-1 text-[10px] text-slate-400">{ZONES[zone].label.split('·')[1]}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-xs text-slate-300"><span>Detection class *</span><input value={objectClass} onChange={(e) => setObjectClass(e.target.value)} placeholder="screw, clip, connector, custom class..." className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" /><span className="block text-[10px] text-slate-500">Must match a class the configured YOLO model was trained to detect.</span></label>
              <label className="space-y-1.5 text-xs text-slate-300"><span>Expected component quantity *</span><input type="number" min={1} max={100} value={objectCount} onChange={(e) => setObjectCount(Number(e.target.value))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" /><span className="block text-[10px] text-slate-500">This creates {objectCount} editable ROI points.</span></label>
            </div>

            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200">New product starts with clean ROI/reference data. Generated ROI positions are provisional: upload the approved master image, then drag each point to the real component location and verify alignment before enabling production inspection.</div>
            {error && <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">{error}</div>}
            <div className="flex justify-end gap-3"><button onClick={() => { reset(); onClose(); }} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-300">Cancel</button><button disabled={saving} onClick={createProduct} className="rounded-xl bg-cyan-500 px-5 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-50">{saving ? 'Creating…' : 'Create product & configure ROI'}</button></div>
          </div>
        )}
      </div>
    </div>
  );
};
