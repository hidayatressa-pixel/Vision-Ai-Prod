import React, { useState } from 'react';
import { ArrowRight, ScanLine, ShieldCheck, Sparkles } from 'lucide-react';
import { EngineeringPinGate } from './EngineeringPinGate';

interface WelcomeScreenProps {
  onAuthorized: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onAuthorized }) => {
  const [showPin, setShowPin] = useState(false);

  if (showPin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="border-b border-slate-800/80 px-5 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-[0.16em] text-white">VISION STATION</div>
              <div className="text-[10px] font-mono tracking-wider text-slate-500">INTELLIGENT VISUAL INSPECTION</div>
            </div>
          </div>
        </header>
        <main className="flex-1">
          <EngineeringPinGate
            title="Engineering Access"
            description="Enter your security PIN to continue to initial setup."
            onSuccess={onAuthorized}
            onCancel={() => setShowPin(false)}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950/50 via-slate-950 to-slate-950" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-900/20" />
      <main className="relative w-full max-w-xl">
        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/75 p-7 text-center shadow-2xl shadow-black/30 backdrop-blur sm:p-10">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 shadow-lg shadow-cyan-950/30">
            <ScanLine className="h-10 w-10" strokeWidth={1.6} />
          </div>
          <div className="mt-6 text-xs font-mono uppercase tracking-[0.3em] text-cyan-300">Intelligent Visual Inspection</div>
          <h1 className="mt-3 text-3xl font-bold tracking-[0.12em] text-white sm:text-4xl">VISION STATION</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">Precision in every inspection. Quality in every part.</p>
          <div className="my-8 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
          <div className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-left">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <div className="text-sm font-semibold text-white">First-time setup</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">Please complete the initial setup and enter your security PIN to continue.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPin(true)}
            className="mt-5 flex w-full items-center justify-between rounded-2xl border border-cyan-400/40 bg-cyan-500 px-5 py-4 text-left text-sm font-bold text-slate-950 transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> First Setup &amp; Security PIN</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/10"><ArrowRight className="h-5 w-5" /></span>
          </button>
          <p className="mt-6 text-[10px] font-mono tracking-[0.2em] text-slate-600">SECURE ACCESS · AUTHORIZED PERSONNEL ONLY</p>
        </div>
      </main>
    </div>
  );
};
