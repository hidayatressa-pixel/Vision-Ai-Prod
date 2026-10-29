import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, CircleAlert } from 'lucide-react';
import { createRemoteCameraSession } from '../../services/remoteCamera';

export const PhoneCameraView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef(createRemoteCameraSession());
  const [status, setStatus] = useState<'starting' | 'connected' | 'error'>('starting');
  const [message, setMessage] = useState('Requesting camera access...');

  useEffect(() => {
    let cancelled = false;
    let cameraRequestTimedOut = false;
    let cameraTimeoutId: number | undefined;
    const controllerId = new URLSearchParams(window.location.search).get('session');

    if (!controllerId) {
      setStatus('error');
      setMessage('Missing laptop pairing session. Return to the laptop and scan a newly generated QR code.');
      return;
    }

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API is not available. Open this page over HTTPS or localhost in a supported browser.');
        }

        // Ask for the rear camera without strict resolution constraints. This is
        // more reliable across Android devices; Vision reads the actual frame size.
        const streamPromise = navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        }).then((stream) => {
          // getUserMedia cannot be cancelled. If it resolves after timeout/unmount,
          // stop its tracks immediately so the phone camera is not left running.
          if (cameraRequestTimedOut || cancelled) {
            stream.getTracks().forEach((track) => track.stop());
          }
          return stream;
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          cameraTimeoutId = window.setTimeout(() => {
            cameraRequestTimedOut = true;
            reject(new Error('Camera request timed out after 15 seconds. Check site permissions and reload the page.'));
          }, 15000);
        });

        const stream = await Promise.race([streamPromise, timeoutPromise]);
        if (cameraTimeoutId !== undefined) window.clearTimeout(cameraTimeoutId);
        cameraTimeoutId = undefined;

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        setMessage('Camera permission granted. Establishing secure media connection to laptop...');
        await sessionRef.current.waitForController(controllerId, stream);

        if (!cancelled) {
          setStatus('connected');
          setMessage('WebRTC media connection established. Confirm that the laptop preview is live before starting inspection.');
        }
      } catch (error) {
        console.error('Phone camera connection error:', error);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (!cancelled) {
          setStatus('error');
          const errorName = error instanceof DOMException ? error.name : '';
          if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
            setMessage('Camera permission is blocked or this page is not in a secure context. Allow camera access and open the HTTPS link again.');
          } else if (errorName === 'NotFoundError') {
            setMessage('No camera was found on this phone.');
          } else if (errorName === 'NotReadableError' || errorName === 'AbortError') {
            setMessage('The camera is busy or unavailable. Close other camera apps and reload.');
          } else {
            setMessage(error instanceof Error ? error.message : 'Unable to start phone camera.');
          }
        }
      } finally {
        if (cameraTimeoutId !== undefined) window.clearTimeout(cameraTimeoutId);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (cameraTimeoutId !== undefined) window.clearTimeout(cameraTimeoutId);
      sessionRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="p-5 border-b border-slate-800 flex items-center gap-3">
        <Camera className="w-6 h-6 text-cyan-400" />
        <div>
          <div className="font-bold tracking-wide">VISION AI CAMERA</div>
          <div className="text-[10px] text-slate-500 font-mono">PHONE CAMERA DEVICE</div>
        </div>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-4">
        <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        </div>

        <div className={`rounded-2xl border p-4 flex items-center gap-3 ${status === 'connected' ? 'border-emerald-500/40 bg-emerald-500/5' : status === 'error' ? 'border-red-500/40 bg-red-500/5' : 'border-cyan-500/30 bg-cyan-500/5'}`}>
          {status === 'connected' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : status === 'error' ? <CircleAlert className="w-5 h-5 text-red-400" /> : <Camera className="w-5 h-5 text-cyan-400 animate-pulse" />}
          <div>
            <div className="font-bold text-sm">{status === 'connected' ? 'MEDIA CONNECTED' : status === 'error' ? 'CONNECTION ERROR' : 'CONNECTING...'}</div>
            <div className="text-xs text-slate-400 mt-1">{message}</div>
          </div>
        </div>

        <div className="text-center text-[10px] text-slate-600 font-mono">
          Keep this page open while Vision AI performs the inspection on the laptop.
        </div>
      </main>
    </div>
  );
};
