export const APP_NAME = 'Prüfkompass';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#1c1917" />
        <circle cx="16" cy="16" r="9" fill="none" stroke="#e2551b" strokeWidth="2.5" />
        <path d="M16 9.5l3 6.5-3 6.5-3-6.5z" fill="#e2551b" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
