// Bausteine für Verwaltungsseiten (Einstellungen, Team, Import, Berichte) und öffentliche Seiten – Designsystem v3.
// Ergänzen ui.tsx, ohne es zu ändern. Regeln: docs/design.md, Verwendung: docs/design/verwaltung.md
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtDateTime } from '../../format';
import { Logo } from '../Logo';
import { Button, IconButton, Input, useToast } from '../ui';

/**
 * Abschnitt einer Einstellungsseite innerhalb der einen Surface (v3): Haarlinie darüber, links kleiner grauer
 * Titel (h2, 13 px) und ein Satz, rechts die Felder/Zeilen; Aktionen (footer) rechts unten. Keine Karte.
 * Ersetzt SettingsSection aus ui.tsx (dort noch mit Karte) – gleiche Props.
 */
export function SettingsSection({
  title,
  description,
  children,
  footer,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={clsx('border-t border-line px-(--row-px) py-6 first:border-t-0 sm:py-8', className)}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0">
          <h2 className="text-meta font-medium text-ink-3">{title}</h2>
          {description && <p className="mt-1 max-w-prose text-meta text-ink-2">{description}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-2 pt-1">{footer}</div>}
        </div>
      </div>
    </section>
  );
}

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
        <div className="text-body text-ink">{title}</div>
        {description && <div className="mt-0.5 text-meta text-ink-3">{description}</div>}
      </div>
      {children && <div className={clsx('flex shrink-0 items-center gap-2', !inline && 'max-sm:[&>*]:flex-1')}>{children}</div>}
    </div>
  );
}

/** Haarlinie zwischen SettingRows im selben Abschnitt. */
export function RowDivider() {
  return <hr className="border-line" />;
}

/** Uhrzeit „09:12“ in der Zeitzone des Workspaces. */
export const fmtTime = (ts: number) => fmtDateTime(ts).split(', ')[1] ?? '';

/** „Heute“, „Gestern“ oder Datum – für nach Tagen gruppierte Protokolle. */
export function dayLabel(ts: number) {
  const d = fmtDate(ts);
  if (d === fmtDate(Date.now())) return 'Heute';
  if (d === fmtDate(Date.now() - 86_400_000)) return 'Gestern';
  return d;
}

/** Einträge (neueste zuerst) nach Tag gruppieren, Reihenfolge bleibt. */
export function groupByDay<T>(rows: T[], at: (r: T) => number): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = dayLabel(at(r));
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()];
}

/** Gruppen- oder Tageskopf innerhalb einer pk-list (13 px grau); die Zeile darunter bekommt keine Haarlinie. */
export function DayHeading({ children }: { children: ReactNode }) {
  return <li className="flex h-10 items-end px-(--row-px) pb-1.5 text-meta font-medium text-ink-3 [&+li]:before:hidden!">{children}</li>;
}
export const ListHeading = DayHeading;

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
    <div className={clsx('group relative min-w-0 rounded-md border border-line bg-canvas', className)}>
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
                state === 'done' && 'bg-selected text-ink',
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
    <div data-toast-avoid="" className="animate-in sticky bottom-24 z-20 mx-(--row-px,0) mb-6 lg:bottom-6">
      <div className="flex items-center gap-3 rounded-lg bg-ink py-2.5 pr-2.5 pl-4 text-white shadow-pop">
        <span className="min-w-0 flex-1 truncate text-body font-medium">Ungespeicherte Änderungen</span>
        <button type="button" onClick={onReset} className="h-9 shrink-0 rounded-md px-3 text-meta font-medium text-white/75 hover:bg-white/10 hover:text-white">
          Verwerfen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-white px-3.5 text-meta font-semibold text-ink transition hover:bg-white/90 disabled:opacity-60"
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

/**
 * Rahmen für öffentliche Seiten (Kunden-Link, Auftrag für Subunternehmer, Partner-Seite, OAuth-Freigabe,
 * Rechtstexte) im Stil der Anmeldung: Beton-Grund, Logo oben links, Inhalt linksbündig im Raster, ganz unten
 * Rechtslinks. Die eine weiße Fläche (Surface) setzt die Seite selbst.
 * width: narrow = 400 px (wie Anmeldung), text = 640 px, wide = 768 px.
 */
export function PublicPage({
  children,
  brand,
  context,
  actions,
  footer,
  width = 'text',
}: {
  children: ReactNode;
  brand?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  width?: 'narrow' | 'text' | 'wide';
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-4 pt-5 pb-6 sm:px-10 sm:pt-8 lg:px-[8vw]">
      <header className="flex min-h-8 min-w-0 items-center gap-3">
        {brand ?? (
          <Link to="/" className="shrink-0" aria-label="Prüfkompass">
            <Logo />
          </Link>
        )}
        {context && <span className="min-w-0 truncate border-l border-line-strong pl-3 text-meta text-ink-3">{context}</span>}
        {actions && <div className="no-print ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <main className={clsx('animate-in w-full flex-1 py-8 sm:py-12', width === 'narrow' ? 'sm:max-w-[400px]' : width === 'text' ? 'max-w-2xl' : 'max-w-3xl')}>{children}</main>
      <footer className="no-print flex flex-wrap items-center gap-x-1 gap-y-1 px-1 text-caption text-ink-3">
        {footer ?? (
          <>
            <Link to="/rechtliches/privacy" className="hover:text-ink">
              Datenschutz
            </Link>
            <span aria-hidden>·</span>
            <Link to="/rechtliches/terms" className="hover:text-ink">
              Nutzungsbedingungen
            </Link>
          </>
        )}
      </footer>
    </div>
  );
}

/** Kopf einer Seite innerhalb einer Surface: kleine Zeile darüber, großer Titel, Meta-Zeile. */
export function SurfaceHead({ eyebrow, title, meta, actions, className }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-4 px-(--row-px) pt-6 pb-6 sm:flex-row sm:items-start sm:justify-between sm:pt-8', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-meta text-ink-3">{eyebrow}</p>}
        <h1 className="text-h1 font-semibold tracking-[-0.02em] break-words">{title}</h1>
        {meta && <div className="mt-1.5 text-body text-ink-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
