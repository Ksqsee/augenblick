// Rohdiktat an der Prüfung (Plan v7 W): was eingesprochen oder getippt wurde, bleibt als Text stehen – mit der groben
// Einordnung des Regel-Parsers – bis Claude es über den Connector auswertet. Ohne Netz liegt es im Entwurf auf dem Gerät.
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { RAW_SOURCE_LABEL, type RawNote } from '../../../shared/announce';
import { fmtDateTime } from '../../format';
import { Button, Section, StatusText } from '../ui';

const KIND: Record<string, string> = { announce: 'Ansage', finding: 'Befund', type: 'Typ' };

export function RawNotesSection({ notes, onEvaluated }: { notes: RawNote[]; onEvaluated?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  if (!notes.length) return null;
  const pending = notes.filter((n) => !n.evaluated).length;
  return (
    <Section
      id="diktat"
      title="Diktat"
      count={notes.length}
      className="scroll-mt-24"
      action={<StatusText tone={pending ? 'warn' : 'ok'}>{pending ? 'noch nicht ausgewertet' : 'ausgewertet'}</StatusText>}
    >
      <ul className="flex flex-col gap-3" aria-label="Rohdiktat">
        {notes.map((n) => (
          <li key={n.id} data-raw={n.id} data-evaluated={n.evaluated ? '1' : '0'} className={clsx('border-l pl-4', n.critical ? 'border-shu' : 'border-line-strong')}>
            <p className="text-body break-words text-ink">„{n.text}“</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-meta text-ink-3">
              {n.critical && (
                <span className="inline-flex items-center gap-1 text-shu">
                  <AlertTriangle className="size-3.5" /> kritisches Wort
                </span>
              )}
              <span>{[KIND[n.kind ?? ''], fmtDateTime(n.at), RAW_SOURCE_LABEL[n.source]].filter(Boolean).join(' · ')}</span>
              {n.summary && <span className="min-w-0">· {n.summary}</span>}
              {n.evaluated && <span>· ausgewertet</span>}
            </p>
          </li>
        ))}
      </ul>
      {pending > 0 && (
        <div className="mt-3 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 text-meta text-ink-3 sm:flex-1">Claude liest das Diktat über den Connector und trägt Fehlendes nach. Schon von Hand geprüft?</p>
          {onEvaluated && (
            <Button
              size="sm"
              variant="ghost"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onEvaluated();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Als ausgewertet markieren
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
