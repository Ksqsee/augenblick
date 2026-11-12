// Unterschrift: Name + Zeichenfläche mit Grundlinie. Der zuletzt verwendete Name wird pro Prüfer/in gemerkt,
// auf Wunsch auch die Unterschrift selbst – nur auf diesem Gerät (localStorage), nie getrennt an den Server.
import { Eraser, PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../api';
import { fmtDate } from '../../format';
import { Button, Card, Field, Input } from '../ui';

// ---------- Gemerkte Unterschrift (je Person, nur auf diesem Gerät) ----------
const sigKey = (userId: string) => `pk:signature:${userId}`;
const SIG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export function rememberedSignature(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    const v = localStorage.getItem(sigKey(userId));
    return v && SIG_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberSignature(userId: string, dataUrl: string) {
  try {
    if (SIG_RE.test(dataUrl)) localStorage.setItem(sigKey(userId), dataUrl);
  } catch {
    /* Speicher voll oder gesperrt – dann eben nicht gemerkt */
  }
}

export function forgetSignature(userId: string) {
  try {
    localStorage.removeItem(sigKey(userId));
  } catch {
    /* ohne Speicher */
  }
}

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
  onQuickFinish,
}: {
  /** „Mit gemerkter Unterschrift abschließen“: setzt die Unterschrift und schließt ab (nur wenn sonst alles fertig ist) */
  onQuickFinish?: (signature: string) => void;
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

  const { data: me } = useMe();
  const userId = me?.user.id;
  const [saved, setSaved] = useState<string | null>(() => rememberedSignature(userId));
  const [optIn, setOptIn] = useState(() => !!saved);
  useEffect(() => {
    const v = rememberedSignature(userId);
    setSaved(v);
    setOptIn(!!v);
  }, [userId]);
  // Pad nach „gemerkte einsetzen“ neu einhängen, damit es das Bild zeigt
  const [padKey, setPadKey] = useState(0);
  const setSignature = (v: string | null) => {
    onSignature(v);
    // gemerkte Unterschrift aktuell halten, solange „merken“ an ist
    if (v && optIn && userId) {
      rememberSignature(userId, v);
      setSaved(v);
    }
  };
  const applySaved = () => {
    if (!saved) return;
    onSignature(saved);
    setPadKey((k) => k + 1);
  };

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
        {saved && !signature && (
          <div className="flex flex-col gap-3 rounded-lg bg-canvas p-3 sm:flex-row sm:items-center">
            <img src={saved} alt="Gemerkte Unterschrift" className="h-12 w-32 shrink-0 rounded border border-line bg-surface object-contain" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
              {onQuickFinish ? (
                <Button icon={<PenLine />} onClick={() => onQuickFinish(saved)}>
                  Mit gemerkter Unterschrift abschließen
                </Button>
              ) : (
                <Button variant="secondary" icon={<PenLine />} onClick={applySaved}>
                  Gemerkte Unterschrift einsetzen
                </Button>
              )}
            </div>
          </div>
        )}
        <SignaturePad key={padKey} value={signature} onChange={setSignature} caption={name.trim() || fallbackName} />
        {userId && (
          <label className="flex items-start gap-3 text-body">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-ink"
              checked={optIn}
              onChange={(e) => {
                setOptIn(e.target.checked);
                if (!e.target.checked) {
                  forgetSignature(userId);
                  setSaved(null);
                } else if (signature) {
                  rememberSignature(userId, signature);
                  setSaved(rememberedSignature(userId));
                }
              }}
            />
            <span>
              Unterschrift auf diesem Gerät merken
              <span className="block text-meta text-ink-3">
                Wird nur in diesem Browser gespeichert, nicht auf dem Server – nur als Teil einer abgeschlossenen Prüfung. Vergessen unter Einstellungen → Konto.
              </span>
            </span>
          </label>
        )}
      </Card>
    </section>
  );
}
