import clsx from 'clsx';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  DatabaseBackup,
  Download,
  Eye,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Footprints,
  QrCode,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { kindLabel, SEVERITIES } from '../../shared/catalog';
import type { Result } from '../../shared/logic';
import { api, archiveReport, type Asset, type Defect, type PropertyRow, type ReportRow, useAction, useAssets, useDefects, useInspections, useMe, useMembers, useProperties, useReports } from '../api';
import { describeFilter, EMPTY_FILTER, filterParams, type InspectionFilter, InspectionFilters } from '../components/InspectionFilters';
import { type MonthlyStatus, runMonthlyReports } from '../automation';
import { DueBadge } from '../components/AssetList';
import { APP_NAME } from '../components/Logo';
import { PropertyReportButton } from '../components/PropertyReportButton';
import {
  Button,
  Card,
  Chip,
  Empty,
  ErrorBox,
  IconButton,
  Input,
  ListGroup,
  PageHeader,
  RowIcon,
  SectionHeader,
  Segmented,
  Select,
  SkeletonList,
  Spinner,
  StatusDot,
  useConfirm,
  useToast,
} from '../components/ui';
import { categoryLabel, fmtDate, fmtDateTime, RESULT_META } from '../format';
import { QrImage } from './Asset';
import { PrintFrame } from './Protocol';

/** Zeile eines Standardberichts: Symbol, Titel, ein Satz – Aktionen rechts (Handy: darunter). */
function ReportRowItem({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3 md:items-center">
        <RowIcon>{icon}</RowIcon>
        <div className="min-w-0">
          <p className="text-body font-medium">{title}</p>
          <p className="mt-0.5 text-meta text-ink-3">{text}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 max-md:pl-12">{children}</div>
    </li>
  );
}

const LinkButton = ({ to, children, icon }: { to: string; children: ReactNode; icon?: ReactNode }) => (
  <Link to={to}>
    <Button variant="ghost" icon={icon} tabIndex={-1}>
      {children}
    </Button>
  </Link>
);

export function ReportsPage() {
  const { data: props } = useProperties();
  const [propId, setPropId] = useState('');
  const pid = propId || props?.[0]?.id;
  return (
    <>
      <PageHeader title="Berichte" subtitle="Nachweise für Betreiber, Behörden und Versicherer" />
      <div className="flex flex-col gap-8 lg:gap-10">
        <ReportBuilder />

        <section>
          <SectionHeader title="Standardberichte" meta="Landen automatisch im Archiv" />
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              <ListGroup title="Als PDF" />
              <ReportRowItem icon={<ShieldCheck />} title="Compliance-Übersicht" text="Prüfstatus aller Objekte mit überfälligen und bald fälligen Elementen.">
                <LinkButton to="/druck/compliance" icon={<Eye />}>
                  Ansehen
                </LinkButton>
                <PdfButton kind="compliance" />
              </ReportRowItem>
              <ReportRowItem icon={<AlertTriangle />} title="Mängelbericht" text="Alle offenen Mängel nach Schwere sortiert, mit Fotos.">
                <LinkButton to="/druck/maengel" icon={<Eye />}>
                  Ansehen
                </LinkButton>
                <PdfButton kind="defects" />
              </ReportRowItem>
              <ReportRowItem icon={<Building2 />} title="Objektbericht" text="Ein Objekt komplett: Gebäude, Elemente mit Status, offene Mängel, Begehungen.">
                <Select aria-label="Objekt für den Objektbericht" className="min-w-0 flex-1 md:w-52 md:flex-none" value={pid ?? ''} onChange={(e) => setPropId(e.target.value)}>
                  {props?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <PropertyReportButton propertyId={pid} variant="secondary" label="PDF" />
              </ReportRowItem>
              <AnnualReportRow />
              <MonthlyReportsRow />

              <ListGroup title="Listen und Etiketten" />
              <ReportRowItem icon={<ClipboardList />} title="Elementliste" text="Alle Elemente mit Status und Terminen – bearbeitbar und über Import wieder einlesbar.">
                <a href="/api/export/assets.xlsx" download>
                  <Button variant="secondary" icon={<Download />} tabIndex={-1}>
                    Excel
                  </Button>
                </a>
                <a href="/api/export/assets.csv" download>
                  <Button variant="ghost" tabIndex={-1}>
                    CSV
                  </Button>
                </a>
              </ReportRowItem>
              <ReportRowItem icon={<QrCode />} title="QR-Etiketten" text="Etikettenbogen zum Aufkleben. Der Scan öffnet direkt das Element.">
                <LinkButton to="/druck/etiketten">Etiketten wählen</LinkButton>
              </ReportRowItem>

              <ListGroup title="Weitere Nachweise" />
              <ReportRowItem icon={<FileText />} title="Prüfprotokolle" text="Einzeln bei jeder Prüfung oder gesammelt als ZIP unter Prüfungen → Durchgeführt.">
                <LinkButton to="/pruefungen?tab=done">Zu den Prüfungen</LinkButton>
              </ReportRowItem>
              <ReportRowItem icon={<Footprints />} title="Begehungsprotokolle" text="Brandschutzbegehungen mit Feststellungen und Rechtsgrundlagen.">
                <LinkButton to="/begehungen">Zu den Begehungen</LinkButton>
              </ReportRowItem>
              <ReportRowItem icon={<DatabaseBackup />} title="JSON-Backup" text="Vollständige Sicherung aller Daten des Workspaces (ohne Passwörter).">
                <a href="/api/export/backup.json" download>
                  <Button variant="ghost" icon={<Download />} tabIndex={-1}>
                    Herunterladen
                  </Button>
                </a>
              </ReportRowItem>
              <ReportRowItem icon={<FileSpreadsheet />} title="Import" text="Bestandslisten aus Excel oder CSV übernehmen – mit Objekten und Gebäuden.">
                <LinkButton to="/import">Import öffnen</LinkButton>
              </ReportRowItem>
            </ul>
          </Card>
        </section>

        <ReportArchive />
      </div>
    </>
  );
}

const KIND_LABEL: Record<ReportRow['kind'], string> = {
  compliance: 'Compliance',
  defects: 'Mängel',
  property: 'Objekt',
  protocols: 'Protokolle',
  selection: 'Prüfbericht',
  annual: 'Jahresbericht',
};

/** Neuen Bericht aus gefilterten Prüfungen erstellen: Übersicht als PDF oder alle Protokolle als ZIP. */
function ReportBuilder() {
  const { data: me } = useMe();
  const toast = useToast();
  const [f, setF] = useState<InspectionFilter>({ ...EMPTY_FILTER, period: 'year' });
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading } = useInspections({ status: 'submitted', ...filterParams(f) });
  const props = useProperties();
  const members = useMembers();
  const rows = data ?? [];
  const counts = Object.fromEntries((['ok', 'defects', 'critical', 'not_inspectable'] as const).map((r) => [r, rows.filter((x) => x.result === r).length]));
  const description = () =>
    describeFilter(f, {
      property: props.data?.find((p) => p.id === f.propertyId)?.name,
      building: rows.find((r) => r.buildingId === f.buildingId)?.buildingName,
      inspector: members.data?.members.find((m) => m.id === f.inspectorId)?.name,
      category: f.category ? categoryLabel(f.category) : undefined,
      kind: f.kind ? kindLabel(f.kind, me?.tenant.inspectionKinds) : undefined,
    });
  const run = async (what: 'pdf' | 'zip') => {
    if (!me || !rows.length) return;
    setBusy(what);
    try {
      const r = await import('../pdf/reports');
      const date = new Date().toISOString().slice(0, 10);
      if (what === 'pdf') {
        const bytes = await r.selectionPdf(rows, description(), await r.loadBrand(me));
        const fileName = `Pruefbericht_${date}.pdf`;
        r.download(bytes, fileName);
        if (await archiveReport(me, bytes, { kind: 'selection', title: `Prüfbericht (${rows.length} Prüfungen)`, fileName, propertyId: f.propertyId || undefined }).catch(() => false)) toast('Im Berichtsarchiv gespeichert');
      } else {
        const bytes = await r.protocolsZip(rows.map((x) => x.id), me, (d, t) => setBusy(`${d}/${t}`));
        const fileName = `Pruefprotokolle_${date}.zip`;
        r.download(bytes, fileName, 'application/zip');
        await archiveReport(me, bytes, { kind: 'protocols', title: `${rows.length} Prüfprotokolle`, fileName, propertyId: f.propertyId || undefined }, 'application/zip').catch(() => false);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Bericht fehlgeschlagen', 'bad');
    } finally {
      setBusy(null);
    }
  };
  const split: [Result, string][] = [
    ['ok', 'ohne Mängel'],
    ['defects', 'mit Mängeln'],
    ['critical', 'kritisch'],
    ['not_inspectable', 'nicht prüfbar'],
  ];
  return (
    <section>
      <SectionHeader title="Neuen Bericht erstellen" />
      <Card className="overflow-hidden">
        <div className="p-4 sm:p-5">
          <p className="mb-4 max-w-2xl text-meta text-ink-3">Prüfungen nach Zeitraum, Objekt, Elementart, Ergebnis, Prüfer oder Art auswählen – als Übersicht (PDF) oder mit allen Protokollen (ZIP).</p>
          <InspectionFilters value={f} onChange={setF} />
        </div>
        <div className="flex flex-col gap-3 border-t border-line bg-canvas/60 px-4 py-3 sm:px-5 md:flex-row md:items-center">
          <div className="mr-auto min-w-0 text-body" aria-live="polite">
            {isLoading ? (
              <span className="text-ink-3">Zählt …</span>
            ) : (
              <>
                <span className="font-semibold tabular-nums">{rows.length} Prüfungen</span>
                {rows.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-3 md:mt-0 md:ml-3 md:inline-flex">
                    {split.map(([k, label]) => (
                      <span key={k} className={clsx('inline-flex items-center gap-1.5 tabular-nums', !counts[k] && 'text-ink-4')}>
                        <StatusDot tone={counts[k] ? RESULT_META[k].tone : 'muted'} />
                        {counts[k]} {label}
                      </span>
                    ))}
                  </span>
                )}
                {rows.length >= 1000 && <span className="ml-2 text-meta text-warn">auf 1000 begrenzt – Filter eingrenzen</span>}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<FileArchive />} disabled={!rows.length || !!busy} loading={!!busy && busy !== 'pdf'} onClick={() => run('zip')}>
              {busy && busy !== 'pdf' ? `PDF ${busy}` : 'Protokolle (ZIP)'}
            </Button>
            <Button icon={<Download />} disabled={!rows.length || !!busy} loading={busy === 'pdf'} onClick={() => run('pdf')}>
              Prüfbericht (PDF)
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}

/**
 * Monatsberichte (Autopilot monthly_report): je Objekt den Objektbericht erzeugen und archivieren – nur Admins ohne Einschränkung.
 * Der Vorschlag „Monatsberichte bereit“ verlinkt auf /berichte?monatsbericht=1; dann startet die Erzeugung sofort.
 */
function MonthlyReportsRow() {
  const { data: me } = useMe();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const admin = !!me && ['owner', 'admin'].includes(me.user.role) && !me.user.scoped;
  const status = useQuery({ queryKey: ['automation', 'monthly'], queryFn: () => api<MonthlyStatus>('/automation/monthly-report'), enabled: admin });
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const autoStart = params.get('monatsbericht') === '1';
  const started = useRef(false);
  const run = async () => {
    if (!me || started.current) return;
    started.current = true;
    setProgress([0, 0]);
    try {
      const r = await runMonthlyReports(me, (d, t) => setProgress([d, t]));
      toast(`${r.archived} Monatsberichte ${r.label} im Archiv`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Monatsberichte fehlgeschlagen', 'bad');
    } finally {
      started.current = false;
      setProgress(null);
      status.refetch();
    }
  };
  useEffect(() => {
    if (!autoStart || !status.data) return;
    setParams((p) => {
      p.delete('monatsbericht');
      return p;
    }, { replace: true });
    if (status.data.due) void run();
  }, [autoStart, status.data]);
  if (!admin || !status.data || status.data.mode === 'off') return null;
  const s = status.data;
  return (
    <ReportRowItem
      icon={<CalendarClock />}
      title="Monatsberichte"
      text={s.due ? `Objektberichte für ${s.label} – je Objekt ein PDF im Archiv.` : `Für ${s.label} bereits im Archiv. Der nächste Monat folgt zum Monatsanfang.`}
    >
      {progress && progress[1] > 0 && (
        <span className="text-meta text-ink-3 tabular-nums" aria-live="polite">
          {progress[0]} / {progress[1]}
        </span>
      )}
      <Button variant="secondary" icon={<FileArchive />} loading={!!progress} disabled={!s.due} onClick={() => void run()}>
        Monatsberichte erzeugen
      </Button>
    </ReportRowItem>
  );
}

/** Jahresbericht: Zusammenfassung eines Kalenderjahres je Objekt (Prüfungen, Mängel, Behebungsquote, Begehungen). */
function AnnualReportRow() {
  const { data: me } = useMe();
  const { data: props } = useProperties();
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [propertyId, setPropertyId] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <ReportRowItem icon={<CalendarRange />} title="Jahresbericht" text="Ein Jahr je Objekt: Prüfungen nach Ergebnis, Mängel mit Behebungsquote, Begehungen.">
      <Select aria-label="Jahr" className="!w-24 shrink-0" value={year} onChange={(e) => setYear(Number(e.target.value))}>
        {[0, 1, 2, 3, 4].map((n) => (
          <option key={n} value={thisYear - n}>
            {thisYear - n}
          </option>
        ))}
      </Select>
      <Select aria-label="Objekt für den Jahresbericht" className="min-w-0 flex-1 md:w-44 md:flex-none" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
        <option value="">Alle Objekte</option>
        {props?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        icon={<Download />}
        loading={busy}
        disabled={!me}
        onClick={async () => {
          if (!me) return;
          setBusy(true);
          try {
            const r = await import('../pdf/reports');
            const data = await api<import('../pdf/reports').AnnualData>(`/reports/annual?year=${year}${propertyId ? `&propertyId=${propertyId}` : ''}`);
            const bytes = await r.annualPdf(data, await r.loadBrand(me));
            const name = propertyId ? props?.find((p) => p.id === propertyId)?.name : undefined;
            const fileName = `Jahresbericht_${year}${name ? `_${name.replace(/[^\p{L}\p{N}]+/gu, '-')}` : ''}.pdf`;
            r.download(bytes, fileName);
            if (await archiveReport(me, bytes, { kind: 'annual', title: `Jahresbericht ${year}${name ? ` ${name}` : ''}`, fileName, propertyId: propertyId || undefined }).catch(() => false))
              toast('Im Berichtsarchiv gespeichert');
          } catch (e) {
            toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
          } finally {
            setBusy(false);
          }
        }}
      >
        PDF
      </Button>
    </ReportRowItem>
  );
}
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Erstellte Berichte – bleiben gespeichert und lassen sich später erneut herunterladen. */
function ReportArchive() {
  const { data, isLoading, error, refetch } = useReports();
  const { data: me } = useMe();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [kind, setKind] = useState<'' | ReportRow['kind']>('');
  const [limit, setLimit] = useState(15);
  const del = useAction((id: string) => api(`/reports/${id}`, { method: 'DELETE' }), () => toast('Bericht gelöscht'));
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const all = data ?? [];
  const rows = all.filter((r) => !kind || r.kind === kind);
  const count = (k: ReportRow['kind']) => all.filter((r) => r.kind === k).length;
  return (
    <section aria-labelledby="archive-h">
      {confirmEl}
      <div className="mb-2.5 flex flex-col gap-1">
        <h2 id="archive-h" className="flex items-center gap-2 text-title font-semibold tracking-tight">
          Erstellte Berichte
          {data && <span className="rounded-md bg-sunken px-1.5 text-caption font-medium text-ink-2 tabular-nums">{all.length}</span>}
        </h2>
        <p className="text-meta text-ink-3">Jeder erzeugte Bericht bleibt hier als Nachweis abrufbar.</p>
      </div>
      {all.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={!kind} onClick={() => setKind('')} count={all.length}>
            Alle
          </Chip>
          {(Object.keys(KIND_LABEL) as ReportRow['kind'][])
            .filter((k) => count(k) > 0)
            .map((k) => (
              <Chip key={k} active={kind === k} onClick={() => setKind(k)} count={count(k)}>
                {KIND_LABEL[k]}
              </Chip>
            ))}
        </div>
      )}
      {del.error && <ErrorBox error={del.error} className="mb-3" />}
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !rows.length ? (
        <Card>
          <Empty compact icon={<FileArchive />} title="Noch keine Berichte" text="Erzeugte PDFs und ZIP-Exporte erscheinen automatisch hier." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.slice(0, limit).map((r) => (
              <li key={r.id} className="flex min-h-14 items-center gap-3 py-2.5 pr-2 pl-4">
                <RowIcon>{r.contentType === 'application/zip' ? <FileArchive /> : <FileText />}</RowIcon>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{r.title}</p>
                  <p className="truncate text-meta text-ink-3">
                    {KIND_LABEL[r.kind]} · <span className="tabular-nums">{fmtDateTime(r.createdAt)}</span>
                    <span className="max-sm:hidden">
                      {' '}
                      · {r.createdBy ?? 'unbekannt'} · {fmtSize(r.size)}
                    </span>
                  </p>
                </div>
                <a
                  href={`/api/reports/${r.id}/file`}
                  download={r.fileName}
                  aria-label={`${r.title} herunterladen`}
                  title="Herunterladen"
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink sm:h-9 [&_svg]:size-4"
                >
                  <Download />
                  <span className="max-sm:hidden">Herunterladen</span>
                </a>
                {(isAdmin || r.createdById === me?.user.id) && (
                  <IconButton
                    label={`${r.title} löschen`}
                    icon={<Trash2 />}
                    onClick={async () => {
                      if (await confirm({ title: 'Bericht löschen?', text: `„${r.title}“ wird aus dem Archiv entfernt.`, confirmLabel: 'Löschen', danger: true })) del.mutate(r.id);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {rows.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 30)} className="w-full border-t border-line px-4 py-2.5 text-left text-meta font-medium text-ink-2 hover:bg-hover hover:text-ink">
              {rows.length - limit} weitere anzeigen
            </button>
          )}
        </Card>
      )}
    </section>
  );
}

function PdfButton({ kind }: { kind: 'defects' | 'compliance' }) {
  const { data: me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      icon={<Download />}
      loading={busy}
      disabled={!me}
      onClick={async () => {
        if (!me) return;
        setBusy(true);
        try {
          const r = await import('../pdf/reports');
          const brand = await r.loadBrand(me);
          const date = new Date().toISOString().slice(0, 10);
          let bytes: Uint8Array;
          let fileName: string;
          if (kind === 'defects') {
            bytes = await r.defectsPdf(await api<Defect[]>('/defects?status=open'), brand);
            fileName = `Maengelbericht_${date}.pdf`;
          } else {
            const [props, overdue, soon] = await Promise.all([api<PropertyRow[]>('/properties'), api<Asset[]>('/assets?due=overdue'), api<Asset[]>('/assets?due=soon')]);
            bytes = await r.compliancePdf(props, overdue, soon, brand);
            fileName = `Compliance_${date}.pdf`;
          }
          r.download(bytes, fileName);
          const title = kind === 'defects' ? 'Mängelbericht' : 'Compliance-Übersicht';
          if (await archiveReport(me, bytes, { kind, title: `${title} ${fmtDate(Date.now())}`, fileName }).catch(() => false)) toast('Im Berichtsarchiv gespeichert');
        } catch (e) {
          toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
        } finally {
          setBusy(false);
        }
      }}
    >
      PDF
    </Button>
  );
}

function ReportHead({ title, subtitle }: { title: string; subtitle?: string }) {
  const { data: me } = useMe();
  return (
    <header className="mb-4 flex items-end justify-between border-b-2 border-ink pb-3">
      <div>
        <p className="text-[11px] tracking-wider text-ink-3 uppercase">{me?.tenant.name}</p>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-ink-2">{subtitle}</p>}
      </div>
      <p className="text-right text-ink-3">
        Stand {fmtDateTime(Date.now())}
        <br />
        {APP_NAME}
      </p>
    </header>
  );
}

export function ComplianceReport() {
  const props = useProperties();
  const overdue = useAssets({ due: 'overdue' });
  const soon = useAssets({ due: 'soon' });
  if (props.isLoading || overdue.isLoading || soon.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (props.error) return <ErrorBox error={props.error} />;
  const rows = props.data ?? [];
  const total = rows.reduce((s, p) => s + p.assets, 0);
  const od = overdue.data ?? [];
  const sn = soon.data ?? [];
  return (
    <PrintFrame title="Compliance-Übersicht" back="/berichte">
      <ReportHead title="Compliance-Übersicht" subtitle={`${rows.length} Objekte · ${total} Elemente`} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink text-left">
            <th className="py-1">Objekt</th>
            <th className="py-1 text-right">Elemente</th>
            <th className="py-1 text-right">Überfällig</th>
            <th className="py-1 text-right">Bald fällig</th>
            <th className="py-1 text-right">Ungeprüft</th>
            <th className="py-1 text-right">Mängel</th>
            <th className="py-1 text-right">Nächster Termin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-line">
              <td className="py-1 font-medium">{p.name}</td>
              <td className="py-1 text-right">{p.assets}</td>
              <td className={`py-1 text-right ${p.overdue ? 'font-semibold text-bad' : ''}`}>{p.overdue ?? 0}</td>
              <td className="py-1 text-right">{p.soon ?? 0}</td>
              <td className="py-1 text-right">{p.never ?? 0}</td>
              <td className="py-1 text-right">{p.openDefects}</td>
              <td className="py-1 text-right">{fmtDate(p.nextDueAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {[
        ['Überfällige Elemente', od],
        ['In 30 Tagen fällig', sn],
      ].map(([title, list]) => (
        <section key={title as string} className="mt-6">
          <h2 className="mb-1.5 text-[13px] font-semibold">
            {title as string} ({(list as typeof od).length})
          </h2>
          {(list as typeof od).length === 0 ? (
            <p className="text-ink-3">Keine.</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {(list as typeof od).map((a) => (
                  <tr key={a.id} className="border-b border-line">
                    <td className="py-1 font-mono">{a.code}</td>
                    <td className="py-1">{categoryLabel(a.category)}</td>
                    <td className="py-1">{[a.propertyName, a.buildingName, a.location].filter(Boolean).join(' · ')}</td>
                    <td className="py-1 text-right">{fmtDate(a.nextDueAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </PrintFrame>
  );
}

export function DefectReport() {
  const { data, isLoading, error } = useDefects('open');
  if (isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (error) return <ErrorBox error={error} />;
  const rows = data ?? [];
  return (
    <PrintFrame title="Mängelbericht" back="/berichte">
      <ReportHead title="Mängelbericht" subtitle={`${rows.length} offene Mängel`} />
      {rows.length === 0 ? (
        <p>Keine offenen Mängel.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((d, n) => (
            <li key={d.id} className="flex gap-4 border-b border-line pb-3 break-inside-avoid">
              <span className="w-6 text-ink-3">{n + 1}.</span>
              <div className="flex-1">
                <p className="font-semibold">
                  {d.title} <span className="font-normal text-ink-2">– {SEVERITIES[d.severity]}</span>
                </p>
                <p className="text-ink-2">
                  {d.code} · {[d.location, d.buildingName, d.propertyName].filter(Boolean).join(' · ')} · erfasst {fmtDate(d.createdAt)}
                </p>
                {d.note && <p>{d.note}</p>}
              </div>
              {d.photoKey && <img src={`/api/files/${d.photoKey}`} alt="" className="h-20 w-28 rounded border border-line object-cover" />}
            </li>
          ))}
        </ol>
      )}
    </PrintFrame>
  );
}

function randomLabel() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'PK-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alphabet[b % alphabet.length]).join('');
}

export function LabelSheet() {
  const [params] = useSearchParams();
  const preset = params.get('ids')?.split(',').filter(Boolean);
  const [mode, setMode] = useState<'assets' | 'blank'>('assets');
  return (
    <PrintFrame title="QR-Etiketten" back="/berichte">
      {!preset && (
        <Segmented
          className="no-print mb-4"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'assets', label: 'Für vorhandene Elemente' },
            { value: 'blank', label: 'Blanko-Etiketten' },
          ]}
        />
      )}
      {mode === 'assets' ? <AssetLabels preset={preset} /> : <BlankLabels />}
    </PrintFrame>
  );
}

function BlankLabels() {
  const [count, setCount] = useState(24);
  const [seed, setSeed] = useState(0);
  const codes = useMemo(() => Array.from({ length: Math.min(300, Math.max(1, count)) }, randomLabel), [count, seed]);
  return (
    <>
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-lg bg-sunken p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-3">Anzahl</span>
          <Input type="number" min={1} max={300} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-28" />
        </label>
        <Button variant="secondary" onClick={() => setSeed((s) => s + 1)}>
          Neue Codes
        </Button>
        <p className="max-w-sm text-xs text-ink-3">
          Etiketten vorab drucken und aufkleben. Beim ersten Scan legst du das Element an oder ordnest das Etikett einem vorhandenen Element zu.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-[3mm]">
        {codes.map((c) => (
          <div key={c} className="flex flex-col items-center rounded border border-line p-2 break-inside-avoid">
            <QrImage code={c} size={92} />
            <p className="mt-1 font-mono text-[12px] font-bold">{c}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function AssetLabels({ preset }: { preset?: string[] }) {
  const { data, isLoading } = useAssets();
  const [picked, setPicked] = useState<Set<string> | null>(preset ? new Set(preset) : null);
  const [propertyId, setPropertyId] = useState<string>('');
  const props = useMemo(() => [...new Map((data ?? []).map((a) => [a.propertyId, a.propertyName])).entries()], [data]);
  if (isLoading) return <Spinner />;
  const all = data ?? [];
  const selected = all.filter((a) => (picked ? picked.has(a.id) : propertyId ? a.propertyId === propertyId : true));

  return (
    <>
      <div className="no-print mb-5 flex flex-wrap gap-2">
        <Chip
          active={!propertyId && !picked}
          onClick={() => {
            setPicked(null);
            setPropertyId('');
          }}
        >
          Alle ({all.length})
        </Chip>
        {props.map(([id, name]) => (
          <Chip
            key={id}
            active={!picked && propertyId === id}
            onClick={() => {
              setPicked(null);
              setPropertyId(id);
            }}
          >
            {name}
          </Chip>
        ))}
        {picked && <Chip active>Auswahl ({picked.size})</Chip>}
      </div>
      <div className="grid grid-cols-3 gap-[4mm]">
        {selected.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded border border-line p-2 break-inside-avoid">
            <QrImage code={a.code} size={84} />
            <div className="min-w-0">
              <p className="font-mono text-[13px] font-bold">{a.code}</p>
              <p className="truncate text-[10px]">{categoryLabel(a.category)}</p>
              <p className="truncate text-[10px] text-ink-3">{a.location || a.buildingName}</p>
              <div className="no-print mt-1">
                <DueBadge asset={a} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
