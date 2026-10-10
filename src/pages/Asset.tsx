import { ArrowLeft, ClipboardCheck, FileText, Pencil, QrCode, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CATEGORIES, INSPECTION_KINDS, SEVERITIES } from '../../shared/catalog';
import { api, ApiError, useAction, useAsset, useMe } from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { DueBadge } from '../components/AssetList';
import { CategoryIcon } from '../components/CategoryIcon';
import { AssetForm, attributeRows } from '../components/forms';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, KeyValue, PageHeader, Spinner, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, RESULT_META } from '../format';
import { useQuery } from '@tanstack/react-query';

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
  const def = CATEGORIES[a.category];
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
          <div className="grid gap-3 sm:grid-cols-3">
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
              <p className="text-xs text-ink-3">Intervall {def.intervalMonths} Monate</p>
            </Card>
          </div>

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
                        <span className="block text-sm font-medium">{INSPECTION_KINDS[i.kind]}</span>
                        <span className="block text-xs text-ink-3">
                          {fmtDateTime(i.inspectedAt ?? i.createdAt)} · {i.inspector}
                        </span>
                      </span>
                      {i.status === 'draft' ? <Badge tone="info">Entwurf</Badge> : i.result && <Badge tone={RESULT_META[i.result].tone}>{RESULT_META[i.result].label}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
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

/** Ziel der QR-Codes: /e/:code → Elementseite. */
export function AssetByCode() {
  const { code = '' } = useParams();
  const q = useQuery({ queryKey: ['by-code', code], queryFn: () => api<{ id: string }>(`/assets/by-code/${encodeURIComponent(code)}`), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.data) return <Navigate to={`/elemente/${q.data.id}`} replace />;
  return (
    <Card>
      <Empty
        icon={<QrCode className="size-5" />}
        title={`Code ${code} nicht gefunden`}
        text={q.error instanceof ApiError && q.error.status === 404 ? 'Dieser Code gehört zu keinem Element in deinem Workspace.' : undefined}
        action={
          <Link to={`/elemente?neu=1`}>
            <Button>Element anlegen</Button>
          </Link>
        }
      />
    </Card>
  );
}
