export const APP_NAME = 'Prüfkompass';

/** Bildmarke v3: schwarzes Quadrat, dünner Kreis und Kompassnadel in Weiß – keine Signalfarbe. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className ?? 'size-6'} aria-hidden>
      <rect width="32" height="32" rx="6" fill="#111110" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="1.25" />
      <path d="M16 8.5l2.4 7.5L16 23.5l-2.4-7.5z" fill="#fff" />
      <path d="M16 16l2.4 0L16 23.5z" fill="#111110" opacity="0.35" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
    </span>
  );
}
