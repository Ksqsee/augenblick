// Bausteine für Verwaltungsseiten (Einstellungen, Team, Import, Berichte) und öffentliche Seiten.
// Ergänzen ui.tsx, ohne es zu ändern. Regeln: docs/design.md, Verwendung: docs/design/verwaltung.md
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, IconButton, Input, useToast } from '../ui';

/**
 * Zeile innerhalb einer SettingsSection: links Bezeichnung + Erklärung, rechts das Bedienelement.
 * Auf dem Handy steht das Bedienelement unter dem Text (volle Breite), außer inline=true (z. B. Schalter).
 */
export function SettingRow({
  title,
  description,
  children,
  inline,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('flex gap-3', inline ? 'items-center justify-between' : 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)}>
      <div className="min-w-0">
        <p className="text-body font-medium text-ink">{title}</p>
        {description && <p className="mt-0.5 text-meta text-ink-3">{description}</p>}
      </div>
      {children && <div className={clsx('flex shrink-0 items-center gap-2', !inline && 'max-sm:[&>*]:flex-1')}>{children}</div>}
    </div>
  );
}

/** Trennlinie zwischen SettingRows in derselben Karte (Karte hat p-4/p-5, die Linie läuft bis zum Rand). */
export function RowDivider() {
  return <hr className="-mx-4 border-line sm:-mx-5" />;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Nur-Lese-Feld mit Kopieren-Knopf (Schlüssel, Links, Adressen). label wird aria-label des Felds. */
export function CopyField({ value, label, mono = true, className }: { value: string; label: string; mono?: boolean; className?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <div className={clsx('flex min-w-0 gap-2', className)}>
      <Input readOnly aria-label={label} value={value} onFocus={(e) => e.target.select()} className={clsx('min-w-0 flex-1', mono && 'font-mono !text-meta')} />
      <Button
        type="button"
        variant="secondary"
        icon={done ? <Check /> : <Copy />}
        onClick={async () => {
          const ok = await copyText(value);
          setDone(ok);
          toast(ok ? 'Kopiert' : 'Kopieren nicht möglich', ok ? 'ok' : 'bad');
          if (ok) setTimeout(() => setDone(false), 1600);
        }}
      >
        Kopieren
      </Button>
    </div>
  );
}

/** Code-/Befehlszeile in Mono mit Kopieren-Symbol. Scrollt waagrecht in sich (kein Seitenüberlauf). */
export function CodeBlock({ code, label = 'Befehl kopieren', className }: { code: string; label?: string; className?: string }) {
  const toast = useToast();
  return (
    <div className={clsx('group relative min-w-0 rounded-lg border border-line bg-canvas', className)}>
      <pre className="scroll-thin overflow-x-auto py-2.5 pr-12 pl-3 font-mono text-caption leading-5 text-ink">{code}</pre>
      <IconButton
        label={label}
        size="sm"
        icon={<Copy />}
        className="absolute top-1 right-1 bg-canvas"
        onClick={async () => toast((await copyText(code)) ? 'Kopiert' : 'Kopieren nicht möglich')}
      />
    </div>
  );
}

/** Nummerierte Schritte (Anleitung). Jeder Schritt: Titel, Text, optional Inhalt (Feld, Knopf). */
export function Steps({ items, className }: { items: { title: ReactNode; text?: ReactNode; children?: ReactNode }[]; className?: string }) {
  return (
    <ol className={clsx('relative flex flex-col', className)}>
      {items.map((s, i) => (
        <li key={i} className="relative flex gap-3.5 pb-6 last:pb-0">
          {i < items.length - 1 && <span aria-hidden className="absolute top-8 bottom-1 left-[13px] w-px bg-line" />}
          <span className="relative grid size-7 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-caption font-semibold text-ink tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-body font-medium text-ink">{s.title}</p>
            {s.text && <div className="mt-0.5 text-meta text-ink-3">{s.text}</div>}
            {s.children && <div className="mt-3">{s.children}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Fortschritt eines Ablaufs („1 Datei · 2 Prüfen · 3 Fertig“). current ist 0-basiert. */
export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={clsx('flex items-center gap-2 text-meta', className)} aria-label="Fortschritt">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className="flex min-w-0 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={clsx(
                'grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold tabular-nums',
                state === 'done' && 'bg-ok-soft text-ok',
                state === 'current' && 'bg-ink text-white',
                state === 'todo' && 'border border-line-strong text-ink-3',
              )}
            >
              {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={clsx('truncate font-medium', state === 'todo' ? 'text-ink-3' : 'text-ink', state !== 'current' && 'max-sm:hidden')}>{s}</span>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-6 shrink-0 bg-line-strong sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Leiste „Ungespeicherte Änderungen“ – klebt unten im Sichtbereich, solange ein Formular geändert ist.
 * Auf dem Handy über der unteren Navigationsleiste.
 */
export function SaveBar({ dirty, saving, onReset, children = 'Speichern' }: { dirty: boolean; saving?: boolean; onReset: () => void; children?: ReactNode }) {
  if (!dirty) return null;
  return (
    <div className="animate-in sticky bottom-24 z-20 mt-6 lg:bottom-6">
      <div className="flex items-center gap-3 rounded-xl bg-ink py-2.5 pr-2.5 pl-4 text-white shadow-pop">
        <span className="min-w-0 flex-1 truncate text-body font-medium">Ungespeicherte Änderungen</span>
        <button type="button" onClick={onReset} className="h-9 shrink-0 rounded-lg px-3 text-meta font-medium text-white/75 hover:bg-white/10 hover:text-white">
          Verwerfen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-9 shrink-0 items-center rounded-lg bg-white px-3.5 text-meta font-semibold text-ink transition hover:bg-white/90 disabled:opacity-60"
        >
          {children}
        </button>
      </div>
    </div>
  );
}

/** Balken für Anteile (Speicher, Quote). parts: Anteil in Prozent + Farbklasse. */
export function MeterBar({ parts, label, className }: { parts: { value: number; className: string; key: string }[]; label: string; className?: string }) {
  return (
    <div className={clsx('flex h-2 gap-0.5 overflow-hidden rounded-full bg-sunken', className)} role="img" aria-label={label}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.key} className={clsx('h-full first:rounded-l-full last:rounded-r-full', p.className)} style={{ width: `${Math.max(p.value, 1)}%` }} />
      ))}
    </div>
  );
}

/** Kopf für öffentliche Seiten (Kunden-Link, Auftrag für Subunternehmer, Rechtstexte). */
export function PublicHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
        {actions}
      </div>
    </header>
  );
}
