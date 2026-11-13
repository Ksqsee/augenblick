// Prüfkompass UI-Bausteine (Design v3). Spezifikation und Regeln: docs/design.md
// Grundsatz: Beton-Grund, eine weiße Fläche (Surface > Section), Tinte als Akzent, Zinnober nur für überfällig/kritisch.
import clsx from 'clsx';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Loader2, MoreHorizontal, RotateCw, Search as SearchIcon, X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import type { DueState, Result } from '../../shared/logic';
import { DUE_META, RESULT_META, type Tone } from '../format';
import { FieldMic } from './Dictate';

// =====================================================================
// Aktionen
// =====================================================================

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/85',
  brand: 'bg-ink text-white hover:bg-ink/85',
  secondary: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-hover',
  outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'bg-shu text-white hover:bg-shu/90',
};
type Size = 'xs' | 'sm' | 'md' | 'lg';
const sizes: Record<Size, string> = {
  xs: 'h-7 rounded-md px-2 text-caption gap-1 [&_svg]:size-3.5',
  sm: 'h-9 rounded-md px-3 text-meta gap-1.5 sm:h-8 [&_svg]:size-4',
  md: 'h-11 rounded-md px-4 text-body gap-2 sm:h-9 sm:px-3.5 [&_svg]:size-4',
  lg: 'h-12 rounded-md px-5 text-title gap-2 sm:h-11 [&_svg]:size-[18px]',
};
const buttonBase =
  'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 select-none active:opacity-85 disabled:pointer-events-none disabled:opacity-50';

/** Klassen eines Knopfs – für Links, die wie ein Knopf aussehen (siehe ButtonLink). */
export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', className?: string) => clsx(buttonBase, sizes[size], variants[variant], className);

/** Knopf. primary = Tinte (Standard, genau einer je Seitenkopf), brand = Alias von primary, secondary/outline/ghost, danger. */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={buttonClass(variant, size, className)}
        {...rest}
      >
        {loading ? <Loader2 className="animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

/** Link im Aussehen eines Knopfs (Navigation statt Aktion, z. B. „Rundgang starten“). */
export function ButtonLink({ to, variant = 'primary', size = 'md', icon, className, children, ...rest }: { to: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/** Knopf nur mit Symbol – label ist Pflicht (aria-label + Tooltip). */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode; variant?: 'ghost' | 'secondary' | 'primary'; size?: 'sm' | 'md' }
>(function IconButton({ label, icon, variant = 'ghost', size = 'md', className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-md transition-colors active:opacity-85 disabled:opacity-50',
        size === 'md' ? 'size-10 sm:size-9 [&_svg]:size-[18px]' : 'size-8 [&_svg]:size-4',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-hover',
        variant === 'primary' && 'bg-ink text-white hover:bg-ink/85',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface px-1.5 font-sans text-[11px] font-medium text-ink-3">{children}</kbd>;
}

// =====================================================================
// Formularfelder
// =====================================================================

const fieldCls =
  'w-full rounded-md border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-4 transition-[border-color,box-shadow] hover:border-line-strong focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink disabled:bg-sunken disabled:text-ink-3 aria-[invalid=true]:border-shu sm:text-body';

/** Beschriftetes Feld. children bekommt die id für das Eingabeelement. */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-meta font-medium text-ink">
        {label}
        {optional && <span className="text-caption font-normal text-ink-3">optional</span>}
      </label>
      {children(id)}
      {error ? (
        <p className="flex items-center gap-1 text-caption text-bad">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(fieldCls, 'h-11 sm:h-10', className)} {...p} />;
});

function useMergedRef<T>(outer: React.ForwardedRef<T>) {
  const inner = useRef<T | null>(null);
  const set = useCallback(
    (el: T | null) => {
      inner.current = el;
      if (typeof outer === 'function') outer(el);
      else if (outer) outer.current = el;
    },
    [outer],
  );
  return [inner, set] as const;
}

/** Mehrzeiliges Feld – mit Diktat-Knopf (abschaltbar mit dictate={false}). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { dictate?: boolean }>(function Textarea(
  { className, dictate = true, ...p },
  ref,
) {
  const [inner, set] = useMergedRef(ref);
  if (!dictate || p.readOnly) return <textarea ref={set} className={clsx(fieldCls, 'min-h-24 py-2.5 leading-relaxed', className)} {...p} />;
  return (
    <div className="relative w-full">
      <textarea ref={set} className={clsx(fieldCls, 'min-h-24 py-2.5 pb-11 leading-relaxed', className)} {...p} />
      <FieldMic target={inner} className="absolute right-2 bottom-2" />
    </div>
  );
});

/** Einzeiliges Feld mit Diktat-Knopf (für Titel o. Ä.). */
export const DictateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function DictateInput({ className, ...p }, ref) {
  const [inner, set] = useMergedRef(ref);
  return (
    <div className="relative w-full">
      <input ref={set} className={clsx(fieldCls, 'h-11 pr-12 sm:h-10', className)} {...p} />
      <FieldMic target={inner} className="absolute top-1/2 right-1.5 -translate-y-1/2" />
    </div>
  );
});

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        fieldCls,
        'h-11 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%236e6e6a%27 stroke-width=%271.75%27%3E%3Cpath d=%27m4 6 4 4 4-4%27/%3E%3C/svg%3E")] bg-[right_10px_center] bg-no-repeat pr-9 sm:h-10',
        className,
      )}
      {...p}
    >
      {children}
    </select>
  );
}

/** Suchfeld mit Lupe und Leeren-Knopf (für Listen-Toolbars). */
export function SearchField({
  value,
  onChange,
  placeholder = 'Suchen …',
  className,
  autoFocus,
  label = 'Suchen',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  return (
    <div className={clsx('relative w-full sm:max-w-xs', className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(fieldCls, 'h-11 pr-9 pl-9 sm:h-9 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value && (
        <button type="button" aria-label="Suche leeren" onClick={() => onChange('')} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:bg-sunken hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Schalter für Ein/Aus-Einstellungen (sofort wirksam, kein Speichern-Knopf nötig). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const btn = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50',
        checked ? 'bg-ink' : 'bg-line-strong',
      )}
    >
      <span className={clsx('size-5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-150', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
  if (!label) return btn;
  return (
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-body font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-meta text-ink-3">{description}</span>}
      </label>
      {btn}
    </div>
  );
}

// =====================================================================
// Flächen
// =====================================================================

/** Kasten mit Haarlinie (Radius 10, kein Schatten). Für neue Seiten lieber Surface > Section. */
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-xl bg-surface shadow-card', className)} {...p}>
      {children}
    </div>
  );
}

/**
 * Die eine weiße Fläche einer Seite (auf dem Beton-Grund). Auf dem Handy randlos über die volle Breite.
 * Inhalt: Section-Blöcke, getrennt durch Haarlinien. Seitenspalten liegen daneben auf dem Grund, nicht in einer Karte.
 */
export function Surface({
  className,
  children,
  as: Tag = 'div',
  bleed = true,
  ...p
}: React.HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' | 'main'; bleed?: boolean }) {
  return (
    <Tag
      className={clsx(
        'min-w-0 bg-surface [--row-px:1rem] sm:[--row-px:1.5rem]',
        bleed ? 'max-sm:-mx-4 max-sm:border-y max-sm:border-line sm:rounded-xl sm:shadow-card' : 'rounded-xl shadow-card',
        className,
      )}
      {...p}
    >
      {children}
    </Tag>
  );
}

/**
 * Abschnitt innerhalb einer Surface: kleiner grauer Titel (h2, 13 px) + Inhalt, Haarlinie darüber.
 * flush: Inhalt (z. B. List plain) reicht bis an die Ränder der Fläche, Zeilen bleiben bündig mit dem Titel.
 */
export function Section({
  title,
  count,
  action,
  children,
  flush,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  title?: ReactNode;
  count?: number;
  action?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <section id={id} aria-label={ariaLabel} className={clsx('border-t border-line px-(--row-px) py-5 first:border-t-0 sm:py-6', flush && 'pb-2 sm:pb-3', className)}>
      {(title || action) && (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
          {title && (
            <h2 className="flex items-baseline gap-2 text-meta font-medium text-ink-3">
              {title}
              {count != null && <span className="font-normal tabular-nums">{count}</span>}
            </h2>
          )}
          {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {flush ? <div className="-mx-(--row-px)">{children}</div> : children}
    </section>
  );
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-title font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-meta text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Abschnittskopf über Karten/Listen: Titel (h2), Zähler, rechts Meta oder Aktion. */
export function SectionHeader({ title, count, meta, action, className }: { title: ReactNode; count?: number; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-2 flex min-h-7 items-center justify-between gap-3', className)}>
      <h2 className="flex items-baseline gap-2 text-meta font-medium text-ink-3">
        {title}
        {count != null && <span className="font-normal tabular-nums">{count}</span>}
      </h2>
      {action ?? (meta && <span className="truncate text-meta text-ink-3">{meta}</span>)}
    </div>
  );
}

/** Kleiner Textlink „Alle“ für SectionHeader.action */
export function SectionLink({ to, children = 'Alle anzeigen' }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-0.5 text-meta font-medium text-ink-2 hover:text-ink">
      {children}
      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// =====================================================================
// Status
// =====================================================================

// v3: Status ist ein Punkt in Tonfarbe + Wort. Getönte Flächen gibt es nur für Zinnober (bad).
const tones: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-shu-soft text-shu',
  info: 'bg-info-soft text-info',
  muted: 'bg-sunken text-ink-2',
  brand: 'bg-sunken text-ink',
};
export const toneDot: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-shu',
  info: 'bg-info',
  muted: 'bg-ink-4',
  brand: 'bg-ink',
};
export const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-shu',
  info: 'text-info',
  muted: 'text-ink-3',
  brand: 'text-ink',
};
export const toneSoft = tones;
/** Statuswort im Fließtext: neutral, nur Zinnober färbt das Wort selbst. */
const toneWord = (tone: Tone) => (tone === 'bad' ? 'text-shu' : 'text-ink-2');

/**
 * Marke (Pille) – nur im Seitenkopf und in Tabellenspalten „Status“. Standard neutral grau mit Punkt in Tonfarbe;
 * nur tone="bad" ist getönt (Zinnober). variant="solid" nur für „Kritisch“. In Listen statt Badge: StatusText.
 */
export function Badge({
  tone = 'muted',
  children,
  dot,
  icon,
  variant = 'soft',
  size = 'md',
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  variant?: 'soft' | 'outline' | 'solid';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const bad = tone === 'bad';
  const showDot = dot ?? (!icon && tone !== 'muted' && tone !== 'brand' && variant !== 'solid');
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap [&_svg]:size-3',
        size === 'md' ? 'h-[22px] px-2 text-caption' : 'h-[18px] px-1.5 text-[11px]',
        variant === 'soft' && (bad ? 'bg-shu-soft text-shu' : 'bg-sunken text-ink-2'),
        variant === 'outline' && ['border bg-surface', bad ? 'border-shu-line text-shu' : 'border-line text-ink-2'],
        variant === 'solid' && (bad ? 'bg-shu text-white' : 'bg-ink text-white'),
        className,
      )}
    >
      {showDot && <span className={clsx('size-1.5 shrink-0 rounded-full', variant === 'solid' ? 'bg-white/80' : toneDot[tone])} />}
      {icon}
      {children}
    </span>
  );
}

/** Punkt für Status (6 px). pulse für „läuft gerade“. */
export function StatusDot({ tone = 'muted', pulse, className, label }: { tone?: Tone; pulse?: boolean; className?: string; label?: string }) {
  return (
    <span className={clsx('relative inline-flex size-1.5 shrink-0', className)} role={label ? 'img' : undefined} aria-label={label}>
      {pulse && <span className={clsx('absolute inset-0 animate-ping rounded-full opacity-60', toneDot[tone])} />}
      <span className={clsx('relative size-1.5 rounded-full', toneDot[tone])} />
    </span>
  );
}

/** Status in Listen und Fließtext: Punkt + Wort (Standard in v3). Wort neutral, nur „bad“ in Zinnober. */
export function StatusText({ tone = 'muted', children, strong, className }: { tone?: Tone; children: ReactNode; strong?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-1.5 text-meta whitespace-nowrap', toneWord(tone), strong && 'font-medium', className)}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

type BadgeVariant = 'text' | 'pill';

/** Prüfstatus eines Elements (Überfällig, Bald fällig, Nie geprüft, Aktuell). variant="pill" nur in Kopf/Tabellenspalte. */
export function DueBadge({ state, className, variant = 'text' }: { state: DueState; className?: string; variant?: BadgeVariant }) {
  const m = DUE_META[state];
  if (variant === 'text')
    return (
      <StatusText tone={m.tone} className={className}>
        {m.label}
      </StatusText>
    );
  return (
    <Badge tone={m.tone} dot className={className}>
      {m.label}
    </Badge>
  );
}

/** Prüfergebnis (Ohne Mängel, Mit Mängeln, Kritisch, Nicht prüfbar). */
export function ResultBadge({ result, className, variant = 'text' }: { result: Result; className?: string; variant?: BadgeVariant }) {
  const m = RESULT_META[result];
  if (variant === 'text')
    return (
      <StatusText tone={m.tone} strong={result === 'critical'} className={className}>
        {m.label}
      </StatusText>
    );
  return (
    <Badge tone={m.tone} variant={result === 'critical' ? 'solid' : 'soft'} className={className}>
      {m.label}
    </Badge>
  );
}

export const SEVERITY_TONE: Record<Severity, Tone> = { low: 'muted', medium: 'warn', high: 'bad', critical: 'bad' };

function SeverityBars({ severity }: { severity: Severity }) {
  const level = { low: 1, medium: 2, high: 3, critical: 3 }[severity];
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="!size-3 shrink-0">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.5" height={3 + i * 3} rx="0.5" fill="currentColor" opacity={i < level ? 1 : 0.25} />
      ))}
    </svg>
  );
}

/** Schweregrad eines Mangels: Balken-Symbol + Wort; hoch/kritisch in Zinnober. variant="pill" für Kopf/Tabellenspalte. */
export function SeverityBadge({ severity, className, variant = 'text' }: { severity: Severity; className?: string; variant?: BadgeVariant }) {
  const critical = severity === 'critical';
  if (variant === 'text')
    return (
      <span className={clsx('inline-flex items-center gap-1.5 text-meta whitespace-nowrap', toneWord(SEVERITY_TONE[severity]), critical && 'font-medium', className)}>
        <SeverityBars severity={severity} />
        {SEVERITIES[severity]}
      </span>
    );
  return (
    <Badge tone={SEVERITY_TONE[severity]} variant={critical ? 'solid' : 'soft'} icon={<SeverityBars severity={severity} />} className={className}>
      {SEVERITIES[severity]}
    </Badge>
  );
}

// =====================================================================
// Seitenkopf, Navigation innerhalb von Seiten
// =====================================================================

export type Crumb = { label: ReactNode; to?: string };

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Pfad" className={clsx('flex min-w-0 items-center gap-1 text-meta text-ink-3', className)}>
      {items.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-4" />}
          {c.to ? (
            <Link to={c.to} className="truncate hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className="truncate text-ink-2">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Zurück-Link oberhalb des Titels (Detailseiten auf dem Handy). */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="-ml-1 mb-2 inline-flex h-8 items-center gap-1 rounded-md px-1 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-4" />
      {children}
    </Link>
  );
}

/**
 * Seitenkopf. Titel (h1) + Untertitel links, Aktionen rechts (auf dem Handy darunter).
 * back: beliebiges Element über dem Titel (alt); besser breadcrumbs oder backTo.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  backTo,
  breadcrumbs,
  eyebrow,
  meta,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  backTo?: { to: string; label: string };
  breadcrumbs?: Crumb[];
  eyebrow?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mb-6 flex flex-col gap-4 lg:mb-8 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {back}
        {backTo && <BackLink to={backTo.to}>{backTo.label}</BackLink>}
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-2" />}
        {eyebrow && <p className="mb-1 text-meta text-ink-3">{eyebrow}</p>}
        <h1 className="truncate text-h1 font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-ink-2">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-ink-3">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Reiter mit Unterstrich (Seitenbereiche). Für Filter innerhalb einer Liste: Segmented. */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; count?: number; tone?: Tone }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx('no-scrollbar -mx-4 flex gap-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={clsx(
              'relative flex h-11 shrink-0 items-center gap-1.5 text-body font-medium whitespace-nowrap transition-colors sm:h-10',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={clsx('text-meta font-normal tabular-nums', t.tone === 'bad' && t.count > 0 ? 'text-shu' : 'text-ink-3')}>{t.count}</span>
            )}
            {active && <span className="absolute inset-x-0 -bottom-px h-[1.5px] bg-ink" />}
          </button>
        );
      })}
    </div>
  );
}

/** Reiter-Zustand in der URL (?tab=…), damit Zurück/Teilen funktioniert. */
export function useUrlTab<T extends string>(param: string, fallback: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param) as T | null;
  const value = raw && (!allowed || allowed.includes(raw)) ? raw : fallback;
  const set = useCallback(
    (v: T) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (v === fallback) n.delete(param);
          else n.set(param, v);
          return n;
        },
        { replace: true },
      ),
    [param, fallback, setParams],
  );
  return [value, set];
}

// ---------- Segmentierte Auswahl ----------
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div className={clsx('no-scrollbar inline-flex max-w-full overflow-x-auto rounded-md bg-sunken p-0.5', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-meta font-medium whitespace-nowrap transition-colors sm:h-7',
            value === o.value ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
          {o.count != null && <span className="font-normal text-ink-3 tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Filter-Chip (an/aus). count optional. */
export function Chip({ active, onClick, children, count, icon }: { active?: boolean; onClick?: () => void; children: ReactNode; count?: number; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-meta font-medium whitespace-nowrap transition-colors sm:h-8 [&_svg]:size-3.5',
        active ? 'border-line-strong bg-selected text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {icon}
      {children}
      {count != null && <span className="font-normal text-ink-3 tabular-nums">{count}</span>}
    </button>
  );
}

/**
 * Werkzeugleiste über Listen: Suche links, Filter-Chips (horizontal scrollbar auf dem Handy), rechts Ansicht/Export.
 */
export function FilterBar({
  search,
  children,
  trailing,
  className,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  children?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mb-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      {search && <SearchField {...search} />}
      {children && <div className="no-scrollbar -mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">{children}</div>}
      {trailing && <div className="flex items-center gap-2 sm:ml-auto">{trailing}</div>}
    </div>
  );
}

export const Toolbar = FilterBar;

// =====================================================================
// Listen und Tabellen
// =====================================================================

/**
 * Zeilen (ListRow) mit eingerückten Haarlinien. Standard: im Kasten mit Haarlinie (alt).
 * plain: ohne Kasten – innerhalb einer Section (flush) oder einer Seitenspalte auf dem Grund.
 */
export function List({ children, header, className, plain, 'aria-label': ariaLabel }: { children: ReactNode; header?: ReactNode; className?: string; plain?: boolean; 'aria-label'?: string }) {
  const ul = (
    <ul className={clsx('pk-list', plain && className)} aria-label={ariaLabel}>
      {children}
    </ul>
  );
  if (plain) return ul;
  return (
    <Card className={clsx('overflow-hidden', className)}>
      {header && <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-meta text-ink-3">{header}</div>}
      {ul}
    </Card>
  );
}

/** Gruppenkopf innerhalb einer List (wie „Überfällig 4“): 13 px grau, kein Balken, Zähler als Zahl. */
export function ListGroup({ title, count, tone, action }: { title: ReactNode; count?: number; tone?: Tone; action?: ReactNode }) {
  return (
    <li className="flex h-9 items-end gap-2 px-(--row-px,1rem) pb-1.5 text-meta font-medium text-ink-3">
      {tone && <StatusDot tone={tone} className="mb-1.5" />}
      {title}
      {count != null && <span className="font-normal tabular-nums">{count}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </li>
  );
}

/**
 * Dichte Listenzeile: leading (Icon/Avatar) · Titel + Untertitel · meta (rechts, ab sm) · trailing (Badge/Aktion).
 * to → Link, onClick → Knopf. selectable → Auswahlkästchen davor (Massenaktionen).
 */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  to,
  onClick,
  selected,
  selectable,
  onSelect,
  chevron,
  tone,
  className,
  'aria-label': ariaLabel,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: (v: boolean) => void;
  chevron?: boolean;
  tone?: Tone;
  className?: string;
  'aria-label'?: string;
}) {
  const inner = (
    <>
      {leading && <span className="flex min-w-4 shrink-0 items-center justify-center text-ink-3 [&>svg]:size-4">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">{title}</span>
        {subtitle && <span className={clsx('mt-0.5 block truncate text-meta', tone ? toneText[tone] : 'text-ink-3')}>{subtitle}</span>}
      </span>
      {meta && <span className="hidden shrink-0 text-right text-meta text-ink-3 tabular-nums sm:block">{meta}</span>}
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-3" />}
    </>
  );
  const body = 'group flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-(--row-px,1rem) py-2 text-left sm:min-h-11';
  // Haarlinie beginnt am Textanfang: nach Auswahlkästchen und 16-px-Symbol eingerückt
  const inset = (selectable ? 28 : 0) + (leading ? 28 : 0);
  return (
    <li
      style={inset ? ({ '--row-inset': `${inset}px` } as React.CSSProperties) : undefined}
      className={clsx('flex items-center transition-colors', (to || onClick) && 'hover:bg-hover', selected && 'bg-selected', className)}
    >
      {selectable && (
        <label className="flex h-full cursor-pointer items-center self-stretch pl-(--row-px,1rem)" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!selected} onChange={(e) => onSelect?.(e.target.checked)} className="size-4 rounded accent-ink" aria-label="Auswählen" />
        </label>
      )}
      {to ? (
        <Link to={to} className={body} aria-label={ariaLabel}>
          {inner}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={body} aria-label={ariaLabel}>
          {inner}
        </button>
      ) : (
        <div className={body}>{inner}</div>
      )}
    </li>
  );
}

/** Symbol als leading einer ListRow – v3: 16 px, einfarbig, ohne Kachel. tone färbt nur „bad“. */
export function RowIcon({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={clsx('grid size-4 shrink-0 place-items-center [&_svg]:size-4', tone === 'bad' ? 'text-shu' : 'text-ink-3', className)}>{children}</span>;
}

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Darstellung auf dem Handy: primary = Titelzeile, secondary = Unterzeile, trailing = rechts, hidden = weglassen */
  mobile?: 'primary' | 'secondary' | 'trailing' | 'hidden';
};

/**
 * Einfache Tabelle (ab md). Auf dem Handy werden Zeilen gestapelt: primary/secondary/trailing.
 * Standard: erste Spalte primary, letzte trailing, übrige secondary.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowTo,
  onRowClick,
  empty,
  loading,
  className,
  selected,
  onSelect,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowTo?: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  loading?: boolean;
  className?: string;
  selected?: Set<string>;
  onSelect?: (key: string, v: boolean) => void;
}) {
  if (loading) return <SkeletonList rows={6} />;
  if (!rows.length && empty) return <Card>{empty}</Card>;
  const role = (c: Column<T>, i: number) => c.mobile ?? (i === 0 ? 'primary' : i === columns.length - 1 ? 'trailing' : 'secondary');
  const clickable = !!(rowTo || onRowClick);
  return (
    <Card className={clsx('overflow-hidden', className)}>
      <table className="hidden w-full border-collapse text-body md:table">
        <thead>
          <tr className="border-b border-line text-left">
            {onSelect && <th className="w-10 pl-4" />}
            {columns.map((c) => (
              <th key={c.key} className={clsx('h-9 px-4 text-caption font-normal text-ink-3', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={clsx('relative transition-colors', clickable && 'cursor-pointer hover:bg-hover', selected?.has(k) && 'bg-selected')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {onSelect && (
                  <td className="relative z-10 w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="size-4 accent-ink" aria-label="Auswählen" checked={!!selected?.has(k)} onChange={(e) => onSelect(k, e.target.checked)} />
                  </td>
                )}
                {columns.map((c, i) => (
                  <td key={c.key} className={clsx('h-11 px-4 py-2', c.align === 'right' && 'text-right tabular-nums', i === 0 ? 'text-ink' : 'text-ink-2', c.className)}>
                    {i === 0 && rowTo ? (
                      <Link to={rowTo(r)} className="after:absolute after:inset-0">
                        {c.cell(r)}
                      </Link>
                    ) : (
                      c.cell(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="pk-list md:hidden">
        {rows.map((r) => {
          const k = rowKey(r);
          const pick = (m: string) => columns.filter((c, i) => role(c, i) === m);
          const secondary = pick('secondary');
          return (
            <ListRow
              key={k}
              to={rowTo?.(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              selectable={!!onSelect}
              selected={selected?.has(k)}
              onSelect={(v) => onSelect?.(k, v)}
              title={pick('primary').map((c) => (
                <span key={c.key}>{c.cell(r)}</span>
              ))}
              subtitle={
                secondary.length ? (
                  <span className="flex min-w-0 flex-wrap gap-x-2">
                    {secondary.map((c) => (
                      <span key={c.key} className="truncate">
                        {c.cell(r)}
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
              trailing={pick('trailing').map((c) => (
                <span key={c.key}>{c.cell(r)}</span>
              ))}
            />
          );
        })}
      </ul>
    </Card>
  );
}

/** Eigenschaften „Bezeichnung → Wert“ (Seitenpanel einer Detailseite). */
export function PropertyList({ items, className }: { items: { label: string; value: ReactNode; icon?: ReactNode }[]; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-4 gap-y-3 text-body', className)}>
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="flex items-center gap-2 text-ink-3 [&_svg]:size-4">
            {it.icon}
            {it.label}
          </dt>
          <dd className="min-w-0 font-medium break-words text-ink">{it.value === null || it.value === undefined || it.value === '' ? <span className="font-normal text-ink-4">–</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Zweispaltige Wertetabelle (alt, weiter gültig). Für Seitenpanels lieber PropertyList. */
export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-body">
          <dt className="text-ink-3">{k}</dt>
          <dd className="text-right font-medium break-words">{v || '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = { id: string; icon?: ReactNode; tone?: Tone; title: ReactNode; body?: ReactNode; time?: ReactNode; meta?: ReactNode };

/** Verlauf / Aktivität: Symbol in Kreis, senkrechte Linie, Titel + Zeit, optional Text. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={clsx('relative', className)}>
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-7 bottom-0 left-[13px] w-px bg-line" aria-hidden />}
          <span
            className={clsx(
              'relative z-[1] grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface ring-4 ring-surface [&_svg]:size-3.5',
              it.tone === 'bad' ? 'text-shu' : 'text-ink-3',
            )}
          >
            {it.icon ?? <span className={clsx('size-1.5 rounded-full', it.tone ? toneDot[it.tone] : 'bg-ink-3')} />}
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-body text-ink">{it.title}</p>
              {it.time && <span className="text-caption text-ink-3 tabular-nums">{it.time}</span>}
            </div>
            {it.meta && <p className="mt-0.5 text-meta text-ink-3">{it.meta}</p>}
            {it.body && <div className="mt-2 border-l-2 border-line pl-3 text-body text-ink-2">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Kennzahl ohne Kasten: Zahl 28 px, darunter Bezeichnung 13 px mit Statuspunkt, optional Hinweis.
 * Mehrere nebeneinander trennt eine senkrechte Haarlinie (divider, Standard). to → Link.
 */
export function StatTile({
  label,
  value,
  tone,
  to,
  hint,
  divider = true,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  to?: string;
  hint?: ReactNode;
  divider?: boolean;
  className?: string;
}) {
  const zero = value === 0;
  const body = (
    <>
      <span className={clsx('text-[28px] leading-[34px] font-semibold tracking-[-0.02em] tabular-nums', zero ? 'text-ink-4' : 'text-ink')}>{value}</span>
      <span className="flex items-center gap-1.5 text-meta text-ink-2">
        {tone && <StatusDot tone={tone} />}
        {label}
      </span>
      {hint && <span className="text-caption text-ink-3">{hint}</span>}
    </>
  );
  const cls = clsx('group flex min-w-0 flex-col gap-0.5', divider && 'border-l border-line pl-4', to && '[&>span:first-child]:transition-colors hover:[&>span:first-child]:text-ink-2', className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Personen-Kürzel (keine Fotos nötig). Farbe stabil aus dem Namen. */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join('') || '?';
  const palette = ['bg-sunken text-ink-2', 'bg-ok-soft text-ok', 'bg-info-soft text-info', 'bg-warn-soft text-warn', 'bg-selected text-ink'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      title={name}
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold select-none',
        { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-caption', lg: 'size-10 text-body' }[size],
        palette[h % palette.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

// =====================================================================
// Zustände: leer, laden, Fehler, Hinweis
// =====================================================================

/**
 * Leerzustand: ein Satz (title), optional eine Erklärung, eine Aktion – am besten ein Textlink.
 * v3: kein Symbolkreis; icon wird aus Kompatibilität angenommen, aber nicht gezeigt.
 */
export function Empty({ title, text, action, compact, className }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center', compact ? 'px-5 py-8' : 'px-6 py-14', className)}>
      <p className="text-body font-medium text-ink">{title}</p>
      {text && <p className="mt-1 max-w-sm text-body text-ink-2">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx('flex justify-center py-16 text-ink-3', className)} role="status" aria-label="Lädt">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

/** Grauer Platzhalter-Block während des Ladens. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx('skeleton block rounded-md', className ?? 'h-4 w-full')} />;
}

/** Platzhalter für eine Liste (Karte mit Zeilen). */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <Card className={clsx('divide-y divide-line overflow-hidden', className)} aria-busy role="status" aria-label="Lädt">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[52px] items-center gap-3 px-4 sm:h-11">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={clsx('h-3.5', ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5'][i % 4])} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </Card>
  );
}

/** Platzhalter für eine ganze Seite: Kopf, Kennzahlen, Liste. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Lädt">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <SkeletonList rows={5} />
    </div>
  );
}

export function ErrorBox({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={clsx('flex items-start gap-3 rounded-md border border-shu-line bg-shu-soft px-4 py-3 text-body text-shu', className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">{error instanceof Error ? error.message : 'Fehler'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-4 hover:underline">
          <RotateCw className="size-3.5" /> Erneut versuchen
        </button>
      )}
    </div>
  );
}

/** Hinweisbox im Seiteninhalt (nicht für Fehler aus Anfragen – dafür ErrorBox). */
export function Notice({ tone = 'info', title, children, action, icon, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-start gap-3 rounded-md px-4 py-3 text-body', tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

// =====================================================================
// Einstellungen
// =====================================================================

/** Einstellungs-Abschnitt: links Titel + Erklärung, rechts die Felder (Handy: untereinander). */
export function SettingsSection({ title, description, children, footer, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={clsx('grid gap-4 border-b border-line py-8 first:pt-0 last:border-0 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-10', className)}>
      <div>
        <h2 className="text-title font-semibold">{title}</h2>
        {description && <p className="mt-1 text-meta text-ink-3">{description}</p>}
      </div>
      <div className="min-w-0">
        <Card className="flex flex-col gap-4 p-4 sm:p-5">{children}</Card>
        {footer && <div className="mt-3 flex justify-end gap-2">{footer}</div>}
      </div>
    </section>
  );
}

// =====================================================================
// Overlays
// =====================================================================

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

const modalWidth = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

/** Dialog. Auf dem Handy Bottom-Sheet mit Griff, ab sm zentriert. Fußknöpfe auf dem Handy volle Breite. */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
  size,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: keyof typeof modalWidth;
}) {
  useEscape(onClose);
  const titleId = useId();
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          'animate-up sm:animate-in flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop sm:rounded-2xl sm:pb-0',
          modalWidth[size ?? (wide ? 'lg' : 'md')],
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-start justify-between gap-4 px-5 pt-3 pb-1 sm:pt-5">
          <div className="min-w-0 flex-1 max-sm:pl-8 max-sm:text-center">
            <h2 id={titleId} className="text-h3 font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-meta text-ink-3">{description}</p>}
          </div>
          <IconButton label="Schließen" icon={<X />} size="sm" onClick={onClose} className="-mt-1 -mr-1.5" />
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex gap-2 border-t border-line px-5 py-3.5 max-sm:[&>*]:flex-1 sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

/** Alias: „Sheet“ ist auf dem Handy dasselbe wie Modal (Bottom-Sheet). */
export const Sheet = Modal;

/** Seitenpanel von rechts (Vorschau eines Datensatzes ohne Seitenwechsel). */
export function Drawer({ title, subtitle, onClose, children, footer }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="animate-fade fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={onClose}>
      <aside role="dialog" aria-modal onMouseDown={(e) => e.stopPropagation()} className="animate-slide flex h-full w-full max-w-md flex-col bg-surface shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-h3 font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-meta text-ink-3">{subtitle}</p>}
          </div>
          <IconButton label="Schließen" icon={<X />} size="sm" onClick={onClose} className="-mr-1.5" />
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex gap-2 border-t border-line bg-surface px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </aside>
    </div>
  );
}

/** Bestätigung vor folgenreichen Aktionen (Löschen, Abschließen). */
export function ConfirmDialog({
  title,
  text,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: ReactNode;
  text?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {text && <p className="text-body text-ink-2">{text}</p>}
    </Modal>
  );
}

type ConfirmOpts = { title: ReactNode; text?: ReactNode; confirmLabel?: string; danger?: boolean };
/**
 * Bestätigung als Promise: const [confirm, confirmEl] = useConfirm();
 * if (await confirm({ title: 'Löschen?', danger: true })) …; {confirmEl} im JSX rendern.
 */
export function useConfirm(): [(o: ConfirmOpts) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const el = state ? <ConfirmDialog {...state} onConfirm={() => close(true)} onClose={() => close(false)} /> : null;
  return [confirm, el];
}

export type MenuItem = { label: ReactNode; icon?: ReactNode; onClick?: () => void; to?: string; danger?: boolean; disabled?: boolean } | 'separator';

/** Aufklappmenü (⋯). Schließt bei Klick außerhalb und Escape. */
export function Menu({
  items,
  label = 'Weitere Aktionen',
  trigger,
  align = 'right',
  className,
}: {
  items: MenuItem[];
  label?: string;
  trigger?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const itemCls = (danger?: boolean) =>
    clsx(
      'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body transition-colors disabled:opacity-40 sm:h-8 [&_svg]:size-4',
      danger ? 'text-shu hover:bg-shu-soft' : 'text-ink hover:bg-hover [&_svg]:text-ink-3',
    );
  return (
    <div ref={ref} className={clsx('relative', className)}>
      {trigger ? (
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="contents">
          {trigger}
        </button>
      ) : (
        <IconButton label={label} icon={<MoreHorizontal />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      )}
      {open && (
        <div role="menu" className={clsx('animate-menu absolute top-full z-40 mt-1 min-w-48 rounded-lg bg-surface p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it, i) =>
            it === 'separator' ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : it.to ? (
              <Link key={i} role="menuitem" to={it.to} className={itemCls(it.danger)} onClick={() => setOpen(false)}>
                {it.icon}
                {it.label}
              </Link>
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                className={itemCls(it.danger)}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Toasts
// =====================================================================

export interface ToastOptions {
  /** ein Knopf in der Meldung, z. B. „Rückgängig“ */
  action?: { label: string; onClick: () => void };
  /** Anzeigedauer in ms (Standard 3,5 s, mit Aktion 5 s) */
  duration?: number;
}
type ToastMsg = { id: number; text: string; tone: 'ok' | 'bad' } & ToastOptions;
type ToastFn = (text: string, tone?: 'ok' | 'bad', opts?: ToastOptions) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

/**
 * Feste Leisten am unteren Rand, über denen Meldungen stehen: die Handy-Navigation und alles mit `data-toast-avoid`
 * (Abschlussleiste im Prüfablauf, klebende Aktionsleisten). Liefert den Abstand vom unteren Rand in px.
 */
function toastOffset(): number {
  const h = window.innerHeight;
  let top = h;
  for (const el of document.querySelectorAll<HTMLElement>('[data-toast-avoid], nav[aria-label="Hauptnavigation"]')) {
    const r = el.getBoundingClientRect();
    // nur sichtbare Leisten, die unten im Blick stehen (fest oder gerade angeklebt)
    if (!r.height || r.top >= h || r.bottom < h - 160) continue;
    top = Math.min(top, r.top);
  }
  return h - top;
}
const toastBottom = () => {
  const o = toastOffset();
  return o ? o + 12 : 24;
};

/**
 * Meldungen (v5): immer nur eine (die neueste ersetzt die vorige, nichts stapelt sich), kurz, und nie über
 * Bedienelementen – am Handy oberhalb der unteren Leiste bzw. der festen Aktionsleiste, am Desktop unten mittig.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ToastMsg | null>(null);
  const [bottom, setBottom] = useState(24);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const push = useCallback<ToastFn>((text, tone = 'ok', opts = {}) => {
    const id = Date.now() + Math.random();
    setBottom(toastBottom());
    setItem({ id, text, tone, ...opts });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setItem((t) => (t?.id === id ? null : t)), opts.duration ?? (opts.action ? 5000 : 3500));
  }, []);
  // Leisten können nach dem Seitenwechsel erscheinen oder verschwinden (z. B. nach „Abschließen“)
  useEffect(() => {
    if (!item) return;
    const upd = () => setBottom(toastBottom());
    const raf = requestAnimationFrame(upd);
    const iv = setInterval(upd, 400);
    window.addEventListener('resize', upd);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      window.removeEventListener('resize', upd);
    };
  }, [item]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
        style={{ bottom: `max(${bottom}px, calc(env(safe-area-inset-bottom) + 12px))` }}
        role="status"
        aria-live="polite"
      >
        {item && (
          <div
            key={item.id}
            data-toast=""
            className="animate-in pointer-events-auto flex max-w-md min-w-0 items-center gap-2.5 rounded-lg bg-ink py-2 pr-2 pl-3 text-body text-white shadow-pop"
          >
            <span className={clsx('grid size-4 shrink-0 place-items-center', item.tone === 'ok' ? 'text-white/70' : 'text-[#f0a093]')}>
              {item.tone === 'ok' ? <Check className="size-4" strokeWidth={2.5} /> : <X className="size-4" strokeWidth={2.5} />}
            </span>
            <span className={clsx('min-w-0 py-0.5', !item.action && 'pr-2')}>{item.text}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action!.onClick();
                  clearTimeout(timer.current);
                  setItem(null);
                }}
                className="ml-1 h-9 shrink-0 rounded-md px-2.5 text-body font-medium text-white underline-offset-4 hover:bg-white/10 hover:underline"
              >
                {item.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}
