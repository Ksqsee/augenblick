// Element: Prüfarten, Mängel, Verlauf, Dateien; rechts Eigenschaften, QR/Etikett, Plan, „Als Nächstes hier“.
// Vorlage „Detail“ (docs/design.md 5.2), Belege: docs/design/objekte-elemente.md
import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Link2, Map, Paperclip, Pencil, Plus, QrCode, RotateCcw, Trash2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { INSPECTION_PURPOSES, kindLabel } from '../../shared/catalog';
import { effectiveInterval } from '../../shared/intervals';
import { api, ApiError, type Asset, type AssetDetail, type Attachment, downscale, fileUrl, queryClient, uploadBlob, useAction, useAsset, useAssets, useMe } from '../api';
import { scheduleLabel, schedulesFor } from '../categories';
import { useStartInspection } from '../components/AssetDrawer';
import { CategoryIcon } from '../components/CategoryIcon';
import { AssetForm, attributeRows } from '../components/forms';
import { AssetStatusBadge, dueInfo, nextScheduleName } from '../components/objects/status';
import {
  Badge,
  Button,
  Card,
  Empty,
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
  SectionHeader,
  SeverityBadge,
  Spinner,
  Timeline,
  type TimelineItem,
  toneText,
  useConfirm,
  useToast,
} from '../components/ui';
import { MiniPlan } from './FloorPlan';
import { assetDue, categoryLabel, fmtDate, fmtDateTime, RESULT_META } from '../format';

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

const toneClass = (t: string) => (t === 'bad' || t === 'warn' ? toneText[t] : 'text-ink-3');

/** Kleine Karte im Seitenpanel. */
function SideCard({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-4 sm:p-5 ${className ?? ''}`}>
      <div className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-meta font-semibold text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

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
        title={
          <span className="flex items-center gap-3">
            <CategoryIcon category={a.category} />
            <span className="truncate">{a.code}</span>
          </span>
        }
        subtitle={`${def.label} · ${[a.location, a.floor].filter(Boolean).join(' · ') || 'Ohne Standort'}`}
        meta={
          <>
            <AssetStatusBadge asset={a} />
            {(d.short || sched) && <span className={`text-meta ${toneClass(d.tone)}`}>{[d.short, sched].filter(Boolean).join(' · ')}</span>}
            {openDefects.length > 0 && <Badge tone="brand">{openDefects.length === 1 ? '1 offener Mangel' : `${openDefects.length} offene Mängel`}</Badge>}
          </>
        }
        actions={
          <>
            {canInspect && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <div className="lg:col-start-2 lg:row-start-1">
          <SideCard title="Eigenschaften">
            <PropertyList
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
                    <span className="flex flex-wrap items-center gap-2">
                      {fmtDate(a.lastInspectedAt)}
                      {a.lastResult && <ResultBadge result={a.lastResult} />}
                    </span>
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
          </SideCard>
        </div>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <IntervalSection asset={a} canEdit={isAdmin} />
          <SchedulesSection asset={a} canEdit={!!canInspect} onStart={(schedule) => start.mutate({ assetId: a.id, schedule })} />

          <section>
            <SectionHeader title="Offene Mängel" count={openDefects.length} action={openDefects.length > 0 && <Link to="/maengel" className="text-meta font-medium text-ink-2 hover:text-ink">Alle Mängel</Link>} />
            {openDefects.length === 0 ? (
              <Card className="flex items-center gap-3 px-4 py-3.5 text-body text-ink-3">
                <CheckCircle2 className="size-4 shrink-0 text-ok" />
                Keine offenen Mängel.
              </Card>
            ) : (
              <List aria-label="Offene Mängel">
                {openDefects.map((x) => (
                  <ListRow key={x.id} title={x.title} subtitle={x.note || undefined} meta={fmtDate(x.createdAt)} trailing={<SeverityBadge severity={x.severity} />} />
                ))}
              </List>
            )}
          </section>

          <section>
            <SectionHeader title="Verlauf" count={a.inspections.length} />
            <Card className="p-4 sm:p-5">
              {a.inspections.length === 0 && a.defects.length === 0 ? (
                <Empty compact icon={<ClipboardCheck />} title="Noch nicht geprüft" text="Die erste Prüfung legt den nächsten Termin fest." />
              ) : (
                <Timeline items={history(a, me?.tenant.inspectionKinds)} />
              )}
            </Card>
          </section>

          <AttachmentsSection assetId={a.id} items={a.attachments ?? []} canEdit={!!canInspect} />
        </div>

        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-start-2">
          {attrs.length > 0 && (
            <SideCard title="Stammdaten">
              <PropertyList items={attrs.map(([label, value]) => ({ label, value: value === '–' ? null : value }))} />
            </SideCard>
          )}
          <NextHere asset={a} />
          <SideCard
            title="QR-Code"
            action={
              <Link to={`/druck/etiketten?ids=${a.id}`} className="text-meta font-medium text-ink-2 hover:text-ink">
                Drucken
              </Link>
            }
          >
            <div className="flex items-center gap-4">
              <div className="shrink-0 rounded-lg bg-surface p-1 ring-1 ring-line">
                <QrImage code={a.code} size={96} />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-body font-semibold">{a.code}</p>
                <p className="mt-0.5 text-meta text-ink-3">Scannen öffnet dieses Element.</p>
              </div>
            </div>
            <LabelRow assetId={a.id} label={a.labelCode} canEdit={!!canInspect} />
          </SideCard>
          {a.floorPlan && a.markerX != null && a.markerY != null ? (
            <SideCard title="Grundriss">
              <MiniPlan plan={a.floorPlan} x={a.markerX} y={a.markerY} />
            </SideCard>
          ) : (
            <Card className="flex items-center gap-3 p-4">
              <Map className="size-4 shrink-0 text-ink-3" />
              <span className="flex-1 text-meta text-ink-3">Nicht auf einem Grundriss</span>
              <Link to={`/objekte/${a.propertyId}?tab=grundrisse`} className="text-meta font-medium text-ink-2 hover:text-ink">
                Platzieren
              </Link>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

/** Prüfungen und Mängel als ein Verlauf, neueste zuerst. */
function history(a: AssetDetail, kinds?: Parameters<typeof kindLabel>[1]): TimelineItem[] {
  const items: (TimelineItem & { at: number })[] = [];
  for (const i of a.inspections) {
    const at = i.inspectedAt ?? i.createdAt;
    const tone = i.status === 'draft' ? 'info' : i.result ? RESULT_META[i.result].tone : undefined;
    items.push({
      id: i.id,
      at,
      tone,
      icon: <ClipboardCheck />,
      title: (
        <Link to={i.status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`} className="font-medium hover:underline">
          {i.status === 'draft' ? 'Prüfung begonnen' : scheduleLabel(a.category, i.schedule ?? 'main')}
        </Link>
      ),
      time: fmtDateTime(at),
      meta: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {i.inspector} · {(i.kinds?.length ? i.kinds : [i.kind]).map((k) => kindLabel(k, kinds)).join(', ')}
          </span>
          {i.supersededAt ? (
            <Badge size="sm">Berichtigt</Badge>
          ) : i.status === 'draft' ? (
            <Badge size="sm" tone="info">
              Entwurf
            </Badge>
          ) : (
            i.result && <ResultBadge result={i.result} />
          )}
          {i.purpose && i.purpose !== 'regular' && <Badge size="sm">{INSPECTION_PURPOSES[i.purpose]}</Badge>}
          {i.archivedAt && <Badge size="sm">Archiv</Badge>}
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
    <Card className="overflow-hidden">
      <div className="px-4 pt-4 pb-2 sm:px-5">
        <h2 className="text-meta font-semibold text-ink-2">Als Nächstes in {asset.buildingName}</h2>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {next.map((x) => {
          const d = dueInfo(x);
          return (
            <ListRow
              key={x.id}
              to={`/elemente/${x.id}`}
              aria-label={`Nächstes Element ${x.code}`}
              leading={<CategoryIcon category={x.category} size="sm" />}
              title={
                <>
                  {x.code} <span className="font-normal text-ink-3">{x.location || categoryLabel(x.category)}</span>
                </>
              }
              subtitle={d.detail}
              tone={d.tone === 'bad' || d.tone === 'warn' ? d.tone : undefined}
              chevron
            />
          );
        })}
      </ul>
    </Card>
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
    for (const k of ['asset', 'intervals', 'smart', 'assets', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [k] });
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
    <section aria-label="Prüfintervall">
      {(reset.error || apply.error) && <ErrorBox error={reset.error ?? apply.error} className="mb-3" />}
      <Card className="divide-y divide-line">
        {adapted.map(({ s, st }) => (
          <div key={s.key} data-interval={s.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-body">
              <span className="font-medium">
                Intervall angepasst: {effectiveInterval(s.intervalMonths, st)} statt {s.intervalMonths} Monate
              </span>
              {multi && <span className="text-ink-3"> · {s.label}</span>}
              {st?.intervalAt && <span className="block text-meta text-ink-3">seit {fmtDate(st.intervalAt)} wegen wiederholter Mängel</span>}
            </p>
            {canEdit && (
              <Button size="sm" variant="ghost" icon={<RotateCcw />} loading={reset.isPending} onClick={() => reset.mutate(s.key)}>
                Zurücksetzen
              </Button>
            )}
          </div>
        ))}
        {suggestions.map((g) => (
          <div key={`${g.schedule}-${g.kind}`} data-interval-suggestion={g.schedule} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-body">
              <span className="font-medium">Vorschlag: {g.text}</span>
              {multi && <span className="text-ink-3"> · {g.scheduleLabel}</span>}
              <span className="block text-meta text-ink-3">
                {g.kind === 'shorten' ? 'Die letzten zwei Prüfungen hatten Mängel.' : 'Die letzten vier Prüfungen waren ohne Mängel.'}
              </span>
            </p>
            {canEdit && (
              <Button size="sm" variant="secondary" loading={apply.isPending} onClick={() => apply.mutate(g)}>
                Übernehmen
              </Button>
            )}
          </div>
        ))}
      </Card>
    </section>
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
    <section>
      {confirmEl}
      <SectionHeader title="Prüfarten" meta="Jede mit eigenem Intervall und Termin" />
      {save.error && <ErrorBox error={save.error} className="mb-3" />}
      <Card className="divide-y divide-line">
        {list.map((s) => {
          const st = asset.schedules?.[s.key];
          const on = s.key === 'main' || !!st?.enabled;
          const state = { nextDueAt: s.key === 'main' && st?.lastAt == null && st?.nextDueAt == null ? null : (st?.nextDueAt ?? null), lastResult: st?.lastResult ?? null };
          const info = dueInfo(state);
          return (
            <div key={s.key} className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">
                  {s.label} <span className="font-normal text-ink-3">· alle {effectiveInterval(s.intervalMonths, st)} Monate</span>
                </p>
                <p className="text-meta text-ink-3">
                  {on ? (
                    <>
                      <span className={toneClass(info.tone)}>{info.detail}</span>
                      {st?.lastAt ? ` · zuletzt ${fmtDate(st.lastAt)}` : ''}
                    </>
                  ) : (
                    'Für dieses Element nicht aktiv'
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {on && <AssetStatusBadge asset={state} />}
                {canEdit && on && (
                  <Button size="sm" variant="secondary" onClick={() => onStart(s.key)}>
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
                      className="flex items-center gap-2"
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
            </div>
          );
        })}
      </Card>
    </section>
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
    <section>
      {confirmEl}
      <SectionHeader
        title="Fotos & Dokumente"
        count={items.length}
        action={
          canEdit && (
            <Button size="sm" variant="secondary" loading={busy} icon={<Paperclip />} onClick={() => ref.current?.click()}>
              Hinzufügen
            </Button>
          )
        }
      />
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
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => ref.current?.click()}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3.5 text-left text-body text-ink-3 transition-colors enabled:hover:bg-hover"
        >
          <Paperclip className="size-4 shrink-0" />
          {canEdit ? 'Fotos, Zulassungen oder Datenblätter (PDF) hinzufügen' : 'Noch keine Dateien.'}
        </button>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((f) => (
            <li key={f.id} className="group relative overflow-hidden rounded-xl bg-surface shadow-card">
              <a href={fileUrl(f.fileKey)} target="_blank" rel="noreferrer" className="block">
                {f.contentType.startsWith('image/') ? (
                  <img src={fileUrl(f.fileKey)} alt={f.caption || f.name} className="aspect-[4/3] w-full bg-sunken object-cover" loading="lazy" />
                ) : (
                  <span className="grid aspect-[4/3] place-items-center bg-sunken text-ink-3">
                    <FileText className="size-8" />
                  </span>
                )}
                <span className="block px-3 py-2">
                  <span className="block truncate text-meta font-medium">{f.caption || f.name}</span>
                  <span className="block truncate text-caption text-ink-3">
                    {f.inspectionId ? 'aus Prüfung · ' : ''}
                    {fmtDate(f.createdAt)}
                    {f.size ? ` · ${fmtSize(f.size)}` : ''}
                  </span>
                </span>
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={async () => (await confirm({ title: `„${f.caption || f.name}“ entfernen?`, confirmLabel: 'Entfernen', danger: true })) && del.mutate(f.id)}
                  className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-ink/75 text-white transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label="Entfernen"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <div className="mt-4 border-t border-line pt-4">
      {confirmEl}
      <p className="mb-2 text-meta text-ink-3">Vorgedrucktes Etikett</p>
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
          <Button size="sm" variant="secondary" icon={<Link2 />} onClick={() => setEditing(true)}>
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
    <div className="mx-auto max-w-lg">
      <PageHeader title={`Etikett ${code}`} subtitle="Dieses Etikett ist noch keinem Element zugeordnet." />
      {assign.error && <ErrorBox error={assign.error} className="mb-4" />}
      <div className="flex flex-col gap-8">
        {me?.user.canCreate !== false && (
          <Link to={`/elemente?neu=1&etikett=${encodeURIComponent(code)}`} className="group flex items-center gap-3 rounded-xl bg-surface p-4 shadow-card transition-shadow hover:shadow-lift">
            <span className="grid size-10 place-items-center rounded-lg bg-ink text-white">
              <Plus className="size-5" />
            </span>
            <span>
              <span className="block text-body font-semibold">Neues Element mit diesem Etikett</span>
              <span className="block text-meta text-ink-3">Element anlegen, Etikett ist gleich verknüpft</span>
            </span>
          </Link>
        )}
        <section>
          <SectionHeader title="Vorhandenem Element zuordnen" />
          <SearchField value={q} onChange={setQ} placeholder="Code, Standort …" className="mb-3 sm:max-w-none" />
          {assets.isLoading ? (
            <Spinner className="py-8" />
          ) : (
            <List aria-label="Elemente ohne Etikett">
              {free.map((a) => (
                <ListRow
                  key={a.id}
                  onClick={() => assign.mutate(a.id)}
                  leading={<CategoryIcon category={a.category} size="sm" />}
                  title={a.code}
                  subtitle={[a.location, a.buildingName, a.propertyName].filter(Boolean).join(' · ')}
                  trailing={<Link2 className="size-4 text-ink-3" />}
                />
              ))}
              {!free.length && <li className="px-4 py-3 text-body text-ink-3">Keine passenden Elemente ohne Etikett.</li>}
            </List>
          )}
        </section>
      </div>
    </div>
  );
}
