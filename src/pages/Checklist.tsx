// Checkliste je Typ (Plan v7 W): /druck/checkliste?produkt=<Katalog-Produkt> | ?element=<Element> | ?art=<Elementart>.
// Eine A4-Seite zum Ausdrucken und Mitführen (auch als PDF): Kopf mit Typ, Anforderung, Zulassung; Prüfpunkte nach
// Bauteil-Gruppen, nur die für diese Stammdaten zutreffenden, mit Kästchen und Platz für Türnummern.
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productLabel } from '../../shared/announce';
import { buildChecklist, requirementOf } from '../../shared/checklist';
import { applyProductDefaults } from '../../shared/vocab';
import { api, type AssetDetail, useCatalog, useMe } from '../api';
import { getCategory, schedulesFor } from '../categories';
import { Button, ErrorBox, Spinner, useToast } from '../components/ui';
import { PrintFrame } from './Protocol';

export function ChecklistPage() {
  const [params] = useSearchParams();
  const productId = params.get('produkt');
  const assetId = params.get('element');
  const catalog = useCatalog(!!productId);
  const asset = useQuery({ queryKey: ['asset', assetId], queryFn: () => api<AssetDetail>(`/assets/${assetId}`), enabled: !!assetId });
  const { data: me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if ((productId && catalog.isLoading) || (assetId && asset.isLoading)) return <Spinner className="min-h-dvh items-center" />;
  const err = (productId && catalog.error) || (assetId && asset.error);
  if (err) return <div className="p-6"><ErrorBox error={err} /></div>;
  const product = productId ? catalog.data?.products.find((p) => p.id === productId) : undefined;
  if (productId && !product) return <div className="p-6"><ErrorBox error={new Error('Typ nicht im Katalog')} /></div>;
  const a = asset.data;
  const category = a?.category ?? (product?.category || params.get('art') || 'fire_door');
  const def = getCategory(category);
  const sched = schedulesFor(category).find((s) => s.key === 'main') ?? schedulesFor(category)[0];
  const attrs: Record<string, unknown> = a
    ? a.attributes
    : product
      ? applyProductDefaults({}, product, def.attributes.map((f) => f.key))
      : {};
  const typeName = a ? [a.manufacturer, a.model].filter(Boolean).join(' ') : product ? productLabel(product) : '';
  const approval = String(attrs.approval ?? product?.approval ?? '');
  const requirement = requirementOf(attrs);
  const list = buildChecklist(sched?.checkpoints ?? [], category, attrs, (k) => def.attributes.find((f) => f.key === k)?.label);
  const element = a ? [a.code, a.number != null ? `Nr. ${a.number}` : '', a.location].filter(Boolean).join(' · ') : undefined;
  const back = a ? `/elemente/${a.id}` : product ? '/einstellungen?tab=catalog' : '/pruefen';
  const title = `Checkliste ${typeName || 'Typ unbekannt'}`;

  return (
    <PrintFrame
      title={title}
      back={back}
      actions={
        me && (
          <Button
            className="max-lg:order-first"
            icon={<Download className="size-4" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const [{ checklistPdf }, { loadBrand, download }] = await Promise.all([import('../pdf/checklist'), import('../pdf/reports')]);
                const pdf = await checklistPdf(
                  { type: typeName, categoryLabel: def.label, scheduleLabel: sched?.label ?? '', norm: def.norm, requirement, approval, element, checklist: list },
                  await loadBrand(me),
                );
                download(pdf, `Checkliste_${(typeName || 'Typ_unbekannt').replace(/[^\p{L}\d]+/gu, '_')}.pdf`);
              } catch (e) {
                toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            PDF
          </Button>
        )
      }
    >
      <header className="border-b-2 border-ink pb-2">
        {me && <p className="text-[11px] tracking-wider text-ink-3 uppercase">{me.tenant.name}</p>}
        <h1 className="text-xl font-semibold break-words">{title}</h1>
        <p className="text-ink-2">{[def.label, sched?.label, def.norm].filter(Boolean).join(' · ')}</p>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4" aria-label="Kopf der Checkliste">
        {(
          [
            ['Typ', typeName || 'unbekannt'],
            ['Anforderung', requirement || '–'],
            ['Zulassung', approval || '–'],
            [element ? 'Element' : 'Elementart', element ?? def.label],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="min-w-0 border-b border-line py-1">
            <dt className="text-[11px] text-ink-3">{k}</dt>
            <dd className="font-medium break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-ink-3">Nur Abweichungen ansagen – alles Übrige gilt als in Ordnung.</p>
      <table className="mt-2 w-full table-fixed border-collapse" aria-label="Prüfpunkte nach Bauteil">
        <colgroup>
          <col className="w-7" />
          <col />
          <col className="w-9" />
          <col className="w-[30%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-ink text-left text-[11px]">
            <th className="py-1 font-semibold">Nr.</th>
            <th className="py-1 font-semibold">Prüfpunkt</th>
            <th className="py-1 text-center font-semibold">i. O.</th>
            <th className="py-1 pl-2 font-semibold">Türen mit Abweichung / Notiz</th>
          </tr>
        </thead>
        {list.groups.map((g) => (
          <tbody key={g.key} data-group={g.key}>
            <tr>
              <th colSpan={4} className="pt-2 pb-0.5 text-left font-semibold">
                {g.label}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.n} data-checkpoint={r.label} className="border-b border-line align-top">
                <td className="py-1 text-ink-3 tabular-nums">{r.n}</td>
                <td className="py-1 pr-2 break-words">
                  {r.label}
                  {r.ifPresent && <span className="text-ink-3"> (falls vorhanden: {r.ifPresent})</span>}
                </td>
                <td className="py-1 text-center">
                  <span aria-hidden className="inline-block size-3 border border-ink align-middle" />
                </td>
                <td className="py-1 pl-2">
                  <span aria-hidden className="mt-3 block border-b border-line-strong" />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {list.omitted.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-3" aria-label="Entfällt nach den Stammdaten">
          Entfällt nach den Stammdaten: {list.omitted.join('; ')}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-[11px] text-ink-3">
        <div className="col-span-2 border-b border-ink pb-4">Geprüfte Türen (Nummern)</div>
        <div className="border-b border-ink pb-4">Datum</div>
        <div className="border-b border-ink pb-4">Prüfer/in</div>
      </div>
    </PrintFrame>
  );
}
