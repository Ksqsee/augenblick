import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LEGAL_DOCS } from '../../shared/legal';
import { api, queryClient } from '../api';
import { Logo } from './Logo';
import { Button, ErrorBox } from './ui';

/** Muss bestätigt werden, bevor die App genutzt werden kann (nach jeder neuen Textversion). */
export function LegalGate({ pending }: { pending: string[] }) {
  const docs = LEGAL_DOCS.filter((d) => pending.includes(d.key));
  const [open, setOpen] = useState(docs[0]?.key);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="animate-in flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl" role="dialog" aria-modal aria-label="Rechtstexte bestätigen">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">Bitte bestätigen</h2>
          <p className="mt-0.5 text-sm text-ink-3">Für die Nutzung brauchen wir deine Zustimmung zu den aktuellen Texten.</p>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-line px-5 py-2">
          {docs.map((d) => (
            <button
              key={d.key}
              onClick={() => setOpen(d.key)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium ${open === d.key ? 'bg-ink text-white' : 'text-ink-2 hover:bg-sunken'}`}
            >
              {d.title}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed whitespace-pre-line text-ink-2">
          {docs.find((d) => d.key === open)?.body}
          <p className="mt-4 text-xs text-ink-3">Version {docs.find((d) => d.key === open)?.version}</p>
        </div>
        <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
          {!!error && <ErrorBox error={error} />}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>Ich habe {docs.map((d) => d.title).join(', ')} gelesen und stimme zu.</span>
          </label>
          <Button
            disabled={!checked}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('/account/legal/accept', { body: { docs: docs.map((d) => d.key) } });
                await queryClient.invalidateQueries({ queryKey: ['me'] });
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Zustimmen und fortfahren
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Öffentliche Ansicht der Rechtstexte. */
export function LegalPage() {
  const { doc } = useParams();
  const d = LEGAL_DOCS.find((x) => x.key === doc) ?? LEGAL_DOCS[0];
  return (
    <div className="min-h-dvh bg-canvas px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <Link to="/">
          <Logo />
        </Link>
        <nav className="mt-6 flex flex-wrap gap-2">
          {LEGAL_DOCS.map((x) => (
            <Link key={x.key} to={`/rechtliches/${x.key}`} className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${x.key === d.key ? 'bg-ink text-white' : 'bg-surface text-ink-2'}`}>
              {x.title}
            </Link>
          ))}
        </nav>
        <article className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-card">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FileText className="size-5 text-ink-3" /> {d.title}
          </h1>
          <p className="mt-1 text-xs text-ink-3">Version {d.version}</p>
          <div className="mt-5 text-sm leading-relaxed whitespace-pre-line text-ink-2">{d.body}</div>
        </article>
      </div>
    </div>
  );
}
