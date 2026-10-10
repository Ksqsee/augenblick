import { Eraser } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** Unterschriftenfeld (Pointer Events, funktioniert mit Finger, Stift und Maus). Liefert PNG-Data-URL. */
export function SignaturePad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
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
    ctx.strokeStyle = '#1c1917';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, width, height);
      img.src = value;
    }
    // nur beim Mounten den gespeicherten Wert zeichnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="relative">
      <canvas
        ref={ref}
        className="h-40 w-full touch-none rounded-xl border border-dashed border-line-strong bg-surface"
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
      {!value && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-ink-3">Hier unterschreiben</span>}
      {value && (
        <button
          type="button"
          className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-sunken px-2 py-1 text-xs font-medium text-ink-2 hover:text-ink"
          onClick={() => {
            const c = ref.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            dirty.current = false;
            onChange(null);
          }}
        >
          <Eraser className="size-3.5" /> Löschen
        </button>
      )}
    </div>
  );
}
