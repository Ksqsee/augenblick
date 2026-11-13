// „Befund einsprechen“ im Prüfablauf: einmal sprechen, Mängel landen bei den passenden Prüfpunkten.
// v3: Abschnitt in der Surface, Mikrofon schwarz, während der Aufnahme Zinnober ohne Pulsschein (nur Wellenform).
// Ohne Netz (oder ohne Spracherkennung im Browser) bleibt das Textfeld: das Mikrofon der Handy-Tastatur
// diktiert auch offline, ausgewertet wird dann auf dem Gerät (shared/smart.ts).
import clsx from 'clsx';
import { Check, Loader2, Mic, Square } from 'lucide-react';
import { useState } from 'react';
import type { Checkpoint } from '../../../shared/catalog';
import { type CaptureItem, parseCapture } from '../../../shared/smart';
import { api, ApiError } from '../../api';
import { fmtSeconds, useDictation } from '../../dictate';
import { useOnline } from '../../offline';
import { Wave } from '../Dictate';
import { Button, Section, Textarea } from '../ui';

/** Auswerten: online über /ai/parse, ohne Netz (oder bei Netzfehler) dieselben Regeln lokal. */
export async function parseFinding(text: string, checkpoints: { id: string; label: string }[], local: boolean): Promise<{ items: CaptureItem[]; local: boolean }> {
  if (!local) {
    try {
      const r = await api<{ items: CaptureItem[] }>('/ai/parse', { body: { text, checkpoints, categories: [] } });
      return { items: r.items, local: false };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // kein Netz: weiter unten lokal
    }
  }
  return { items: parseCapture(text, { checkpoints, categories: [] }), local: true };
}

export function VoicePanel({
  checkpoints,
  onApply,
  text: outerText,
  onText,
  autoFocus,
  hint = 'den Rest weiter prüfen',
}: {
  checkpoints: Pick<Checkpoint, 'id' | 'label'>[];
  onApply: (items: CaptureItem[]) => void;
  /** Text von außen führen (der Prüfablauf übernimmt ihn mit „Alles andere in Ordnung“ gleich mit) */
  text?: string;
  onText?: (t: string) => void;
  /** Textfeld beim Öffnen fokussieren (Handy: Tastatur mit Diktat erscheint) */
  autoFocus?: boolean;
  /** Nach dem Übernehmen: was als Nächstes zu tun ist */
  hint?: string;
}) {
  const [ownText, setOwnText] = useState('');
  const text = outerText ?? ownText;
  const setText = onText ?? setOwnText;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const online = useOnline();
  const dict = useDictation((t) => setText(t));
  // Spracherkennung des Browsers braucht Netz – offline nur das Tastatur-Diktat
  const mic = online && dict.engine === 'browser';
  const rec = dict.state === 'recording';
  const converting = dict.state === 'transcribing';

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await parseFinding(
        text,
        checkpoints.map((c) => ({ id: c.id, label: c.label })),
        !navigator.onLine,
      );
      onApply(r.items);
      const n = r.items.filter((i) => i.kind === 'defect').length;
      const where = r.local ? ' Auf dem Gerät ausgewertet.' : '';
      setMsg({
        ok: true,
        text: (n ? `${n} ${n === 1 ? 'Mangel' : 'Mängel'} eingetragen – ${hint}.` : 'Keine Mängel erkannt – der Text steht in den Bemerkungen.') + where,
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
          {mic && (
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
          )}
          {rec ? (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Wave level={dict.level} active bars={22} className="min-w-0 flex-1 overflow-hidden" />
              <span className="shrink-0 text-meta font-medium text-ink tabular-nums">{fmtSeconds(dict.seconds)}</span>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">Befund einsprechen</p>
              <p className={clsx('text-meta', dict.error && mic ? 'text-shu' : 'text-ink-3')}>
                {(mic && dict.error) ||
                  (converting
                    ? 'Wandle Sprache in Text um …'
                    : mic
                      ? 'Nur Mängel nennen – sie landen beim passenden Punkt.'
                      : 'Mikrofon der Tastatur nutzen – nur Mängel nennen, sie landen beim passenden Punkt.')}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Textarea
            dictate={false}
            autoFocus={autoFocus}
            aria-label="Eingesprochener Befund"
            placeholder={rec ? 'Sprich jetzt …' : 'z. B. „Schließer zieht nicht ganz zu, mittel“'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={clsx(text || rec ? 'min-h-20!' : 'min-h-11! resize-none')}
            rows={text || rec ? 3 : 1}
          />
          {(text || rec) && (
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
          )}
        </div>
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
