import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Database, HardDrive, Network, Server, ShieldAlert } from 'lucide-react';
import { ActiveTab } from '../Navbar';

type StorageTarget = 'local' | 'internal-server';

interface SavedStoragePreference {
  target: StorageTarget;
  endpoint: string;
  stationName: string;
}

const STORAGE_CONFIG_KEY = 'vision_storage_target_config_v1';

const DEFAULT_CONFIG: SavedStoragePreference = {
  target: 'local',
  endpoint: '',
  stationName: 'STAND-CAM-01',
};

function readSavedConfig(): SavedStoragePreference {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SavedStoragePreference>;
    return {
      target: parsed.target === 'internal-server' ? 'internal-server' : 'local',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      stationName: typeof parsed.stationName === 'string' && parsed.stationName.trim()
        ? parsed.stationName.trim()
        : DEFAULT_CONFIG.stationName,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

interface StorageServerSettingsProps {
  onBack: () => void;
}

export const StorageServerSettings: React.FC<StorageServerSettingsProps> = ({ onBack }) => {
  const [config, setConfig] = useState<SavedStoragePreference>(() => readSavedConfig());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSaved(false);
    setError('');
  }, [config.target, config.endpoint, config.stationName]);

  const endpointIsValid = (() => {
    if (!config.endpoint.trim()) return false;
    try {
      const url = new URL(config.endpoint.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  })();

  const saveConfiguration = () => {
    setError('');
    if (config.target === 'internal-server' && !endpointIsValid) {
      setError('Masukkan URL server yang valid, misalnya http://192.168.1.20:8080/api.');
      return;
    }
    try {
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify({
        ...config,
        endpoint: config.endpoint.trim().replace(/\/$/, ''),
        stationName: config.stationName.trim() || DEFAULT_CONFIG.stationName,
      }));
      setSaved(true);
    } catch {
      setError('Konfigurasi tidak dapat disimpan di browser ini.');
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300"><Database className="h-5 w-5" /></div>
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-cyan-300">Storage & Network</div>
            <h1 className="mt-1 text-xl font-bold text-white">Local / Server Configuration</h1>
            <p className="mt-1 text-xs text-slate-400">Atur target yang direncanakan tanpa memindahkan atau menghapus data yang tersimpan.</p>
          </div>
        </div>
        <button onClick={onBack} className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"><ArrowLeft className="h-4 w-4" /> Settings</button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button type="button" onClick={() => setConfig((current) => ({ ...current, target: 'local' }))} className={`rounded-2xl border p-5 text-left transition ${config.target === 'local' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><HardDrive className="h-5 w-5 text-emerald-300" /><span className="font-semibold text-white">Local Station</span></div>
            {config.target === 'local' && <CheckCircle2 className="h-5 w-5 text-emerald-300" />}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Master produk dan riwayat inspeksi disimpan di browser/laptop ini menggunakan IndexedDB. Tidak membutuhkan server pusat.</p>
          <span className="mt-4 inline-flex rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Backend aktif</span>
        </button>

        <button type="button" onClick={() => setConfig((current) => ({ ...current, target: 'internal-server' }))} className={`rounded-2xl border p-5 text-left transition ${config.target === 'internal-server' ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><Server className="h-5 w-5 text-amber-300" /><span className="font-semibold text-white">Local Company Server</span></div>
            {config.target === 'internal-server' && <Network className="h-5 w-5 text-amber-300" />}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Rencana penyimpanan terpusat agar beberapa station dapat berbagi master dan riwayat melalui API internal perusahaan.</p>
          <span className="mt-4 inline-flex rounded-lg border border-amber-500/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">Belum diaktifkan</span>
        </button>
      </div>

      {config.target === 'internal-server' && (
        <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <h2 className="font-semibold text-white">Server connection profile</h2>
              <p className="mt-1 text-xs leading-5 text-amber-100/70">Form ini menyimpan konfigurasi sebagai draft saja. Adapter server masih berupa stub; belum ada request jaringan, pemeriksaan koneksi, atau pengalihan penyimpanan aktif.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs text-slate-300">
              Nama station
              <input value={config.stationName} onChange={(event) => setConfig((current) => ({ ...current, stationName: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" placeholder="STAND-CAM-01" />
            </label>
            <label className="block text-xs text-slate-300">
              Internal API base URL
              <input value={config.endpoint} onChange={(event) => setConfig((current) => ({ ...current, endpoint: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" placeholder="http://192.168.1.20:8080/api" />
              <span className="mt-1 block text-[10px] text-slate-500">Gunakan alamat yang disediakan tim IT; jangan masukkan token atau password di sini.</span>
            </label>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Active persistence: IndexedDB (this station)</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">Memilih server di atas tidak mengalihkan operasi baca/tulis. Peralihan baru boleh diaktifkan setelah API, autentikasi, skema data, migrasi, konflik, dan retry disepakati.</p>
        </div>
        <button onClick={saveConfiguration} className="shrink-0 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300">Save configuration draft</button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error}</div>}
      {saved && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">Draft tersimpan di browser ini. Backend aktif tetap IndexedDB; tidak ada data yang dipindahkan atau dihapus.</div>}
    </section>
  );
};
