import { ArrowRight, Camera, CameraOff } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Button, ErrorBox, Input, PageHeader, Surface } from '../components/ui';

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
      <PageHeader title="Code scannen" subtitle="QR-Etikett am Element scannen – die Prüfung ist dann einen Tipp entfernt." />
      <Surface className="overflow-hidden">
        <div className="relative flex aspect-square flex-col items-center justify-center gap-6 overflow-hidden bg-ink px-6 text-white sm:aspect-[4/3] sm:rounded-t-xl">
          {camera === 'on' && <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />}
          {/* Sucher: vier Ecken statt Rahmen */}
          <div aria-hidden className="pointer-events-none relative size-44 shrink-0 sm:size-56">
            {['top-0 left-0 border-t-2 border-l-2 rounded-tl-md', 'top-0 right-0 border-t-2 border-r-2 rounded-tr-md', 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-md', 'bottom-0 right-0 border-r-2 border-b-2 rounded-br-md'].map((c) => (
              <span key={c} className={`absolute size-7 border-white/85 ${c}`} />
            ))}
          </div>
          {camera !== 'on' && (
            <div className="relative flex flex-col items-center gap-4 text-center">
              <p className="max-w-xs text-meta text-white/75">
                {camera === 'idle' && 'Halte die Kamera auf das QR-Etikett. Das Element öffnet sich von selbst.'}
                {camera === 'unsupported' && 'Dieser Browser liest keine Codes über die Kamera. Gib den Code unten ein – oder öffne den QR-Code mit der Kamera-App des Handys.'}
                {camera === 'denied' && 'Kein Kamerazugriff. Erlaube die Kamera in den Browser-Einstellungen oder gib den Code unten ein.'}
              </p>
              {camera === 'idle' && (
                <Button size="lg" variant="secondary" icon={<Camera />} onClick={start}>
                  Kamera starten
                </Button>
              )}
              {camera !== 'idle' && <CameraOff className="size-6 text-white/60" />}
            </div>
          )}
          {camera === 'on' && <p className="absolute inset-x-0 bottom-5 text-center text-meta text-white/85">Suche Code …</p>}
        </div>
        <form
          className="flex flex-col gap-2 px-(--row-px) py-5 sm:py-6"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (code.trim()) open(code);
          }}
        >
          <label htmlFor="scan-code" className="text-meta font-medium text-ink-3">
            Oder Code eingeben
          </label>
          <div className="flex gap-2">
            <Input
              id="scan-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="z. B. FST-7K2M"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase"
            />
            <Button type="submit" variant="primary" disabled={!code.trim()} icon={<ArrowRight />} className="shrink-0">
              Öffnen
            </Button>
          </div>
          {!!error && <ErrorBox error={error} className="mt-2" />}
        </form>
      </Surface>
    </div>
  );
}
