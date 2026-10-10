import { AlertTriangle, ClipboardList, Download, FileSpreadsheet, FileText, Footprints, QrCode, ShieldCheck } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SEVERITIES } from '../../shared/catalog';
import { useAssets, useDefects, useMe, useProperties } from '../api';
import { DueBadge } from '../components/AssetList';
import { APP_NAME } from '../components/Logo';
import { Button, Card, Chip, ErrorBox, Input, PageHeader, Segmented, Spinner } from '../components/ui';
import { categoryLabel, fmtDate, fmtDateTime } from '../format';
import { QrImage } from './Asset';
import { PrintFrame } from './Protocol';

function ReportCard({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action: ReactNode }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-4 grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-strong [&>svg]:size-5">{icon}</div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 flex-1 text-sm text-ink-3">{text}</p>
      <div className="mt-5">{action}</div>
    </Card>
  );
}

export function ReportsPage() {
  return (
    <>
      <PageHeader title="Berichte" subtitle="Nachweise für Betreiber, Behörden und Versicherer" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReportCard
          icon={<ShieldCheck />}
          title="Compliance-Übersicht"
          text="Prüfstatus aller Objekte mit überfälligen und bald fälligen Elementen."
          action={
            <Link to="/druck/compliance">
              <Button variant="secondary">Öffnen</Button>
            </Link>
          }
        />
        <ReportCard
          icon={<AlertTriangle />}
          title="Mängelbericht"
          text="Alle offenen Mängel nach Schwere sortiert, inklusive Fotos."
          action={
            <Link to="/druck/maengel">
              <Button variant="secondary">Öffnen</Button>
            </Link>
          }
        />
        <ReportCard
          icon={<FileText />}
          title="Prüfprotokolle"
          text="Einzelprotokolle mit Unterschrift findest du bei jeder durchgeführten Prüfung."
          action={
            <Link to="/pruefungen?tab=done">
              <Button variant="secondary">Zu den Prüfungen</Button>
            </Link>
          }
        />
        <ReportCard
          icon={<ClipboardList />}
          title="Elementliste (CSV)"
          text="Alle Elemente mit Status und Terminen als Tabelle, z. B. für Excel."
          action={
            <a href="/api/export/assets.csv" download>
              <Button variant="secondary" icon={<Download className="size-4" />}>
                Herunterladen
              </Button>
            </a>
          }
        />
        <ReportCard
          icon={<Footprints />}
          title="Begehungsprotokolle"
          text="Protokolle der Brandschutzbegehungen mit Feststellungen und Rechtsgrundlagen."
          action={
            <Link to="/begehungen">
              <Button variant="secondary">Zu den Begehungen</Button>
            </Link>
          }
        />
        <ReportCard
          icon={<FileSpreadsheet />}
          title="Import"
          text="Bestandslisten aus Excel oder CSV übernehmen – inklusive Objekten und Gebäuden."
          action={
            <Link to="/import">
              <Button variant="secondary">Import öffnen</Button>
            </Link>
          }
        />
        <ReportCard
          icon={<QrCode />}
          title="QR-Etiketten"
          text="Etikettenbogen zum Aufkleben. Beim Scannen öffnet sich direkt das Element."
          action={
            <Link to="/druck/etiketten">
              <Button variant="secondary">Etiketten wählen</Button>
            </Link>
          }
        />
      </div>
    </>
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
