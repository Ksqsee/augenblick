import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LEGAL_DOCS } from '../../shared/legal';
import { api, queryClient } from '../api';
import { PublicPage, SurfaceHead } from './admin';
import { Button, ErrorBox, Segmented, Surface } from './ui';

/** Muss bestätigt werden, bevor die App genutzt werden kann (nach jeder neuen Textversion). */
export function LegalGate({ pending }: { pending: string[] }) {
  const docs = LEGAL_DOCS.filter((d) => pending.includes(d.key));
  const [open, setOpen] = useState(docs[0]?.key ?? '');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const doc = docs.find((d) => d.key === open);
  return (
    <div className="animate-fade fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 sm:items-center sm:p-6">
      <div className="animate-up sm:animate-in flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl" role="dialog" aria-modal aria-label="Rechtstexte bestätigen">
        <div className="flex flex-col gap-3 border-b border-line px-5 pt-5 pb-4">
          <div>
            <h2 className="text-h3 font-semibold tracking-tight">Neue Fassung bestätigen</h2>
            <p className="mt-0.5 text-meta text-ink-3">Damit du Prüfkompass weiter nutzen kannst, brauchen wir deine Zustimmung.</p>
          </div>
          {docs.length > 1 && <Segmented value={open} onChange={setOpen} options={docs.map((d) => ({ value: d.key, label: d.title }))} />}
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
          {doc && (
            <>
              <p className="mb-3 text-meta font-medium text-ink-3">
                {doc.title} · Version {doc.version}
              </p>
              <div className="text-body leading-relaxed whitespace-pre-line text-ink-2">{doc.body}</div>
            </>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!!error && <ErrorBox error={error} />}
          <label className="flex cursor-pointer items-start gap-3 text-body">
            <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 rounded accent-ink" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>Ich habe {docs.map((d) => d.title).join(', ')} gelesen und stimme zu.</span>
          </label>
          <Button
            size="lg"
            className="w-full sm:h-10 sm:w-auto sm:self-end sm:text-body"
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
    <PublicPage>
      <nav aria-label="Rechtstexte" className="no-scrollbar mb-6 flex gap-5 overflow-x-auto border-b border-line">
        {LEGAL_DOCS.map((x) => (
          <Link
            key={x.key}
            to={`/rechtliches/${x.key}`}
            aria-current={x.key === d.key ? 'page' : undefined}
            className={`relative flex h-11 shrink-0 items-center text-body font-medium whitespace-nowrap ${x.key === d.key ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
          >
            {x.title}
            {x.key === d.key && <span className="absolute inset-x-0 -bottom-px h-[1.5px] bg-ink" />}
          </Link>
        ))}
      </nav>
      <Surface as="article">
        <SurfaceHead title={d.title} meta={<span className="text-meta text-ink-3">Version {d.version}</span>} className="pb-2 sm:pb-2" />
        <div className="px-(--row-px) pt-2 pb-8 text-body leading-relaxed whitespace-pre-line text-ink-2">{d.body}</div>
      </Surface>
    </PublicPage>
  );
}
