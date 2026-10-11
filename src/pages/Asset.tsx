import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, FileText, Link2, Map, Paperclip, Pencil, Plus, QrCode, Search, Tag, Trash2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { INSPECTION_PURPOSES, kindLabel, SEVERITIES } from '../../shared/catalog';
import { api, ApiError, type AssetDetail, type Attachment, downscale, fileUrl, queryClient, uploadBlob, useAction, useAsset, useAssets, useMe } from '../api';
import { summarizeSchedules } from '../../shared/logic';
import { scheduleLabel, schedulesFor } from '../categories';
import { useStartInspection } from '../components/AssetDrawer';
import { DueBadge } from '../components/AssetList';
import { CategoryIcon } from '../components/CategoryIcon';
import { AssetForm, attributeRows } from '../components/forms';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Input, KeyValue, PageHeader, Spinner, useToast } from '../components/ui';
import { MiniPlan } from './FloorPlan';
import { fmtDate, fmtDateTime, RESULT_META } from '../format';

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

export function AssetPage() {
  const { id = '' } = useParams();
  const { data: a, isLoading, error } = useAsset(id);
  const { data: me } = useMe();
  const start = useStartInspection();
  const navigate = useNavigate();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const del = useAction(
    () => api(`/assets/${id}`, { method: 'DELETE' }),
    () => {
      toast('Element gelöscht');
      navigate('/elemente');
    },
  );
  if (isLoading) return <Spinner />;
  if (error || !a) return <ErrorBox error={error} />;
  const def = getCategory(a.category);
  const canInspect = me?.user.role !== 'viewer';
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const draft = a.inspections.find((i) => i.status === 'draft');

  return (
    <>
      <PageHeader
        back={
          <Link to={`/objekte/${a.propertyId}`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> {a.propertyName} · {a.buildingName}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <CategoryIcon category={a.category} />
            {a.code}
          </span>
        }
        subtitle={`${def.label} · ${[a.location, a.floor].filter(Boolean).join(' · ') || 'Kein Standort'}`}
        actions={
          <>
            {canInspect && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
                Bearbeiten
              </Button>
            )}
            {isAdmin && (
              <Button variant="secondary" aria-label="Löschen" onClick={() => confirm(`${a.code} löschen?`) && del.mutate(undefined)}>
                <Trash2 className="size-4" />
              </Button>
            )}
            {canInspect && (
              <Button icon={<ClipboardCheck className="size-4" />} loading={start.isPending} onClick={() => start.mutate(a.id)}>
                {draft ? 'Entwurf fortsetzen' : 'Prüfung starten'}
              </Button>
            )}
          </>
        }
      />
      {edit && <AssetForm initial={a} onClose={() => setEdit(false)} />}
      {start.error && <ErrorBox error={start.error} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-ink-3">Status</p>
              <div className="mt-2">
                <DueBadge asset={a} />
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-ink-3">Letzte Prüfung</p>
              <p className="mt-1.5 text-sm font-semibold">{fmtDate(a.lastInspectedAt)}</p>
              {a.lastResult && <p className="text-xs text-ink-3">{RESULT_META[a.lastResult].label}</p>}
            </Card>
            <Card className="p-4">
              <p className="text-xs text-ink-3">Nächste Prüfung</p>
              <p className="mt-1.5 text-sm font-semibold">{fmtDate(a.nextDueAt)}</p>
              <p className="text-xs text-ink-3">
                {a.schedules && summarizeSchedules(a.schedules).nextKey ? scheduleLabel(a.category, summarizeSchedules(a.schedules).nextKey!) : `Intervall ${def.intervalMonths} Monate`}
              </p>
            </Card>
          </div>

          <SchedulesCard asset={a} canEdit={!!canInspect} onStart={(schedule) => start.mutate({ assetId: a.id, schedule })} />

          <Card>
            <CardHeader title="Offene Mängel" />
            {a.defects.filter((d) => d.status === 'open').length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-3">Keine offenen Mängel.</p>
            ) : (
              <ul className="divide-y divide-line">
                {a.defects
                  .filter((d) => d.status === 'open')
                  .map((d) => (
                    <li key={d.id} className="flex items-start gap-3 px-5 py-3">
                      <Badge tone={d.severity === 'critical' || d.severity === 'high' ? 'bad' : 'warn'}>{SEVERITIES[d.severity]}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{d.title}</p>
                        {d.note && <p className="text-xs text-ink-3">{d.note}</p>}
                      </div>
                      <span className="text-xs text-ink-3">{fmtDate(d.createdAt)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Prüfhistorie" />
            {a.inspections.length === 0 ? (
              <Empty icon={<ClipboardCheck className="size-5" />} title="Noch nicht geprüft" />
            ) : (
              <ul className="divide-y divide-line">
                {a.inspections.map((i) => (
                  <li key={i.id}>
                    <Link
                      to={i.status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60"
                    >
                      <FileText className="size-4 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {scheduleLabel(a.category, i.schedule ?? 'main')}{' '}
                          <span className="font-normal text-ink-3">
                            · {(i.kinds?.length ? i.kinds : [i.kind]).map((k) => kindLabel(k, me?.tenant.inspectionKinds)).join(', ')}
                          </span>
                        </span>
                        <span className="block text-xs text-ink-3">
                          {fmtDateTime(i.inspectedAt ?? i.createdAt)} · {i.inspector}
                        </span>
                      </span>
                      {i.archivedAt && <Badge>Archiv</Badge>}
                      {i.purpose && i.purpose !== 'regular' && <Badge>{INSPECTION_PURPOSES[i.purpose]}</Badge>}
                      {i.supersededAt ? (
                        <Badge>Berichtigt</Badge>
                      ) : i.status === 'draft' ? <Badge tone="info">Entwurf</Badge> : i.result && <Badge tone={RESULT_META[i.result].tone}>{RESULT_META[i.result].label}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <AttachmentsCard assetId={a.id} items={a.attachments ?? []} canEdit={!!canInspect} />
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col items-center p-5">
            <QrImage code={a.code} size={150} />
            <p className="mt-2 font-mono text-sm font-semibold">{a.code}</p>
            <Link to={`/druck/etiketten?ids=${a.id}`} className="mt-3 w-full">
              <Button variant="secondary" size="sm" className="w-full" icon={<QrCode className="size-3.5" />}>
                Etikett drucken
              </Button>
            </Link>
          </Card>
          <LabelCard assetId={a.id} label={a.labelCode} canEdit={canInspect} />
          {a.floorPlan && a.markerX != null && a.markerY != null ? (
            <MiniPlan plan={a.floorPlan} x={a.markerX} y={a.markerY} />
          ) : (
            <Card className="flex items-center gap-2 p-4 text-sm text-ink-3">
              <Map className="size-4" /> Nicht auf einem Grundriss platziert
              <Link to={`/objekte/${a.propertyId}?tab=grundrisse`} className="ml-auto text-xs font-medium text-ink-2 hover:underline">
                Pläne
              </Link>
            </Card>
          )}
          <Card className="px-4 py-1">
            <KeyValue
              items={[
                ['Hersteller', a.manufacturer],
                ['Typ', a.model],
                ...attributeRows(a.category, a.attributes),
              ]}
            />
          </Card>
        </aside>
      </div>
    </>
  );
}

function SchedulesCard({ asset, canEdit, onStart }: { asset: AssetDetail; canEdit: boolean; onStart: (key: string) => void }) {
  const toast = useToast();
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
    <Card>
      <CardHeader title="Prüfarten" subtitle="Jede Prüfart hat ein eigenes Intervall und einen eigenen Termin" />
      {save.error && (
        <div className="px-5 pt-3">
          <ErrorBox error={save.error} />
        </div>
      )}
      <ul className="divide-y divide-line">
        {list.map((s) => {
          const st = asset.schedules?.[s.key];
          const on = s.key === 'main' || !!st?.enabled;
          return (
            <li key={s.key} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {s.label} <span className="font-normal text-ink-3">· alle {s.intervalMonths} Monate</span>
                </p>
                <p className="text-xs text-ink-3">
                  {on ? `Zuletzt ${fmtDate(st?.lastAt ?? null)} · nächste ${fmtDate(st?.nextDueAt ?? null)}` : 'Nicht aktiv für dieses Element'}
                </p>
              </div>
              {on && <DueBadge asset={{ nextDueAt: s.key === 'main' && st?.lastAt == null && st?.nextDueAt == null ? null : (st?.nextDueAt ?? null), lastResult: st?.lastResult ?? null }} />}
              {canEdit && (
                <div className="flex gap-2">
                  {on && (
                    <Button size="sm" variant="secondary" onClick={() => onStart(s.key)}>
                      Prüfen
                    </Button>
                  )}
                  {s.key !== 'main' &&
                    (on ? (
                      <Button size="sm" variant="ghost" onClick={() => confirm(`${s.label} für dieses Element deaktivieren?`) && save.mutate({ key: s.key, enabled: false })}>
                        Deaktivieren
                      </Button>
                    ) : enabling === s.key ? (
                      <div className="flex items-center gap-2">
                        <Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className="h-8 w-40" aria-label="Erster Termin" />
                        <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ key: s.key, enabled: true, nextDueAt: new Date(`${first}T12:00:00`).getTime() })}>
                          OK
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setEnabling(s.key)}>
                        Aktivieren
                      </Button>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const fmtSize = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function AttachmentsCard({ assetId, items, canEdit }: { assetId: string; items: Attachment[]; canEdit: boolean }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const del = useAction((id: string) => api(`/attachments/${id}`, { method: 'DELETE' }), () => toast('Entfernt'));
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
    <Card>
      <CardHeader
        title="Fotos & Dokumente"
        subtitle="Bilder, Zulassungen, Datenblätter (PDF)"
        action={
          canEdit && (
            <Button size="sm" variant="secondary" loading={busy} icon={<Paperclip className="size-3.5" />} onClick={() => ref.current?.click()}>
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
      {!!error && (
        <div className="px-5 pt-3">
          <ErrorBox error={error} />
        </div>
      )}
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-3">Noch keine Dateien.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          {items.map((f) => (
            <li key={f.id} className="group relative overflow-hidden rounded-lg border border-line">
              <a href={fileUrl(f.fileKey)} target="_blank" rel="noreferrer" className="block">
                {f.contentType.startsWith('image/') ? (
                  <img src={fileUrl(f.fileKey)} alt={f.caption || f.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid aspect-[4/3] place-items-center bg-sunken text-ink-3">
                    <FileText className="size-8" />
                  </span>
                )}
                <span className="block truncate px-2 py-1.5 text-xs">
                  {f.caption || f.name}
                  <span className="block text-[11px] text-ink-3">
                    {f.inspectionId ? 'aus Prüfung · ' : ''}
                    {fmtDate(f.createdAt)}
                    {f.size ? ` · ${fmtSize(f.size)}` : ''}
                  </span>
                </span>
              </a>
              {canEdit && (
                <button
                  onClick={() => confirm(`„${f.caption || f.name}“ entfernen?`) && del.mutate(f.id)}
                  className="absolute top-1.5 right-1.5 hidden size-7 place-items-center rounded-full bg-ink/80 text-white group-hover:grid"
                  aria-label="Entfernen"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LabelCard({ assetId, label, canEdit }: { assetId: string; label: string | null; canEdit: boolean }) {
  const toast = useToast();
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
    <Card className="p-4">
      <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        <Tag className="size-4 text-ink-3" /> Vorgedrucktes Etikett
      </p>
      {save.error && <ErrorBox error={save.error} />}
      {label && !editing ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{label}</span>
          {canEdit && (
            <Button size="sm" variant="ghost" className="ml-auto" aria-label="Etikett lösen" onClick={() => confirm('Etikett vom Element lösen?') && save.mutate(null)}>
              <X className="size-3.5" />
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
            <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Etikett-Code" className="font-mono uppercase" />
            <Button size="md" loading={save.isPending}>
              OK
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="secondary" icon={<Link2 className="size-3.5" />} onClick={() => setEditing(true)}>
            Etikett zuordnen
          </Button>
        )
      ) : (
        <p className="text-sm text-ink-3">Keins</p>
      )}
    </Card>
  );
}

/** Ziel der QR-Codes: /e/:code → Elementseite. Unbekannte Etiketten lassen sich zuordnen. */
export function AssetByCode() {
  const { code = '' } = useParams();
  const q = useQuery({ queryKey: ['by-code', code], queryFn: () => api<{ id: string }>(`/assets/by-code/${encodeURIComponent(code)}`), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.data) return <Navigate to={`/elemente/${q.data.id}`} replace />;
  if (!(q.error instanceof ApiError && q.error.status === 404)) return <ErrorBox error={q.error} />;
  return <UnknownLabel code={code.toUpperCase()} />;
}

function UnknownLabel({ code }: { code: string }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
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
      {assign.error && <ErrorBox error={assign.error} />}
      <div className="flex flex-col gap-4">
        <Link to={`/elemente?neu=1&etikett=${encodeURIComponent(code)}`}>
          <Card className="flex items-center gap-3 p-4 hover:border-line-strong">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-strong">
              <Plus className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Neues Element mit diesem Etikett</span>
              <span className="block text-xs text-ink-3">Element anlegen und Etikett direkt verknüpfen</span>
            </span>
          </Card>
        </Link>
        <Card>
          <CardHeader title="Vorhandenem Element zuordnen" />
          <div className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <Input className="pl-9" placeholder="Code, Standort …" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {free.map((a) => (
              <li key={a.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken" onClick={() => assign.mutate(a.id)}>
                  <CategoryIcon category={a.category} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.code}</span>
                    <span className="block truncate text-xs text-ink-3">{[a.location, a.buildingName, a.propertyName].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Link2 className="size-4 text-ink-3" />
                </button>
              </li>
            ))}
            {!free.length && <li className="px-4 py-3 text-sm text-ink-3">Keine passenden Elemente ohne Etikett.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
