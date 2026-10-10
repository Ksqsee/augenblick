import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { api, archiveReport, type Defect, type PropertyDetail, useMe } from '../api';
import { Button, useToast } from './ui';

/** Erzeugt den Objektbericht (PDF) im Browser, lädt ihn herunter und legt ihn im Berichtsarchiv ab. */
export function PropertyReportButton({ propertyId, variant = 'secondary', label = 'Objektbericht' }: { propertyId: string | undefined; variant?: 'secondary' | 'primary' | 'ghost'; label?: string }) {
  const { data: me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      icon={<FileDown className="size-4" />}
      loading={busy}
      disabled={!me || !propertyId}
      onClick={async () => {
        if (!me || !propertyId) return;
        setBusy(true);
        try {
          const [p, defects] = await Promise.all([api<PropertyDetail>(`/properties/${propertyId}`), api<Defect[]>('/defects?status=open')]);
          const r = await import('../pdf/reports');
          const bytes = await r.propertyPdf(p, defects.filter((d) => d.propertyId === propertyId), await r.loadBrand(me));
          const date = new Date().toISOString().slice(0, 10);
          const slug = p.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const fileName = `Objektbericht_${slug}_${date}.pdf`;
          r.download(bytes, fileName);
          if (await archiveReport(me, bytes, { kind: 'property', title: `Objektbericht ${p.name}`, fileName, propertyId }).catch(() => false)) toast('Im Berichtsarchiv gespeichert');
        } catch (e) {
          toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
