// Einstellungen → Unternehmen: ein Formular (Firmenprofil, Prüfungen, Automatisierung, Dokumente) mit
// Speichern-Leiste, darunter sofort wirksame Bereiche (Speicher, Sicherung, Papierkorb).
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, ImageUp, Plus, RotateCcw, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { DOC_LANGUAGES, type DocLanguage, TIME_ZONES } from '../../../shared/i18n';
import { buildFileName, DEFAULT_PDF_PATTERN, PDF_PLACEHOLDERS } from '../../../shared/filename';
import { api, downscale, fileUrl, type Me, queryClient, uploadBlob, useAction, useMe } from '../../api';
import { MeterBar, RowDivider, SaveBar, SettingRow } from '../../components/admin';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Button, Empty, ErrorBox, Field, IconButton, Input, Segmented, Select, SettingsSection, Skeleton, Switch, Textarea, useToast } from '../../components/ui';
import { ADAPT_MODES, type AdaptMode } from '../../../shared/intervals';
import { fmtDateTime } from '../../format';

function initialForm(t: Me['tenant']) {
  return {
    name: t.name,
    address: t.address,
    phone: t.phone,
    email: t.email,
    website: t.website,
    pdfPattern: t.pdfPattern || DEFAULT_PDF_PATTERN,
    logoKey: t.logoKey as string | null,
    archive: (t.archiveAfterMonths ?? '') as number | '',
    language: (t.language ?? 'de') as DocLanguage,
    timeZone: t.timeZone || 'Europe/Berlin',
    reminderDays: (t.reminderDays ?? '') as number | '',
    autoTasks: t.autoTasks !== false,
    adaptIntervals: (t.adaptIntervalsMode ?? 'suggest') as AdaptMode,
    kinds: (t.inspectionKinds ?? []) as { key?: string; label: string }[],
  };
}
type Form = ReturnType<typeof initialForm>;

export function CompanyTab() {
  const { data: me } = useMe();
  if (!me) return <Skeleton className="h-96 w-full rounded-xl" />;
  return (
    <div>
      <CompanyForm me={me} />
      <StorageSection />
      <TrashSection />
    </div>
  );
}

function CompanyForm({ me }: { me: Me }) {
  const toast = useToast();
  const [base, setBase] = useState(() => initialForm(me.tenant));
  const [f, setF] = useState(base);
  const [newKind, setNewKind] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(base), [f, base]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: 'name' | 'address' | 'phone' | 'email' | 'website' | 'pdfPattern') => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value);
  const save = useAction(
    () =>
      api('/account/company', {
        method: 'PATCH',
        body: {
          name: f.name,
          address: f.address,
          phone: f.phone,
          email: f.email,
          website: f.website,
          pdfPattern: f.pdfPattern,
          logoKey: f.logoKey,
          archiveAfterMonths: f.archive === '' ? null : Number(f.archive),
          language: f.language,
          timeZone: f.timeZone,
          reminderDays: f.reminderDays === '' ? null : Number(f.reminderDays),
          autoTasks: f.autoTasks,
          adaptIntervalsMode: f.adaptIntervals,
          inspectionKinds: f.kinds.filter((k) => k.label.trim().length >= 2),
        },
      }),
    () => {
      setBase(f);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Gespeichert');
    },
  );
  const preview = buildFileName(f.pdfPattern, {
    datum: new Date().toISOString().slice(0, 10),
    code: 'FST-7K2M',
    art: 'Feuerschutztür',
    pruefart: 'Jährliche Prüfung',
    objekt: 'Grundschule Am Park',
    gebaeude: 'Haupthaus',
    standort: 'Treppenhaus Nord',
    ergebnis: 'Ohne Mängel',
  });
  const addKind = () => {
    if (newKind.trim().length < 2) return;
    set('kinds', [...f.kinds, { label: newKind.trim() }]);
    setNewKind('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <SettingsSection title="Firmenprofil" description="Steht im Kopf aller Protokolle und Berichte.">
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-canvas">
            {f.logoKey ? <img src={fileUrl(f.logoKey)} alt="Logo" className="max-h-12 max-w-24 object-contain" /> : <span className="text-caption text-ink-3">Kein Logo</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" loading={uploading} icon={<ImageUp />} onClick={() => fileRef.current?.click()}>
                {f.logoKey ? 'Logo ersetzen' : 'Logo hochladen'}
              </Button>
              {f.logoKey && (
                <Button type="button" size="sm" variant="ghost" onClick={() => set('logoKey', null)}>
                  Entfernen
                </Button>
              )}
            </div>
            <p className="text-caption text-ink-3">PNG oder JPG, am besten mit transparentem Hintergrund.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setUploading(true);
              try {
                // PNG behalten (Transparenz), sonst verkleinern
                set('logoKey', await uploadBlob(file.type === 'image/png' && file.size < 1_500_000 ? file : await downscale(file, 800)));
              } catch (x) {
                toast(x instanceof Error ? x.message : 'Upload fehlgeschlagen', 'bad');
              } finally {
                setUploading(false);
              }
            }}
          />
        </div>
        <Field label="Firmenname">{(id) => <Input id={id} required value={f.name} onChange={text('name')} />}</Field>
        <Field label="Anschrift" optional>
          {(id) => <Textarea id={id} dictate={false} className="min-h-16" value={f.address} onChange={text('address')} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Telefon" optional>
            {(id) => <Input id={id} type="tel" value={f.phone} onChange={text('phone')} />}
          </Field>
          <Field label="E-Mail" optional>
            {(id) => <Input id={id} type="email" value={f.email} onChange={text('email')} />}
          </Field>
        </div>
        <Field label="Website" optional>
          {(id) => <Input id={id} value={f.website} onChange={text('website')} />}
        </Field>
      </SettingsSection>

      <SettingsSection title="Prüfungen" description="Arten, Erinnerungen und Archiv für den ganzen Workspace.">
        <div>
          <p className="text-body font-medium">Eigene Prüfungsarten</p>
          <p className="mt-0.5 text-meta text-ink-3">Ergänzen die festen Arten wie „Wiederkehrende Prüfung“. Pro Prüfung lassen sich mehrere wählen.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {f.kinds.map((k, i) => (
              <li key={k.key ?? `neu-${i}`} className="flex gap-2">
                <Input aria-label="Bezeichnung der Prüfungsart" value={k.label} onChange={(e) => set('kinds', f.kinds.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <IconButton label="Prüfungsart entfernen" icon={<X />} onClick={() => set('kinds', f.kinds.filter((_, j) => j !== i))} />
              </li>
            ))}
            <li className="flex gap-2">
              <Input
                placeholder="z. B. Abnahmeprüfung"
                aria-label="Neue Prüfungsart"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKind();
                  }
                }}
              />
              <Button type="button" variant="secondary" icon={<Plus />} disabled={newKind.trim().length < 2} onClick={addKind}>
                Hinzufügen
              </Button>
            </li>
          </ul>
          <p className="mt-2 text-caption text-ink-3">Entfernte Arten bleiben in bestehenden Protokollen sichtbar.</p>
        </div>
        <RowDivider />
        <SettingRow title="Erinnerung vor Fälligkeit" description="Meldung an Prüfer und Admins, zusätzlich zur Meldung bei Überfälligkeit.">
          <Select aria-label="Erinnerung vor Fälligkeit" className="sm:w-52" value={f.reminderDays} onChange={(e) => set('reminderDays', e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Keine Vorab-Erinnerung</option>
            {[...new Set([7, 14, 30, 60, 90, ...(f.reminderDays === '' ? [] : [f.reminderDays])])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {d} Tage vorher
                </option>
              ))}
          </Select>
        </SettingRow>
        <RowDivider />
        <SettingRow title="Automatisch archivieren" description="Ältere Prüfungen verlassen die Listen, bleiben aber als Nachweis im Archiv. Die neueste bleibt immer aktiv.">
          <Select aria-label="Automatisch archivieren" className="sm:w-52" value={f.archive} onChange={(e) => set('archive', e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Nie</option>
            {[12, 24, 36, 60, 120].map((m) => (
              <option key={m} value={m}>
                nach {m / 12} {m === 12 ? 'Jahr' : 'Jahren'}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Automatisierung" description="Arbeit, die Prüfkompass selbst erledigt.">
        <Switch
          checked={f.autoTasks}
          onChange={(v) => set('autoTasks', v)}
          label="Aufgaben für schwere Mängel automatisch anlegen"
          description="Bei Mängeln der Stufe „Hoch“ oder „Kritisch“ entsteht sofort eine Aufgabe mit Frist nach SLA – aus Prüfungen und aus dem Erfassen."
        />
        <RowDivider />
        <SettingRow
          title="Prüfintervalle selbst anpassen"
          description="Nach zwei Prüfungen in Folge mit Mängeln wird das Intervall des Elements halbiert (mindestens 1 Monat), nach vier mängelfreien Prüfungen gilt wieder der Standard. Nie länger als der Standard."
        >
          <Segmented<AdaptMode>
            value={f.adaptIntervals}
            onChange={(v) => set('adaptIntervals', v)}
            options={(Object.keys(ADAPT_MODES) as AdaptMode[]).map((k) => ({ value: k, label: ADAPT_MODES[k] }))}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection className="!border-b" title="Dokumente" description="Die Oberfläche bleibt deutsch. Sprache und Dateinamen gelten für PDF-Protokolle, Berichte und den Excel-Export.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Sprache der Dokumente" hint="Eigene Prüfpunkte und Freitexte bleiben unverändert.">
            {(id) => (
              <Select id={id} value={f.language} onChange={(e) => set('language', e.target.value as DocLanguage)}>
                {Object.entries(DOC_LANGUAGES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Zeitzone" hint="Für Datumsangaben, Erinnerungen und Wochenübersicht.">
            {(id) => (
              <Select id={id} value={f.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
                {[...new Set([f.timeZone, ...TIME_ZONES])].map((z) => (
                  <option key={z} value={z}>
                    {z.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <RowDivider />
        <Field label="Dateiname der PDF-Protokolle" hint="Platzhalter antippen, um sie anzuhängen. Je Objekt überschreibbar.">
          {(id) => (
            <div className="flex flex-col gap-2">
              <Input id={id} value={f.pdfPattern} onChange={text('pdfPattern')} className="font-mono" />
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PDF_PLACEHOLDERS).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    title={label}
                    onClick={() => set('pdfPattern', `${f.pdfPattern}_{${k}}`)}
                    className="h-7 rounded-md border border-line bg-surface px-2 font-mono text-caption text-ink-2 hover:border-line-strong hover:text-ink"
                  >
                    {`{${k}}`}
                  </button>
                ))}
              </div>
              <p className="min-w-0 truncate rounded-md bg-canvas px-2.5 py-1.5 text-caption text-ink-3">
                Beispiel: <span className="font-mono text-ink-2">{preview}</span>
              </p>
            </div>
          )}
        </Field>
      </SettingsSection>

      <SaveBar dirty={dirty} saving={save.isPending} onReset={() => setF(base)} />
    </form>
  );
}

// ---------- Speicher ----------
const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(n / 1024)} KB`;

interface StorageInfo {
  groups: Record<'plans' | 'reports' | 'photos' | 'logo' | 'other', { bytes: number; files: number }>;
  totalBytes: number;
  files: number;
  truncated: boolean;
  records: { assets: number; inspections: number; defects: number; signatureBytes: number };
}
// Neutrale Abstufungen – Farbe ist im Designsystem Status vorbehalten.
const STORAGE_GROUPS: [keyof StorageInfo['groups'], string, string][] = [
  ['photos', 'Fotos & Dokumente', 'bg-ink'],
  ['plans', 'Grundrisse', 'bg-ink-2'],
  ['reports', 'Berichtsarchiv', 'bg-ink-3'],
  ['logo', 'Logo', 'bg-ink-4'],
  ['other', 'Sonstige', 'bg-line-strong'],
];

function StorageSection() {
  const q = useQuery({ queryKey: ['storage'], queryFn: () => api<StorageInfo>('/account/storage'), staleTime: 60_000 });
  const d = q.data;
  return (
    <SettingsSection title="Speicher" description="Belegter Platz durch Dateien dieses Workspaces.">
      {q.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : q.error || !d ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[28px] leading-8 font-semibold tracking-[-0.02em] tabular-nums">{fmtBytes(d.totalBytes)}</p>
            <p className="text-meta text-ink-3 tabular-nums">
              {d.files} Dateien{d.truncated ? ' (Auszug)' : ''} · {d.records.assets} Elemente · {d.records.inspections} Prüfungen
            </p>
          </div>
          <MeterBar label="Aufteilung des Speichers" parts={STORAGE_GROUPS.map(([k, , c]) => ({ key: k, className: c, value: d.totalBytes ? (d.groups[k].bytes / d.totalBytes) * 100 : 0 }))} />
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-body sm:grid-cols-2">
            {STORAGE_GROUPS.map(([k, label, color]) => (
              <div key={k} className="flex items-center gap-2">
                <span className={clsx('size-2 shrink-0 rounded-full', color)} />
                <dt className="flex-1 text-ink-2">{label}</dt>
                <dd className={clsx('tabular-nums', !d.groups[k].bytes && 'text-ink-4')}>
                  {fmtBytes(d.groups[k].bytes)} <span className="text-caption text-ink-3">({d.groups[k].files})</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-ink-3">Unterschriften liegen in der Datenbank ({fmtBytes(d.records.signatureBytes)}).</p>
        </>
      )}
      <RowDivider />
      <SettingRow title="Sicherung" description="Alle Daten des Workspaces als JSON-Datei (ohne Passwörter).">
        <a href="/api/export/backup.json" download className="contents">
          <Button type="button" variant="secondary" icon={<Download />}>
            JSON-Backup
          </Button>
        </a>
      </SettingRow>
    </SettingsSection>
  );
}

// ---------- Papierkorb ----------
interface TrashRow {
  id: string;
  code: string;
  category: string;
  location: string;
  deletedAt: number;
  buildingName: string;
  propertyName: string;
  parentDeleted: number;
}

function TrashSection() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['trash'], queryFn: () => api<TrashRow[]>('/trash/assets') });
  const restore = useAction(
    (id: string) => api<{ labelRestored: boolean }>(`/assets/${id}/restore`, { method: 'POST' }),
    (r) => {
      queryClient.invalidateQueries();
      toast(r.labelRestored ? 'Element wiederhergestellt' : 'Wiederhergestellt – Etikett neu vergeben');
    },
  );
  return (
    <SettingsSection title="Papierkorb" description="Gelöschte Elemente lassen sich 30 Tage lang mit ihrer Prüfhistorie wiederherstellen.">
      {restore.error && <ErrorBox error={restore.error} />}
      {q.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty compact className="!py-4" icon={<RotateCcw />} title="Papierkorb ist leer" text="Gelöschte Elemente erscheinen hier 30 Tage lang." />
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {q.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1">
              <CategoryIcon category={a.category} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{a.code}</span>
                <span className="block truncate text-meta text-ink-3">
                  {[a.location, a.buildingName, a.propertyName].filter(Boolean).join(' · ')} · gelöscht {fmtDateTime(a.deletedAt)}
                </span>
              </span>
              {a.parentDeleted ? (
                <span className="shrink-0 text-meta text-ink-3">Gebäude gelöscht</span>
              ) : (
                <Button type="button" size="sm" variant="secondary" loading={restore.isPending && restore.variables === a.id} onClick={() => restore.mutate(a.id)}>
                  Wiederherstellen
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
