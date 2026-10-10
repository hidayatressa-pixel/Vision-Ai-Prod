import React, { useState } from 'react';
import { Boxes, Camera, Cable, Gauge, LockKeyhole, X } from 'lucide-react';
import { ActiveTab } from '../Navbar';
import { EngineeringPinGate } from '../auth/EngineeringPinGate';

interface SettingsViewProps {
  onNavigate: (tab: ActiveTab) => void;
  onClose: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onNavigate, onClose }) => {
  const [unlocked, setUnlocked] = useState(false);

  if (!unlocked) {
    return (
      <EngineeringPinGate
        title="Settings"
        description="Engineering settings require authorization."
        onSuccess={() => setUnlocked(true)}
        onCancel={onClose}
      />
    );
  }

  const items: Array<{ label: string; description: string; icon: React.ReactElement<{ className?: string }>; tab: ActiveTab }> = [
    { label: 'Master & Inspection', description: 'Product master, six references, ROI and tolerances.', icon: <Boxes />, tab: 'MASTERS' },
    { label: 'Camera', description: 'Camera device and calibration.', icon: <Camera />, tab: 'CAMERA_SETUP' },
    { label: 'PLC', description: 'Trigger, handshake and PLC configuration.', icon: <Cable />, tab: 'PLC_SETUP' },
    { label: 'Diagnostics', description: 'Technical runtime metrics and troubleshooting.', icon: <Gauge />, tab: 'DIAGNOSTICS' },
  ];

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-5 py-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-amber-400">Engineering Access</div>
          <h1 className="mt-1 text-xl font-bold text-white">System Settings</h1>
          <p className="text-xs text-slate-400">Protected configuration area.</p>
        </div>
        <button onClick={onClose} aria-label="Close settings" className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X /></button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item) => (
          <button key={item.tab} onClick={() => onNavigate(item.tab)} className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-left transition hover:border-cyan-500/40 hover:bg-slate-900">
            <div className="rounded-xl bg-slate-950 p-3 text-cyan-400 group-hover:text-cyan-300">{React.cloneElement(item.icon, { className: 'h-5 w-5' })}</div>
            <div><div className="font-semibold text-white">{item.label}</div><div className="mt-1 text-xs text-slate-500">{item.description}</div></div>
          </button>
        ))}
      </div>
    </section>
  );
};
