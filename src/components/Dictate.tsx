// Diktat-Knöpfe: kleiner Mikrofon-Knopf für Textfelder und der große Aufnahmeknopf für „Erfassen“.
// v3: Mikrofon schwarz bzw. grau, während der Aufnahme Zinnober – ohne Pulsschein, nur die Wellenform bewegt sich.
import clsx from 'clsx';
import { Loader2, Mic, Square } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { fmtSeconds, useDictation } from '../dictate';

/** Wert so setzen, dass React ein normales onChange auslöst (funktioniert für gesteuerte und freie Felder). */
export function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const join = (base: string, add: string) => (!add ? base : !base.trim() ? add : `${base.replace(/\s+$/, '')}${/[.!?:]$/.test(base.trim()) ? ' ' : '. '}${add}`);

/** Mikrofon-Knopf, der in ein Feld hineindiktiert (anhängen, nicht ersetzen). */
export function FieldMic({ target, className }: { target: RefObject<HTMLInputElement | HTMLTextAreaElement | null>; className?: string }) {
  const base = useRef('');
  const d = useDictation((text) => {
    const el = target.current;
    if (el) setFieldValue(el, join(base.current, text));
  });
  if (d.engine === null || d.engine === 'none') return null;
  const busy = d.state === 'transcribing';
  const rec = d.state === 'recording';
  return (
    <button
      type="button"
      aria-label={rec ? 'Diktat beenden' : 'Diktieren'}
      title={d.error || (rec ? 'Diktat beenden' : 'Diktieren')}
      disabled={busy || target.current?.disabled}
      onClick={() => {
        if (rec) return d.stop();
        base.current = target.current?.value ?? '';
        d.start();
      }}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition',
        rec ? 'bg-shu text-white' : d.error ? 'text-shu hover:bg-hover' : 'text-ink-3 hover:bg-hover hover:text-ink',
        className,
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : rec ? <Square className="size-3 fill-current" /> : <Mic className="size-3.5" />}
      {rec ? fmtSeconds(d.seconds) : busy ? 'Wandle um…' : null}
    </button>
  );
}

/** Wellenform aus den letzten Pegelwerten (Live-Anzeige während der Aufnahme). */
export function Wave({ level, active, bars: count = 28, className }: { level: number; active: boolean; bars?: number; className?: string }) {
  const [bars, setBars] = useState<number[]>(() => Array(count).fill(0.08));
  useEffect(() => {
    if (!active) return setBars(Array(count).fill(0.08));
    setBars((b) => [...b.slice(1), Math.max(0.08, level)]);
  }, [level, active, count]);
  return (
    <div className={clsx('flex h-10 items-center gap-[3px]', className)} aria-hidden>
      {bars.map((v, i) => (
        <span key={i} className={clsx('w-[3px] rounded-full transition-[height] duration-75', active ? 'bg-ink' : 'bg-line-strong')} style={{ height: `${Math.round(6 + v * 30)}px` }} />
      ))}
    </div>
  );
}

/** Großer Aufnahmeknopf mit Wellenform und Zeit (Erfassen). */
export function BigMic({ dictation: d, label = 'Tippen und sprechen', hint }: { dictation: ReturnType<typeof useDictation>; label?: string; hint?: string }) {
  const rec = d.state === 'recording';
  const busy = d.state === 'transcribing';
  return (
    <div className="flex flex-col items-center gap-3 pt-1">
      <button
        type="button"
        aria-label={rec ? 'Aufnahme beenden' : 'Aufnahme starten'}
        disabled={busy || d.engine === 'none'}
        onClick={() => (rec ? d.stop() : d.start())}
        className={clsx(
          'relative grid size-16 shrink-0 place-items-center rounded-full text-white transition-colors active:opacity-85 disabled:opacity-50',
          rec ? 'bg-shu' : 'bg-ink hover:bg-brand-strong',
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : rec ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
      </button>
      <div className="flex h-10 items-center">{rec ? <Wave level={d.level} active bars={32} /> : <Wave level={0} active={false} bars={32} />}</div>
      <p className={clsx('-mt-1 text-center text-body', d.error ? 'text-shu' : 'text-ink', rec && 'tabular-nums')}>
        {d.error || (rec ? `Ich höre zu · ${fmtSeconds(d.seconds)}` : busy ? 'Wandle Sprache in Text um …' : d.engine === 'none' ? 'Diktat hier nicht verfügbar – einfach tippen' : label)}
      </p>
      {hint && !rec && !busy && <p className="-mt-2 max-w-xs text-center text-meta text-ink-3">{hint}</p>}
    </div>
  );
}
