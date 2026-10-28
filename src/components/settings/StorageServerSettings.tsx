import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Database, HardDrive, Network, Server, ShieldAlert, RefreshCw, UploadCloud } from 'lucide-react';
import { ActiveTab } from '../Navbar';
import { dbService } from '../../services/db';
import { readStorageConfig, writeStorageConfig, type StorageRuntimeConfig, type StorageTarget } from '../../services/storage/storageConfig';

type DraftProfile = Pick<StorageRuntimeConfig, 'endpoint' | 'stationName' | 'accessToken' | 'readEnabled' | 'writeEnabled'>;

const defaultDraft: DraftProfile = {
  endpoint: '',
  stationName: 'STAND-CAM-01',
  accessToken: '',
  readEnabled: true,
  writeEnabled: true,
};

interface StorageServerSettingsProps {
  onBack: () => void;
}

export const StorageServerSettings: React.FC<StorageServerSettingsProps> = ({ onBack }) => {
  const [activeTarget, setActiveTarget] = useState<StorageTarget>(() => readStorageConfig().target);
  const [selectedTarget, setSelectedTarget] = useState<StorageTarget>(() => readStorageConfig().target);
  const [draft, setDraft] = useState<DraftProfile>(() => {
    const saved = readStorageConfig();
    return { endpoint: saved.endpoint, stationName: saved.stationName, accessToken: saved.accessToken, readEnabled: saved.readEnabled, writeEnabled: saved.writeEnabled };
  });
  const [connection, setConnection] = useState<'untested' | 'testing' | 'connected' | 'failed'>('untested');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setConnection('untested');
    setError('');
    setMessage('');
  }, [draft.endpoint, draft.accessToken, draft.stationName]);

  const normalizedEndpoint = draft.endpoint.trim().replace(/\/$/, '');
  const endpointIsValid = (() => {
    if (!normalizedEndpoint) return false;
    try {
      const url = new URL(normalizedEndpoint);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host);
    } catch { return false; }
  })();

  const persistProfile = (target: StorageTarget = activeTarget) => {
    const next: StorageRuntimeConfig = {
      configVersion: 2,
      target,
      endpoint: normalizedEndpoint,
      stationName: draft.stationName.trim() || 'STAND-CAM-01',
      accessToken: draft.accessToken.trim(),
      readEnabled: draft.readEnabled,
      writeEnabled: draft.writeEnabled,
    };
    writeStorageConfig(next);
    setActiveTarget(target);
    return next;
  };

  const testConnection = async () => {
    setError('');
    setMessage('');
    if (!endpointIsValid || !draft.accessToken.trim()) {
      setError('Isi URL API dan access token terlebih dahulu.');
      return;
    }
    setConnection('testing');
    try {
      const response = await fetch(`${normalizedEndpoint}/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${draft.accessToken.trim()}`, 'X-Vision-Station': draft.stationName.trim() || 'STAND-CAM-01' },
      });
      if (!response.ok) throw new Error(`Server merespons HTTP ${response.status}. Periksa URL, token, dan konfigurasi CORS.`);
      const result = await response.json() as { ok?: boolean; service?: string; version?: string };
      if (!result.ok) throw new Error('Respons server tidak dikenali sebagai Vision local storage API.');
      persistProfile(activeTarget);
      setConnection('connected');
      setMessage(`Koneksi berhasil: ${result.service || 'Vision API'} v${result.version || 'unknown'}. Backend aktif belum berubah.`);
    } catch (caught) {
      setConnection('failed');
      setError(caught instanceof Error ? caught.message : 'Koneksi server gagal.');
    }
  };

  const useLocalStation = () => {
    try {
      persistProfile('local');
      setSelectedTarget('local');
      setConnection('untested');
      setMessage('Local Station aktif. Data lokal tetap berada di IndexedDB browser ini.');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pengaturan tidak dapat disimpan.');
    }
  };

  const activateServerWithoutMigration = () => {
    if (connection !== 'connected') {
      setError('Uji koneksi server terlebih dahulu sebelum mengaktifkan backend.');
      return;
    }
    if (!window.confirm('Aktifkan server tanpa migrasi? Data lokal tetap tersimpan di browser ini, tetapi tidak otomatis tersedia di server.')) return;
    try {
      persistProfile('internal-server');
      setSelectedTarget('internal-server');
      setMessage('Local Company Server aktif. Operasi baca/tulis berikutnya akan menggunakan API server. Data lokal tidak dihapus.');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Server tidak dapat diaktifkan.');
    }
  };

  const migrateAndActivate = async () => {
    if (connection !== 'connected') {
      setError('Uji koneksi server terlebih dahulu sebelum migrasi.');
      return;
    }
    if (!draft.readEnabled || !draft.writeEnabled) {
      setError('Aktifkan izin baca dan tulis sementara untuk migrasi data.');
      return;
    }
    if (!window.confirm('Salin seluruh master dan riwayat lokal ke server? Data lokal tidak dihapus. Jika ada ID yang bertabrakan dengan data berbeda di server, migrasi akan ditolak agar data tidak tertimpa.')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Export directly from IndexedDB even if a previous session used the server backend.
      const snapshot = await dbService.exportLocalSnapshot();
      const response = await fetch(`${normalizedEndpoint}/migrate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${draft.accessToken.trim()}`,
          'Content-Type': 'application/json',
          'X-Vision-Station': draft.stationName.trim() || 'STAND-CAM-01',
        },
        body: JSON.stringify(snapshot),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Migrasi ditolak (HTTP ${response.status}): ${detail || response.statusText}`);
      }
      const result = await response.json() as { mastersImported?: number; inspectionsImported?: number };
      persistProfile('internal-server');
      setSelectedTarget('internal-server');
      setMessage(`Migrasi berhasil dan server aktif. Master: ${result.mastersImported ?? snapshot.masters.length}; riwayat: ${result.inspectionsImported ?? snapshot.inspections.length}. Data lokal tetap disimpan sebagai salinan.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Migrasi gagal. Backend aktif tidak diubah.');
    } finally {
      setBusy(false);
    }
  };

  const saveAccessRules = () => {
    try {
      persistProfile(activeTarget);
      setMessage('Profil dan aturan akses tersimpan. Pengaturan berlaku pada operasi berikutnya.');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pengaturan tidak dapat disimpan.');
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
            <p className="mt-1 text-xs text-slate-400">Pilih backend, kontrol akses baca/tulis, uji koneksi, dan migrasikan data secara eksplisit.</p>
          </div>
        </div>
        <button onClick={onBack} className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"><ArrowLeft className="h-4 w-4" /> Settings</button>
      </div>

      <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/70 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Backend aktif: {activeTarget === 'local' ? 'Local Station / IndexedDB' : 'Local Company Server'}</div>
        <p className="mt-1 text-xs leading-5 text-slate-400">{activeTarget === 'local' ? 'Semua operasi data diarahkan ke database lokal browser ini.' : 'Operasi data master dan inspeksi diarahkan ke API server. Jika server tidak tersedia, operasi gagal secara eksplisit dan tidak diam-diam menulis ke lokal.'}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button type="button" onClick={() => setSelectedTarget('local')} className={`rounded-2xl border p-5 text-left transition ${selectedTarget === 'local' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><HardDrive className="h-5 w-5 text-emerald-300" /><span className="font-semibold text-white">Local Station</span></div>
            {activeTarget === 'local' && <CheckCircle2 className="h-5 w-5 text-emerald-300" />}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Master produk dan riwayat inspeksi disimpan di IndexedDB pada station ini.</p>
          <span className="mt-4 inline-flex rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">{activeTarget === 'local' ? 'Aktif' : 'Pilih untuk mengaktifkan'}</span>
        </button>

        <button type="button" onClick={() => setSelectedTarget('internal-server')} className={`rounded-2xl border p-5 text-left transition ${selectedTarget === 'internal-server' ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><Server className="h-5 w-5 text-amber-300" /><span className="font-semibold text-white">Local Company Server</span></div>
            {activeTarget === 'internal-server' && <Network className="h-5 w-5 text-amber-300" />}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Penyimpanan terpusat untuk master dan riwayat bersama melalui API internal.</p>
          <span className="mt-4 inline-flex rounded-lg border border-amber-500/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">{activeTarget === 'internal-server' ? 'Aktif' : 'Belum aktif'}</span>
        </button>
      </div>

      {selectedTarget === 'local' && activeTarget !== 'local' && (
        <div className="flex justify-end">
          <button onClick={useLocalStation} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-300">Activate Local Station</button>
        </div>
      )}

      {selectedTarget === 'internal-server' && (
        <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <h2 className="font-semibold text-white">Internal server profile</h2>
              <p className="mt-1 text-xs leading-5 text-amber-100/70">Jalankan server dari folder <code>server/</code> terlebih dahulu. Endpoint harus menunjuk ke base URL API, misalnya <code>http://192.168.1.20:8787/api</code>. Token harus sama dengan <code>VISION_SERVER_TOKEN</code> pada mesin server.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs text-slate-300">Nama station
              <input value={draft.stationName} onChange={(event) => setDraft((current) => ({ ...current, stationName: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" placeholder="STAND-CAM-01" />
            </label>
            <label className="block text-xs text-slate-300">Internal API base URL
              <input value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" placeholder="http://192.168.1.20:8787/api" />
            </label>
            <label className="block text-xs text-slate-300 md:col-span-2">Server access token
              <input type="password" autoComplete="new-password" value={draft.accessToken} onChange={(event) => setDraft((current) => ({ ...current, accessToken: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" placeholder="Masukkan token dari pengelola server" />
              <span className="mt-1 block text-[10px] text-slate-500">Token disimpan di localStorage browser. Ini autentikasi sederhana untuk jaringan internal, bukan pengganti identitas pengguna enterprise. Jangan mengekspos API ke internet.</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button disabled={!endpointIsValid || !draft.accessToken.trim() || connection === 'testing' || busy} onClick={testConnection} className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 px-4 py-2.5 text-xs font-semibold text-cyan-200 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${connection === 'testing' ? 'animate-spin' : ''}`} /> {connection === 'testing' ? 'Testing…' : 'Test connection'}</button>
            <button disabled={connection !== 'connected' || busy} onClick={migrateAndActivate} className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-40"><UploadCloud className="h-4 w-4" /> {busy ? 'Migrating…' : 'Migrate local data & activate'}</button>
            <button disabled={connection !== 'connected' || busy} onClick={activateServerWithoutMigration} className="rounded-xl border border-amber-500/40 px-4 py-2.5 text-xs font-semibold text-amber-200 disabled:opacity-40">Activate without migration</button>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">Migrasi menggabungkan data berdasarkan ID, tidak menghapus IndexedDB, dan akan ditolak bila ditemukan ID yang sama dengan isi berbeda. Uji koneksi menyimpan profil tetapi tidak mengubah backend aktif.</p>
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <h2 className="font-semibold text-white">Read / write controls</h2>
        <p className="text-xs leading-5 text-slate-400">Aturan ini berlaku untuk operasi aplikasi saat backend server aktif. Backend lokal tetap memiliki perilaku lokalnya sendiri.</p>
        <label className="flex items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={draft.readEnabled} onChange={(event) => setDraft((current) => ({ ...current, readEnabled: event.target.checked }))} className="h-4 w-4 accent-cyan-400" /> Izinkan baca data dari server</label>
        <label className="flex items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={draft.writeEnabled} onChange={(event) => setDraft((current) => ({ ...current, writeEnabled: event.target.checked }))} className="h-4 w-4 accent-cyan-400" /> Izinkan tulis, ubah, dan hapus data di server</label>
        <button onClick={saveAccessRules} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">Save profile & access rules</button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">{message}</div>}
    </section>
  );
};
