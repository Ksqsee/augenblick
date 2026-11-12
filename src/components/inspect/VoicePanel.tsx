// „Befund einsprechen“ im Prüfablauf: einmal sprechen, Mängel landen bei den passenden Prüfpunkten.
// v3: Abschnitt in der Surface, Mikrofon schwarz, während der Aufnahme Zinnober ohne Pulsschein (nur Wellenform).
import clsx from 'clsx';
import { Check, Loader2, Mic, Square } from 'lucide-react';
import { useState } from 'react';
import type { Checkpoint } from '../../../shared/catalog';
import type { CaptureItem } from '../../../shared/smart';
import { api } from '../../api';
import { fmtSeconds, useDictation } from '../../dictate';
import { Wave } from '../Dictate';
import { Button, Section, Textarea } from '../ui';

export function VoicePanel({ checkpoints, onApply }: { checkpoints: Pick<Checkpoint, 'id' | 'label'>[]; onApply: (items: CaptureItem[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dict = useDictation((t) => setText(t));
  if (dict.engine === null || dict.engine === 'none') return null;
  const rec = dict.state === 'recording';
  const converting = dict.state === 'transcribing';

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ items: CaptureItem[] }>('/ai/parse', { body: { text, checkpoints: checkpoints.map((c) => ({ id: c.id, label: c.label })), categories: [] } });
      onApply(r.items);
      const n = r.items.filter((i) => i.kind === 'defect').length;
      setMsg({
        ok: true,
        text: n ? `${n} ${n === 1 ? 'Mangel' : 'Mängel'} eingetragen – den Rest weiter prüfen.` : 'Keine Mängel erkannt – der Text steht in den Bemerkungen.',
      });
      setText('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Auswerten fehlgeschlagen' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section aria-label="Befund einsprechen">
      <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (rec ? dict.stop() : dict.start())}
          disabled={converting}
          aria-label={rec ? 'Aufnahme beenden' : 'Befund einsprechen'}
          className={clsx(
            'grid size-11 shrink-0 place-items-center rounded-full text-white transition-colors active:opacity-85 disabled:opacity-60',
            rec ? 'bg-shu' : 'bg-ink hover:bg-brand-strong',
          )}
        >
          {converting ? <Loader2 className="size-5 animate-spin" /> : rec ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
        </button>
        {rec ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Wave level={dict.level} active bars={22} className="min-w-0 flex-1 overflow-hidden" />
            <span className="shrink-0 text-meta font-medium text-ink tabular-nums">{fmtSeconds(dict.seconds)}</span>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink">Befund einsprechen</p>
            <p className={clsx('text-meta', dict.error ? 'text-shu' : 'text-ink-3')}>
              {dict.error || (converting ? 'Wandle Sprache in Text um …' : 'Nur Mängel nennen – sie landen beim passenden Punkt.')}
            </p>
          </div>
        )}
      </div>
      {(text || rec) && (
        <div className="flex flex-col gap-2">
          <Textarea dictate={false} aria-label="Eingesprochener Befund" placeholder="Sprich jetzt …" value={text} onChange={(e) => setText(e.target.value)} className="min-h-20" />
          <div className="flex justify-end gap-2">
            {!rec && (
              <Button size="sm" variant="ghost" onClick={() => setText('')}>
                Verwerfen
              </Button>
            )}
            <Button size="sm" loading={busy} disabled={!text.trim() || rec} onClick={apply}>
              Übernehmen
            </Button>
          </div>
        </div>
      )}
      {msg && (
        <p className={clsx('flex items-start gap-1.5 text-meta', msg.ok ? 'text-ink-2' : 'text-shu')} role="status">
          {msg.ok && <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />}
          {msg.text}
        </p>
      )}
      </div>
    </Section>
  );
}
