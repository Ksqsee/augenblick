// Diktat-Knöpfe: kleiner Mikrofon-Knopf für Textfelder und der große Aufnahmeknopf für „Erfassen“.
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
        rec ? 'bg-bad text-white' : d.error ? 'bg-bad/10 text-bad' : 'bg-sunken text-ink-2 hover:bg-line hover:text-ink',
        className,
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : rec ? <Square className="size-3 fill-current" /> : <Mic className="size-3.5" />}
      {rec ? fmtSeconds(d.seconds) : busy ? 'Wandle um…' : null}
    </button>
  );
}

/** Wellenform aus den letzten Pegelwerten (Live-Anzeige während der Aufnahme). */
function Wave({ level, active }: { level: number; active: boolean }) {
  const [bars, setBars] = useState<number[]>(() => Array(28).fill(0.08));
  useEffect(() => {
    if (!active) return setBars(Array(28).fill(0.08));
    setBars((b) => [...b.slice(1), Math.max(0.08, level)]);
  }, [level, active]);
  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden>
      {bars.map((v, i) => (
        <span key={i} className={clsx('w-[3px] rounded-full transition-[height] duration-75', active ? 'bg-bad' : 'bg-line-strong')} style={{ height: `${Math.round(8 + v * 32)}px` }} />
      ))}
    </div>
  );
}

/** Großer Aufnahmeknopf mit Wellenform und Zeit. */
export function BigMic({ dictation: d, label = 'Tippen und sprechen', hint }: { dictation: ReturnType<typeof useDictation>; label?: string; hint?: string }) {
  const rec = d.state === 'recording';
  const busy = d.state === 'transcribing';
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-center gap-4">
        <div className="hidden min-w-0 flex-1 justify-end sm:flex">{rec && <Wave level={d.level} active />}</div>
        <button
          type="button"
          aria-label={rec ? 'Aufnahme beenden' : 'Aufnahme starten'}
          disabled={busy || d.engine === 'none'}
          onClick={() => (rec ? d.stop() : d.start())}
          className={clsx(
            'relative grid size-20 shrink-0 place-items-center rounded-full text-white shadow-lift transition active:scale-95 disabled:opacity-50',
            rec ? 'animate-rec bg-bad' : 'bg-brand hover:bg-brand-strong',
          )}
        >
          {busy ? <Loader2 className="size-8 animate-spin" /> : rec ? <Square className="size-7 fill-current" /> : <Mic className="size-8" />}
        </button>
        <div className="hidden min-w-0 flex-1 sm:flex">{rec && <Wave level={d.level} active />}</div>
      </div>
      {rec && (
        <div className="sm:hidden">
          <Wave level={d.level} active />
        </div>
      )}
      <p className={clsx('text-center text-sm', d.error ? 'text-bad' : rec ? 'font-medium text-ink' : 'text-ink-3')}>
        {d.error || (rec ? `Ich höre zu · ${fmtSeconds(d.seconds)}` : busy ? 'Wandle Sprache in Text um…' : d.engine === 'none' ? 'Diktat in diesem Browser nicht verfügbar – einfach tippen' : label)}
      </p>
      {hint && !rec && !busy && <p className="-mt-2 text-center text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
