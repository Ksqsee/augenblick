import { allCategories, getCategory } from '../categories';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IMPORT_COLUMNS, type ImportRow, parseCsv, toImportRows } from '../../shared/importing';
import { api, queryClient } from '../api';
import { Badge, Button, Card, CardHeader, ErrorBox, PageHeader, useToast } from '../components/ui';
import { fmtDate } from '../format';

interface ImportResponse {
  dryRun: boolean;
  summary: { created: number; failed: number; newProperties: number; newBuildings: number };
  results: { line: number; status: 'ok' | 'error'; code?: string; message?: string }[];
}

function downloadTemplate() {
  const example = [
    ['Grundschule Am Park', 'Haupthaus', 'Feuerschutztür', '', '', 'Treppenhaus Nord', 'EG', 'Hörmann', 'H3 OD', '2015', '15.03.2026'],
    ['Grundschule Am Park', 'Turnhalle', 'Feuerlöscher', '', '', 'Geräteraum', 'EG', 'Gloria', 'PD6', '2020', ''],
  ];
  const csv = [IMPORT_COLUMNS.map((c) => c.label), ...example].map((r) => r.join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'import-vorlage.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportPage() {
  const toast = useToast();
  const [file, setFile] = useState<string>('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [check, setCheck] = useState<ImportResponse | null>(null);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const onFile = async (f: File) => {
    setError(null);
    setCheck(null);
    setDone(null);
    setFile(f.name);
    try {
      let table: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        table = (await readSheet(f)) as unknown[][];
      } else {
        table = parseCsv(await f.text());
      }
      const r = toImportRows(table, allCategories().filter((c) => c.custom));
      if (r.rows.length > 1000) throw new Error('Maximal 1000 Zeilen pro Import');
      setRows(r.rows);
      setParseErrors(r.errors);
      if (r.rows.length) {
        setBusy(true);
        setCheck(await api<ImportResponse>('/import/assets', { body: { rows: r.rows, dryRun: true } }));
      }
    } catch (e) {
      setError(e);
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportResponse>('/import/assets', { body: { rows, dryRun: false } });
      setDone(r);
      await queryClient.invalidateQueries();
      toast(`${r.summary.created} Elemente importiert`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const resultByLine = new Map(check?.results.map((r) => [r.line, r]));

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Elemente aus Excel oder CSV übernehmen. Fehlende Objekte und Gebäude werden automatisch angelegt."
        actions={
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={downloadTemplate}>
            Vorlage (CSV)
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-10 text-center hover:bg-sunken">
            <FileSpreadsheet className="size-8 text-ink-3" />
            <span className="text-sm font-medium">{file || 'Excel (.xlsx) oder CSV auswählen'}</span>
            <span className="max-w-md text-xs text-ink-3">
              Spalten: {IMPORT_COLUMNS.map((c) => c.label + (c.required ? '*' : '')).join(', ')}. Erste Zeile = Überschriften. Art z. B. „Feuerschutztür“, „BSK“, „Feuerlöscher“, „Rauchmelder“.
            </span>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          {!!error && (
            <div className="mt-4">
              <ErrorBox error={error} />
            </div>
          )}
        </Card>

        {done ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle2 className="size-10 text-ok" />
            <p className="text-lg font-semibold">{done.summary.created} Elemente importiert</p>
            <p className="text-sm text-ink-3">
              {done.summary.newProperties} neue Objekte · {done.summary.newBuildings} neue Gebäude
              {done.summary.failed > 0 && ` · ${done.summary.failed} Zeilen übersprungen`}
            </p>
            <Link to="/elemente">
              <Button>Zu den Elementen</Button>
            </Link>
          </Card>
        ) : (
          (rows.length > 0 || parseErrors.length > 0) && (
            <Card>
              <CardHeader
                title="Vorschau"
                subtitle={
                  check
                    ? `${check.summary.created} Zeilen bereit · ${check.summary.newProperties} neue Objekte · ${check.summary.newBuildings} neue Gebäude`
                    : `${rows.length} Zeilen gelesen`
                }
                action={
                  <Button icon={<Upload className="size-4" />} disabled={!check?.summary.created} loading={busy} onClick={run}>
                    {check?.summary.created ?? 0} importieren
                  </Button>
                }
              />
              {(parseErrors.length > 0 || (check?.summary.failed ?? 0) > 0) && (
                <ul className="border-b border-line bg-bad-soft/50 px-5 py-3 text-sm text-bad">
                  {[...parseErrors, ...(check?.results.filter((r) => r.status === 'error').map((r) => ({ line: r.line, message: r.message ?? '' })) ?? [])].map((e, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <AlertCircle className="size-3.5" /> Zeile {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-sunken/50 text-left text-xs text-ink-3">
                    <tr>
                      {['Objekt', 'Gebäude', 'Art', 'Code', 'Standort', 'Hersteller', 'Letzte Prüfung', ''].map((h) => (
                        <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.slice(0, 200).map((r, i) => {
                      const res = resultByLine.get(i + 2);
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2">{r.property}</td>
                          <td className="px-3 py-2">{r.building}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{getCategory(r.category).label}</td>
                          <td className="px-3 py-2 font-mono text-xs">{res?.code ?? r.code ?? '–'}</td>
                          <td className="px-3 py-2">{r.location || '–'}</td>
                          <td className="px-3 py-2">{r.manufacturer || '–'}</td>
                          <td className="px-3 py-2">{fmtDate(r.lastInspectedAt)}</td>
                          <td className="px-3 py-2">{res && <Badge tone={res.status === 'ok' ? 'ok' : 'bad'}>{res.status === 'ok' ? 'OK' : 'Fehler'}</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length > 200 && <p className="px-5 py-3 text-xs text-ink-3">… und {rows.length - 200} weitere Zeilen</p>}
              </div>
            </Card>
          )
        )}
      </div>
    </>
  );
}
