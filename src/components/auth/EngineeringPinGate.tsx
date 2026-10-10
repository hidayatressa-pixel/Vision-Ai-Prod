import React, { useState } from 'react';
import { ArrowRight, LockKeyhole, X } from 'lucide-react';

interface EngineeringPinGateProps {
  onSuccess: () => void;
  onCancel?: () => void;
  title?: string;
  description?: string;
}

export const EngineeringPinGate: React.FC<EngineeringPinGateProps> = ({
  onSuccess,
  onCancel,
  title = 'Engineering Access',
  description = 'Engineering settings require authorization.',
}) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const unlock = () => {
    if (password === '8888') {
      setError('');
      setPassword('');
      onSuccess();
      return;
    }
    setError('Incorrect PIN. Please try again.');
    setPassword('');
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-8">
      <div className="relative w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/95 p-7 shadow-2xl">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Back"
            className="absolute right-4 top-4 rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
          <LockKeyhole className="h-7 w-7" />
        </div>
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-amber-400">Authorized personnel</div>
          <h2 className="mt-2 text-lg font-bold text-white">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            unlock();
          }}
        >
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={4}
            value={password}
            onChange={(event) => setPassword(event.target.value.replace(/\D/g, ''))}
            placeholder="Enter 4-digit PIN"
            aria-label="Engineering PIN"
            className="mt-6 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center text-lg tracking-[0.5em] text-white outline-none focus:border-amber-400"
          />
          {error && <div role="alert" className="mt-2 text-center text-xs text-red-400">{error}</div>}
          <button type="submit" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-400">
            Unlock <ArrowRight className="h-4 w-4" />
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="mt-3 w-full rounded-xl border border-slate-800 px-4 py-2.5 text-xs text-slate-400 hover:text-white">
              Back to welcome
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
