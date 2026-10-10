import clsx from 'clsx';
import { ArrowLeft, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CATEGORIES, INSPECTION_KINDS, SEVERITIES } from '../../shared/catalog';
import { fileUrl, useInspection } from '../api';
import { APP_NAME } from '../components/Logo';
import { attributeRows } from '../components/forms';
import { Button, ErrorBox, Spinner } from '../components/ui';
import { fmtDate, fmtDateTime, RESULT_META } from '../format';

export function PrintFrame({ title, back, children }: { title: string; back: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-sunken py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4">
        <Link to={back} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Zurück
        </Link>
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
          Drucken / PDF
        </Button>
      </div>
      <article aria-label={title} className="print-page mx-auto max-w-[210mm] bg-white px-[14mm] py-[12mm] text-[12px] leading-relaxed text-ink shadow-pop">
        {children}
      </article>
    </div>
  );
}

const ANSWER_LABEL = { ok: 'i. O.', defect: 'Mangel', na: 'n. z.' } as const;

export function Protocol() {
  const { id = '' } = useParams();
  const { data: i, isLoading, error } = useInspection(id);
  if (isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (error || !i) return <div className="p-6"><ErrorBox error={error} /></div>;
  const def = CATEGORIES[i.asset.category];
  const res = i.result ? RESULT_META[i.result as keyof typeof RESULT_META] : null;

  return (
    <PrintFrame title="Prüfprotokoll" back={`/elemente/${i.assetId}`}>
      <header className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <p className="text-[11px] tracking-wider text-ink-3 uppercase">{i.tenantName}</p>
          <h1 className="text-xl font-semibold">Prüfprotokoll {def.label}</h1>
          <p className="text-ink-2">Grundlage: {def.norm}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-base font-semibold">{i.asset.code}</p>
          <p className="text-ink-3">Protokoll-Nr. {i.id.slice(0, 8).toUpperCase()}</p>
          {i.status === 'draft' && <p className="font-semibold text-bad">ENTWURF</p>}
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1">
        <Row k="Objekt" v={i.asset.propertyName} />
        <Row k="Prüfart" v={INSPECTION_KINDS[i.kind]} />
        <Row k="Gebäude" v={i.asset.buildingName} />
        <Row k="Prüfdatum" v={fmtDateTime(i.inspectedAt ?? i.createdAt)} />
        <Row k="Standort" v={[i.asset.location, i.asset.floor].filter(Boolean).join(', ')} />
        <Row k="Prüfer/in" v={i.inspectorName} />
        <Row k="Hersteller / Typ" v={[i.asset.manufacturer, i.asset.model].filter(Boolean).join(' / ')} />
        <Row k="Nächste Prüfung" v={fmtDate(i.nextDueAt)} />
        {attributeRows(i.asset.category, i.asset.attributes).map(([k, v]) => (
          <Row key={k} k={k} v={v} />
        ))}
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-[13px] font-semibold">Prüfpunkte</h2>
        {i.notInspectable ? (
          <p className="rounded border border-line p-3">Das Element war zum Prüfzeitpunkt nicht prüfbar.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-ink text-left">
                <th className="w-8 py-1">Nr.</th>
                <th className="py-1">Prüfpunkt</th>
                <th className="w-20 py-1 text-right">Befund</th>
              </tr>
            </thead>
            <tbody>
              {i.checkpoints.map((cp, n) => {
                const a = i.answers[cp.id];
                return (
                  <tr key={cp.id} className="border-b border-line break-inside-avoid">
                    <td className="py-1 text-ink-3">{n + 1}</td>
                    <td className="py-1">{cp.label}</td>
                    <td className={clsx('py-1 text-right font-medium', a === 'defect' && 'text-bad')}>{a ? ANSWER_LABEL[a] : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {i.defects.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="mb-1.5 text-[13px] font-semibold">Festgestellte Mängel</h2>
          <ol className="list-decimal space-y-2 pl-5">
            {i.defects.map((d, n) => (
              <li key={n}>
                <span className="font-medium">{d.title}</span> – <span className="text-ink-2">{SEVERITIES[d.severity]}</span>
                {d.note && <p className="text-ink-2">{d.note}</p>}
                {d.photoKey && <img src={fileUrl(d.photoKey)} alt="" className="mt-1 h-28 rounded border border-line object-cover" />}
              </li>
            ))}
          </ol>
        </section>
      )}

      {i.maintenance.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-1.5 text-[13px] font-semibold">Durchgeführte Arbeiten</h2>
          <p>{i.maintenance.map((k) => def.maintenance.find((m) => m.key === k)?.label ?? k).join(' · ')}</p>
        </section>
      )}

      {i.notes && (
        <section className="mt-5">
          <h2 className="mb-1.5 text-[13px] font-semibold">Bemerkungen</h2>
          <p className="whitespace-pre-line">{i.notes}</p>
        </section>
      )}

      <section className="mt-6 grid grid-cols-2 gap-8 break-inside-avoid">
        <div className={clsx('rounded border-2 p-3', res?.tone === 'ok' ? 'border-ok' : res?.tone === 'bad' ? 'border-bad' : 'border-warn')}>
          <p className="text-[11px] text-ink-3 uppercase">Gesamtergebnis</p>
          <p className="text-base font-semibold">{res?.label ?? 'Offen'}</p>
        </div>
        <div>
          {i.signature && <img src={i.signature} alt="Unterschrift" className="h-16" />}
          <p className="border-t border-ink pt-1">
            {i.signerName || i.inspectorName}, {fmtDate(i.inspectedAt ?? i.createdAt)}
          </p>
        </div>
      </section>

      <footer className="mt-8 border-t border-line pt-2 text-[10px] text-ink-3">Erstellt mit {APP_NAME}</footer>
    </PrintFrame>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-0.5">
      <span className="text-ink-3">{k}</span>
      <span className="text-right font-medium">{v || '–'}</span>
    </div>
  );
}
