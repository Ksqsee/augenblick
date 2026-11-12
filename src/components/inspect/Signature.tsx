// Unterschrift: Name + Zeichenfläche mit Grundlinie. Der zuletzt verwendete Name wird pro Prüfer/in gemerkt.
import { Eraser } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { fmtDate } from '../../format';
import { Card, Field, Input } from '../ui';

/** Zeichenfläche (Pointer Events: Finger, Stift, Maus). Liefert eine PNG-Data-URL. */
export function SignaturePad({ value, onChange, caption }: { value: string | null; onChange: (v: string | null) => void; caption?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1714';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, width, height);
      img.src = value;
    }
    // nur beim Einhängen den gespeicherten Wert zeichnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="relative h-44 overflow-hidden rounded-lg border border-line bg-surface">
      {/* Grundlinie mit Kreuz – zeichnet sich nicht mit ins Bild */}
      <div aria-hidden className="pointer-events-none absolute inset-x-5 bottom-11 flex items-end gap-2 border-b border-line-strong pb-1 text-ink-4">
        <span className="text-[18px] leading-none">×</span>
      </div>
      <p aria-hidden className="pointer-events-none absolute inset-x-5 bottom-4 truncate text-center text-caption text-ink-3">
        {caption}
      </p>
      {!value && (
        <p aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-8 text-center text-meta text-ink-4">
          Mit dem Finger unterschreiben
        </p>
      )}
      <canvas
        ref={ref}
        aria-label="Unterschrift zeichnen"
        className="absolute inset-0 size-full touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      {value && (
        <button
          type="button"
          className="absolute top-2 right-2 inline-flex h-8 items-center gap-1.5 rounded-md bg-sunken px-2.5 text-caption font-medium text-ink-2 hover:text-ink"
          onClick={() => {
            const c = ref.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            dirty.current = false;
            onChange(null);
          }}
        >
          <Eraser className="size-3.5" /> Neu unterschreiben
        </button>
      )}
    </div>
  );
}

const signerKey = (who: string) => `pk:signer:${who}`;

/** Abschnitt „Unterschrift“ mit Namensfeld; schlägt den zuletzt benutzten Namen vor. */
export function SignatureSection({
  id = 'unterschrift',
  name,
  fallbackName,
  signature,
  onName,
  onSignature,
}: {
  id?: string;
  name: string;
  /** Name der angemeldeten Person – Standard, wenn nichts eingetragen ist */
  fallbackName: string;
  signature: string | null;
  onName: (v: string) => void;
  onSignature: (v: string | null) => void;
}) {
  // gemerkten Namen einsetzen, wenn das Feld leer ist
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || name || !fallbackName) return;
    asked.current = true;
    try {
      const saved = localStorage.getItem(signerKey(fallbackName));
      if (saved && saved !== fallbackName) onName(saved);
    } catch {
      /* ohne Speicher */
    }
  }, [name, fallbackName, onName]);

  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-2.5 flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-title font-semibold tracking-tight">Unterschrift</h2>
        <span className="text-meta text-ink-3">{fmtDate(Date.now())}</span>
      </div>
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <Field label="Name" hint={`Leer lassen für ${fallbackName || 'deinen Namen'}`}>
          {(fid) => (
            <Input
              id={fid}
              value={name}
              autoComplete="name"
              placeholder={fallbackName}
              onChange={(e) => {
                onName(e.target.value);
                try {
                  if (fallbackName) localStorage.setItem(signerKey(fallbackName), e.target.value.trim());
                } catch {
                  /* ohne Speicher */
                }
              }}
            />
          )}
        </Field>
        <SignaturePad value={signature} onChange={onSignature} caption={name.trim() || fallbackName} />
      </Card>
    </section>
  );
}
