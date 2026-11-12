// Element (Design v3, Vorlage „Detail“ docs/design.md 5.3): eine Surface mit Prüfarten, Offene Mängel, Verlauf,
// Fotos & Dokumente; rechts Eigenschaften, Stammdaten, „Als Nächstes hier“, QR-Code und Grundriss als Text auf dem Grund.
// Belege: docs/design/objekte-elemente.md
import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Link2, Map, Pencil, Plus, QrCode, RotateCcw, Trash2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { INSPECTION_PURPOSES, kindLabel } from '../../shared/catalog';
import { effectiveInterval } from '../../shared/intervals';
import { api, ApiError, type Asset, type AssetDetail, type Attachment, downscale, fileUrl, queryClient, uploadBlob, useAction, useAsset, useAssets, useMe } from '../api';
import { scheduleLabel, schedulesFor } from '../categories';
import { useStartInspection } from '../components/AssetDrawer';
import { CategoryIcon } from '../components/CategoryIcon';
import { AssetForm, attributeRows } from '../components/forms';
import { AsideList, AsideRow, AsideSection } from '../components/objects/Aside';
import { dueInfo, DuePhrase, nextScheduleName } from '../components/objects/status';
import {
  Button,
  ErrorBox,
  Input,
  List,
  ListRow,
  Menu,
  type MenuItem,
  PageHeader,
  PageSkeleton,
  PropertyList,
  ResultBadge,
  SearchField,
  Section,
  SectionLink,
  SeverityBadge,
  Spinner,
  StatusText,
  Surface,
  Timeline,
  type TimelineItem,
  useConfirm,
  useToast,
} from '../components/ui';
import { MiniPlan } from './FloorPlan';
import { assetDue, fmtDate, fmtDateTime, RESULT_META } from '../format';

export function qrUrl(code: string) {
  return `${window.location.origin}/e/${encodeURIComponent(code)}`;
}

export function QrImage({ code, size = 160 }: { code: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(qrUrl(code), { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [code, size]);
  return src ? <img src={src} width={size} height={size} alt={`QR-Code ${code}`} /> : <div style={{ width: size, height: size }} />;
}

/** Kleiner Textlink in Abschnittsköpfen. */
const textLink = 'text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline';

export function AssetPage() {
  const { id = '' } = useParams();
  const { data: a, isLoading, error, refetch } = useAsset(id);
  const { data: me } = useMe();
  const start = useStartInspection();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [edit, setEdit] = useState(false);
  const del = useAction(
    () => api(`/assets/${id}`, { method: 'DELETE' }),
    () => {
      toast('Element gelöscht');
      navigate('/elemente');
    },
  );
  if (isLoading) return <PageSkeleton />;
  if (error || !a) return <ErrorBox error={error ?? new Error('Element nicht gefunden')} onRetry={() => refetch()} />;
  const def = getCategory(a.category);
  const canInspect = me?.user.role !== 'viewer';
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const draft = a.inspections.find((i) => i.status === 'draft');
  const d = dueInfo(a);
  const sched = nextScheduleName(a);
  const openDefects = a.defects.filter((x) => x.status === 'open');
  const attrs = attributeRows(a.category, a.attributes);

  const menu: MenuItem[] = [{ label: 'Etikett drucken', icon: <QrCode />, to: `/druck/etiketten?ids=${a.id}` }];
  if (a.floorPlan) menu.push({ label: 'Auf dem Grundriss zeigen', icon: <Map />, to: `/grundrisse/${a.floorPlan.id}` });
  if (isAdmin)
    menu.push('separator', {
      label: 'Element löschen',
      icon: <Trash2 />,
      danger: true,
      onClick: async () => {
        if (await confirm({ title: `${a.code} löschen?`, text: 'Das Element kommt in den Papierkorb und lässt sich dort wiederherstellen.', confirmLabel: 'Löschen', danger: true }))
          del.mutate(undefined);
      },
    });

  return (
    <>
      {confirmEl}
      <PageHeader
        breadcrumbs={[
          { label: 'Objekte', to: '/objekte' },
          { label: a.propertyName, to: `/objekte/${a.propertyId}` },
          { label: a.buildingName, to: `/objekte/${a.propertyId}` },
        ]}
        title={a.code}
        subtitle={`${def.label} · ${[a.location, a.floor].filter(Boolean).join(' · ') || 'Ohne Standort'}`}
        meta={
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <StatusText tone={d.tone}>{d.detail}</StatusText>
            {sched && <span>· {sched}</span>}
            {openDefects.length > 0 && <span>· {openDefects.length === 1 ? '1 offener Mangel' : `${openDefects.length} offene Mängel`}</span>}
          </span>
        }
        actions={
          <>
            {canInspect && (
              <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
                Bearbeiten
              </Button>
            )}
            <Menu items={menu} label="Weitere Aktionen zum Element" />
            {canInspect && (
              <Button icon={<ClipboardCheck className="size-4" />} loading={start.isPending} onClick={() => start.mutate(a.id)}>
                {draft ? 'Entwurf fortsetzen' : 'Prüfung starten'}
              </Button>
            )}
          </>
        }
      />
      {edit && <AssetForm initial={a} onClose={() => setEdit(false)} />}
      {start.error && <ErrorBox error={start.error} className="mb-4" />}

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-8">
        {/* Handy: Eigenschaften direkt unter dem Kopf, der Rest der Seitenspalte nach dem Inhalt */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <AsideSection title="Eigenschaften">
            <PropertyList
              className="border-t border-line pt-3"
              items={[
                {
                  label: 'Nächste Prüfung',
                  value: a.nextDueAt && (
                    <>
                      {fmtDate(a.nextDueAt)}
                      {sched && <span className="block text-meta font-normal text-ink-3">{sched}</span>}
                    </>
                  ),
                },
                {
                  label: 'Letzte Prüfung',
                  value: a.lastInspectedAt && (
                    <>
                      {fmtDate(a.lastInspectedAt)}
                      {a.lastResult && (
                        <span className="block font-normal">
                          <ResultBadge result={a.lastResult} />
                        </span>
                      )}
                    </>
                  ),
                },
                { label: 'Intervall', value: `alle ${effectiveInterval(schedulesFor(a.category).find((s) => s.key === 'main')?.intervalMonths ?? def.intervalMonths, a.schedules?.main)} Monate` },
                { label: 'Vorwarnung', value: a.warnDays ? `${a.warnDays} Tage vorher` : <span className="font-normal text-ink-3">Vorgabe</span> },
                {
                  label: 'Objekt',
                  value: (
                    <Link to={`/objekte/${a.propertyId}`} className="hover:underline">
                      {a.propertyName}
                    </Link>
                  ),
                },
                { label: 'Gebäude', value: a.buildingName },
                { label: 'Standort', value: a.location },
                { label: 'Etage', value: a.floor },
                { label: 'Hersteller', value: a.manufacturer },
                { label: 'Typ', value: a.model },
              ]}
            />
          </AsideSection>
        </div>

        <Surface data-detail-surface className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <IntervalSection asset={a} canEdit={isAdmin} />
          <SchedulesSection asset={a} canEdit={!!canInspect} onStart={(schedule) => start.mutate({ assetId: a.id, schedule })} />

          <Section title="Offene Mängel" count={openDefects.length} flush action={openDefects.length > 0 && <SectionLink to="/maengel">Alle Mängel</SectionLink>}>
            {openDefects.length === 0 ? (
              <p className="px-(--row-px) pb-3 text-body text-ink-2">Keine offenen Mängel.</p>
            ) : (
              <List plain aria-label="Offene Mängel">
                {openDefects.map((x) => (
                  <ListRow key={x.id} title={x.title} subtitle={[x.note, fmtDate(x.createdAt)].filter(Boolean).join(' · ')} trailing={<SeverityBadge severity={x.severity} />} />
                ))}
              </List>
            )}
          </Section>

          <Section title="Verlauf" count={a.inspections.length}>
            {a.inspections.length === 0 && a.defects.length === 0 ? (
              <p className="text-body text-ink-2">Noch nicht geprüft. Die erste Prüfung legt den nächsten Termin fest.</p>
            ) : (
              <Timeline items={history(a, me?.tenant.inspectionKinds)} className="pt-2" />
            )}
          </Section>

          <AttachmentsSection assetId={a.id} items={a.attachments ?? []} canEdit={!!canInspect} />
        </Surface>

        <aside className="flex min-w-0 flex-col gap-8 lg:col-start-2 lg:row-start-2" aria-label="Zum Element">
          {attrs.length > 0 && (
            <AsideSection title="Stammdaten">
              <PropertyList className="border-t border-line pt-3" items={attrs.map(([label, value]) => ({ label, value: value === '–' ? null : value }))} />
            </AsideSection>
          )}
          <NextHere asset={a} />
          <AsideSection
            title="QR-Code"
            action={
              <Link to={`/druck/etiketten?ids=${a.id}`} className={textLink}>
                Drucken
              </Link>
            }
          >
            <div className="flex items-center gap-4 border-t border-line pt-3">
              <div className="shrink-0 rounded-md bg-surface p-1 ring-1 ring-line">
                <QrImage code={a.code} size={88} />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-body font-semibold">{a.code}</p>
                <p className="mt-0.5 text-meta text-ink-3">Scannen öffnet dieses Element.</p>
              </div>
            </div>
            <LabelRow assetId={a.id} label={a.labelCode} canEdit={!!canInspect} />
          </AsideSection>
          <AsideSection
            title="Grundriss"
            action={
              !(a.floorPlan && a.markerX != null) && (
                <Link to={`/objekte/${a.propertyId}?tab=grundrisse`} className={textLink}>
                  Platzieren
                </Link>
              )
            }
          >
            {a.floorPlan && a.markerX != null && a.markerY != null ? (
              <div className="border-t border-line pt-3">
                <MiniPlan plan={a.floorPlan} x={a.markerX} y={a.markerY} />
              </div>
            ) : (
              <p className="border-t border-line py-3 text-body text-ink-2">Nicht auf einem Grundriss.</p>
            )}
          </AsideSection>
        </aside>
      </div>
    </>
  );
}

/** Prüfungen und Mängel als ein Verlauf, neueste zuerst. Je Eintrag ein Statuswort; Zusätze als grauer Text. */
function history(a: AssetDetail, kinds?: Parameters<typeof kindLabel>[1]): TimelineItem[] {
  const items: (TimelineItem & { at: number })[] = [];
  for (const i of a.inspections) {
    const at = i.inspectedAt ?? i.createdAt;
    const tone = i.status === 'draft' ? 'info' : i.result ? RESULT_META[i.result].tone : undefined;
    const extra = [i.supersededAt ? 'berichtigt' : null, i.purpose && i.purpose !== 'regular' ? INSPECTION_PURPOSES[i.purpose] : null, i.archivedAt ? 'Archiv' : null].filter(Boolean);
    items.push({
      id: i.id,
      at,
      tone,
      icon: <ClipboardCheck />,
      title: (
        <Link to={i.status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`} className="hover:underline hover:decoration-line-strong hover:underline-offset-4">
          {i.status === 'draft' ? 'Prüfung begonnen' : scheduleLabel(a.category, i.schedule ?? 'main')}
        </Link>
      ),
      time: fmtDateTime(at),
      meta: (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>
            {i.inspector} · {(i.kinds?.length ? i.kinds : [i.kind]).map((k) => kindLabel(k, kinds)).join(', ')}
            {extra.length > 0 && ` · ${extra.join(' · ')}`}
          </span>
          {!i.supersededAt && (i.status === 'draft' ? <StatusText tone="info">Entwurf</StatusText> : i.result && <ResultBadge result={i.result} />)}
        </span>
      ),
    });
  }
  for (const x of a.defects) {
    if (x.status === 'resolved' && x.resolvedAt)
      items.push({ id: `${x.id}-r`, at: x.resolvedAt, tone: 'ok', icon: <CheckCircle2 />, title: `Mangel behoben: ${x.title}`, time: fmtDateTime(x.resolvedAt) });
    if (!x.inspectionId)
      items.push({ id: x.id, at: x.createdAt, tone: 'warn', icon: <AlertTriangle />, title: `Mangel erfasst: ${x.title}`, time: fmtDateTime(x.createdAt), body: x.note || undefined });
  }
  return items.sort((p, q) => q.at - p.at);
}

/** Smarter Hinweis: was im selben Gebäude als Nächstes fällig ist – für Prüfungen am Stück. */
function NextHere({ asset }: { asset: AssetDetail }) {
  const { data } = useAssets({ propertyId: asset.propertyId });
  const rank = (x: Asset) => ({ overdue: 0, never: 1, soon: 2, ok: 3 })[assetDue(x.nextDueAt)];
  const next = (data ?? [])
    .filter((x) => x.buildingId === asset.buildingId && x.id !== asset.id && x.lastResult !== 'not_inspectable' && rank(x) < 3)
    .sort((p, q) => rank(p) - rank(q) || (p.nextDueAt ?? 0) - (q.nextDueAt ?? 0))
    .slice(0, 3);
  if (!next.length) return null;
  return (
    <AsideSection title={`Als Nächstes in ${asset.buildingName}`}>
      <AsideList>
        {next.map((x) => (
          <AsideRow key={x.id} to={`/elemente/${x.id}`} aria-label={`Nächstes Element ${x.code}`} sub={<DuePhrase asset={x} />}>
            <span className="font-medium">{x.code}</span>
            {x.location && <span className="text-ink-3"> · {x.location}</span>}
          </AsideRow>
        ))}
      </AsideList>
    </AsideSection>
  );
}

interface IntervalSuggestionRow {
  assetId: string;
  schedule: string;
  scheduleLabel: string;
  kind: 'shorten' | 'restore';
  from: number;
  to: number;
  standard: number;
  text: string;
}

/**
 * Selbstanpassende Prüfintervalle am Element: angepasste Intervalle mit „Zurücksetzen“ und offene Vorschläge
 * (Stufe „Vorschlagen“) mit „Übernehmen“. Ändern dürfen nur Admins.
 */
function IntervalSection({ asset, canEdit }: { asset: AssetDetail; canEdit: boolean }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['intervals', asset.id], queryFn: () => api<{ mode: string; suggestions: IntervalSuggestionRow[] }>(`/smart/intervals?assetId=${asset.id}`) });
  const after = (msg: string) => {
    toast(msg);
    for (const k of ['asset', 'intervals', 'smart', 'now', 'assets', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const reset = useAction((key: string) => api('/smart/intervals/reset', { body: { assetId: asset.id, schedule: key } }), () => after('Intervall zurückgesetzt'));
  const apply = useAction((s: IntervalSuggestionRow) => api('/smart/intervals/apply', { body: { assetId: asset.id, schedule: s.schedule, months: s.to } }), () => after('Intervall angepasst'));
  const list = schedulesFor(asset.category);
  const adapted = list
    .map((s) => ({ s, st: asset.schedules?.[s.key] }))
    .filter(({ s, st }) => (s.key === 'main' || st?.enabled) && st?.intervalMonths != null && effectiveInterval(s.intervalMonths, st) < s.intervalMonths);
  const suggestions = q.data?.suggestions ?? [];
  if (!adapted.length && !suggestions.length) return null;
  const multi = list.length > 1;
  return (
    <Section aria-label="Prüfintervall" title="Prüfintervall" flush>
      {(reset.error || apply.error) && <ErrorBox error={reset.error ?? apply.error} className="mx-(--row-px) mb-3" />}
      <ul className="pk-list">
        {adapted.map(({ s, st }) => (
          <li key={s.key} data-interval={s.key} className="flex flex-col gap-2 px-(--row-px) py-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-body">
              Intervall angepasst: {effectiveInterval(s.intervalMonths, st)} statt {s.intervalMonths} Monate
              {multi && <span className="text-ink-3"> · {s.label}</span>}
              {st?.intervalAt && <span className="block text-meta text-ink-3">seit {fmtDate(st.intervalAt)} wegen wiederholter Mängel</span>}
            </p>
            {canEdit && (
              <Button size="sm" variant="ghost" icon={<RotateCcw />} loading={reset.isPending} onClick={() => reset.mutate(s.key)} className="max-sm:-ml-3 max-sm:self-start">
                Zurücksetzen
              </Button>
            )}
          </li>
        ))}
        {suggestions.map((g) => (
          <li key={`${g.schedule}-${g.kind}`} data-interval-suggestion={g.schedule} className="flex flex-col gap-2 px-(--row-px) py-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-body">
              Vorschlag: {g.text}
              {multi && <span className="text-ink-3"> · {g.scheduleLabel}</span>}
              <span className="block text-meta text-ink-3">
                {g.kind === 'shorten' ? 'Die letzten zwei Prüfungen hatten Mängel.' : 'Die letzten vier Prüfungen waren ohne Mängel.'}
              </span>
            </p>
            {canEdit && (
              <Button size="sm" variant="secondary" loading={apply.isPending} onClick={() => apply.mutate(g)} className="max-sm:self-start">
                Übernehmen
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SchedulesSection({ asset, canEdit, onStart }: { asset: AssetDetail; canEdit: boolean; onStart: (key: string) => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const list = schedulesFor(asset.category);
  const [enabling, setEnabling] = useState<string | null>(null);
  const [first, setFirst] = useState(new Date().toISOString().slice(0, 10));
  const save = useAction(
    (v: { key: string; enabled: boolean; nextDueAt?: number | null }) => api(`/assets/${asset.id}/schedules`, { method: 'PUT', body: v }),
    (_, v) => {
      toast(v.enabled ? 'Prüfart aktiviert' : 'Prüfart deaktiviert');
      setEnabling(null);
    },
  );
  if (list.length < 2) return null;
  return (
    <Section title="Prüfarten" action={<span className="text-meta text-ink-3 max-sm:hidden">Jede mit eigenem Intervall und Termin</span>} flush>
      {confirmEl}
      {save.error && <ErrorBox error={save.error} className="mx-(--row-px) mb-3" />}
      <ul className="pk-list" aria-label="Prüfarten">
        {list.map((s) => {
          const st = asset.schedules?.[s.key];
          const on = s.key === 'main' || !!st?.enabled;
          const state = { nextDueAt: s.key === 'main' && st?.lastAt == null && st?.nextDueAt == null ? null : (st?.nextDueAt ?? null), lastResult: st?.lastResult ?? null };
          return (
            <li key={s.key} className="flex flex-col gap-2 px-(--row-px) py-3 sm:min-h-14 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-body text-ink">
                  {s.label} <span className="text-ink-3">· alle {effectiveInterval(s.intervalMonths, st)} Monate</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-meta text-ink-3">
                  {on ? (
                    <>
                      <DuePhrase asset={state} />
                      {st?.lastAt ? <span>· zuletzt {fmtDate(st.lastAt)}</span> : null}
                    </>
                  ) : (
                    'Für dieses Element nicht aktiv'
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1 max-sm:-ml-3">
                {canEdit && on && (
                  <Button size="sm" variant="secondary" onClick={() => onStart(s.key)} className="max-sm:ml-3">
                    Prüfen
                  </Button>
                )}
                {canEdit &&
                  s.key !== 'main' &&
                  (on ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () =>
                        (await confirm({ title: `${s.label} deaktivieren?`, text: 'Für dieses Element entfällt dann der Termin dieser Prüfart.', confirmLabel: 'Deaktivieren' })) &&
                        save.mutate({ key: s.key, enabled: false })
                      }
                    >
                      Deaktivieren
                    </Button>
                  ) : enabling === s.key ? (
                    <form
                      className="flex items-center gap-2 max-sm:ml-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save.mutate({ key: s.key, enabled: true, nextDueAt: new Date(`${first}T12:00:00`).getTime() });
                      }}
                    >
                      <Input type="date" required value={first} onChange={(e) => setFirst(e.target.value)} className="h-9 w-40 sm:h-8" aria-label="Erster Termin" />
                      <Button size="sm" loading={save.isPending}>
                        Aktivieren
                      </Button>
                    </form>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setEnabling(s.key)}>
                      Aktivieren
                    </Button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const fmtSize = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function AttachmentsSection({ assetId, items, canEdit }: { assetId: string; items: Attachment[]; canEdit: boolean }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const del = useAction((id: string) => api(`/attachments/${id}`, { method: 'DELETE' }), () => toast('Datei entfernt'));
  const upload = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        const isPdf = f.type === 'application/pdf';
        const blob = isPdf ? f : await downscale(f, 2000);
        if (blob.size > 10 * 1024 * 1024) throw new Error(`${f.name} ist größer als 10 MB`);
        const key = await uploadBlob(blob);
        await api(`/assets/${assetId}/attachments`, { body: { key, name: f.name, contentType: isPdf ? 'application/pdf' : blob.type || 'image/jpeg', size: blob.size } });
      }
      await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
      toast(files.length === 1 ? 'Datei hochgeladen' : `${files.length} Dateien hochgeladen`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Fotos & Dokumente"
      count={items.length}
      action={
        canEdit &&
        items.length > 0 && (
          <Button size="sm" variant="ghost" loading={busy} icon={<Plus />} onClick={() => ref.current?.click()}>
            Hinzufügen
          </Button>
        )
      }
    >
      {confirmEl}
      <input
        ref={ref}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = '';
          if (f.length) void upload(f);
        }}
      />
      {!!error && <ErrorBox error={error} className="mb-3" />}
      {items.length === 0 ? (
        <p className="text-body text-ink-2">
          Noch keine Dateien.{' '}
          {canEdit && (
            <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink disabled:opacity-50">
              {busy ? 'Wird hochgeladen …' : 'Fotos, Zulassungen oder Datenblätter hinzufügen'}
            </button>
          )}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-5 pt-2 sm:grid-cols-3">
          {items.map((f) => (
            <li key={f.id} className="group relative min-w-0">
              <a href={fileUrl(f.fileKey)} target="_blank" rel="noreferrer" className="block">
                {f.contentType.startsWith('image/') ? (
                  <img src={fileUrl(f.fileKey)} alt={f.caption || f.name} className="aspect-[4/3] w-full rounded-md bg-sunken object-cover" loading="lazy" />
                ) : (
                  <span className="grid aspect-[4/3] place-items-center rounded-md bg-sunken text-ink-3">
                    <FileText className="size-6" strokeWidth={1.5} />
                  </span>
                )}
                <span className="mt-2 block truncate text-meta text-ink">{f.caption || f.name}</span>
                <span className="block truncate text-caption text-ink-3">
                  {f.inspectionId ? 'aus Prüfung · ' : ''}
                  {fmtDate(f.createdAt)}
                  {f.size ? ` · ${fmtSize(f.size)}` : ''}
                </span>
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={async () => (await confirm({ title: `„${f.caption || f.name}“ entfernen?`, confirmLabel: 'Entfernen', danger: true })) && del.mutate(f.id)}
                  className="absolute top-2 right-2 grid size-8 place-items-center rounded-md bg-ink/75 text-white transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label="Entfernen"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function LabelRow({ assetId, label, canEdit }: { assetId: string; label: string | null; canEdit: boolean }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const save = useAction(
    (v: string | null) => api(`/assets/${assetId}/label`, { method: 'PUT', body: { labelCode: v } }),
    (_, v) => {
      toast(v ? 'Etikett zugeordnet' : 'Etikett gelöst');
      setEditing(false);
      setValue('');
    },
  );
  return (
    <div className="mt-3 border-t border-line pt-3">
      {confirmEl}
      <p className="mb-1.5 text-meta text-ink-3">Vorgedrucktes Etikett</p>
      {save.error && <ErrorBox error={save.error} className="mb-2" />}
      {label && !editing ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-body font-semibold">{label}</span>
          {canEdit && (
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              icon={<X />}
              aria-label="Etikett lösen"
              onClick={async () => (await confirm({ title: 'Etikett vom Element lösen?', text: 'Der Aufkleber kann danach einem anderen Element zugeordnet werden.', confirmLabel: 'Lösen' })) && save.mutate(null)}
            >
              Lösen
            </Button>
          )}
        </div>
      ) : canEdit ? (
        editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) save.mutate(value.trim());
            }}
          >
            <Input autoFocus aria-label="Etikett-Code" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Etikett-Code" className="font-mono uppercase" />
            <Button loading={save.isPending}>Zuordnen</Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" className="-ml-3" icon={<Link2 />} onClick={() => setEditing(true)}>
            Etikett zuordnen
          </Button>
        )
      ) : (
        <p className="text-body text-ink-4">Keins</p>
      )}
    </div>
  );
}

/** Ziel der QR-Codes: /e/:code → Elementseite. Unbekannte Etiketten lassen sich zuordnen. */
export function AssetByCode() {
  const { code = '' } = useParams();
  const q = useQuery({ queryKey: ['by-code', code], queryFn: () => api<{ id: string }>(`/assets/by-code/${encodeURIComponent(code)}`), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.data) return <Navigate to={`/elemente/${q.data.id}`} replace />;
  if (!(q.error instanceof ApiError && q.error.status === 404)) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  return <UnknownLabel code={code.toUpperCase()} />;
}

function UnknownLabel({ code }: { code: string }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useMe();
  const assets = useAssets({ q: q.trim() || undefined });
  const assign = useAction(
    (assetId: string) => api(`/assets/${assetId}/label`, { method: 'PUT', body: { labelCode: code } }),
    (_, assetId) => {
      toast(`Etikett ${code} zugeordnet`);
      navigate(`/elemente/${assetId}`, { replace: true });
    },
  );
  const free = (assets.data ?? []).filter((a) => !a.labelCode).slice(0, 8);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Etikett ${code}`} subtitle="Dieses Etikett ist noch keinem Element zugeordnet." />
      {assign.error && <ErrorBox error={assign.error} className="mb-4" />}
      <Surface>
        {me?.user.canCreate !== false && (
          <Section title="Neu anlegen" flush>
            <List plain>
              <ListRow
                to={`/elemente?neu=1&etikett=${encodeURIComponent(code)}`}
                leading={<Plus />}
                title="Neues Element mit diesem Etikett"
                subtitle="Element anlegen, Etikett ist gleich verknüpft"
                chevron
              />
            </List>
          </Section>
        )}
        <Section title="Vorhandenem Element zuordnen" flush>
          <div className="px-(--row-px) pb-3">
            <SearchField value={q} onChange={setQ} placeholder="Code, Standort …" className="sm:max-w-none" />
          </div>
          {assets.isLoading ? (
            <Spinner className="py-8" />
          ) : !free.length ? (
            <p className="px-(--row-px) pb-3 text-body text-ink-2">Keine passenden Elemente ohne Etikett.</p>
          ) : (
            <List plain aria-label="Elemente ohne Etikett">
              {free.map((a) => (
                <ListRow
                  key={a.id}
                  onClick={() => assign.mutate(a.id)}
                  leading={<CategoryIcon category={a.category} size="sm" />}
                  title={<span className="font-medium">{a.code}</span>}
                  subtitle={[a.location, a.buildingName, a.propertyName].filter(Boolean).join(' · ')}
                  trailing={<span className="text-meta text-ink-2">Zuordnen</span>}
                />
              ))}
            </List>
          )}
        </Section>
      </Surface>
    </div>
  );
}

