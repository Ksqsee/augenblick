import { Camera, CameraOff, Search } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Button, Card, ErrorBox, Input, PageHeader } from '../components/ui';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

/** Aus QR-Inhalt (URL …/e/CODE oder reiner Code) den Element-Code holen. */
export function extractCode(raw: string): string {
  const s = raw.trim();
  const m = s.match(/\/e\/([^/?#]+)/);
  return decodeURIComponent(m ? m[1] : s).toUpperCase();
}

export function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'idle' | 'on' | 'unsupported' | 'denied'>('idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  const open = async (raw: string) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const c = extractCode(raw);
      const r = await api<{ id: string }>(`/assets/by-code/${encodeURIComponent(c)}`);
      navigate(`/elemente/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? new Error(`Kein Element mit Code „${extractCode(raw)}“ gefunden`) : e);
      busy.current = false;
    }
  };

  useEffect(() => {
    if (camera !== 'on') return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const det = new window.BarcodeDetector!({ formats: ['qr_code', 'code_128', 'ean_13'] });
        const loop = async () => {
          if (stop) return;
          try {
            const hits = await det.detect(v);
            if (hits[0]) return open(hits[0].rawValue);
          } catch {
            /* nächster Frame */
          }
          requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setCamera('denied');
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const start = () => setCamera(window.BarcodeDetector && navigator.mediaDevices ? 'on' : 'unsupported');

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Code scannen" subtitle="QR-Etikett am Element scannen oder Code eintippen" />
      <Card className="overflow-hidden">
        <div className="relative grid aspect-square place-items-center bg-ink text-white/70">
          {camera === 'on' ? (
            <>
              <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
              <div className="relative size-3/5 rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 p-8 text-center">
              {camera === 'idle' ? <Camera className="size-10" /> : <CameraOff className="size-10" />}
              <p className="text-sm">
                {camera === 'idle' && 'Kamera starten, um ein Etikett zu scannen.'}
                {camera === 'unsupported' && 'Dieser Browser kann keine Codes über die Kamera lesen. Bitte Code unten eingeben oder die Kamera-App des Handys nutzen – der QR-Code öffnet das Element direkt.'}
                {camera === 'denied' && 'Kein Kamerazugriff. Bitte Berechtigung erteilen oder Code eingeben.'}
              </p>
              {camera === 'idle' && (
                <Button variant="secondary" onClick={start}>
                  Kamera starten
                </Button>
              )}
            </div>
          )}
        </div>
        <form
          className="flex gap-2 p-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (code.trim()) open(code);
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, z. B. FST-7K2M" className="font-mono uppercase" />
          <Button icon={<Search className="size-4" />}>Öffnen</Button>
        </form>
        {!!error && (
          <div className="px-4 pb-4">
            <ErrorBox error={error} />
          </div>
        )}
      </Card>
    </div>
  );
}
