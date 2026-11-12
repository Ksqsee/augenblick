import { allCategories, getCategory } from '../categories';
import clsx from 'clsx';
import { Download, RotateCcw, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { IMPORT_COLUMNS, type ImportRow, parseCsv, toImportRows } from '../../shared/importing';
import { api, queryClient } from '../api';
import { Stepper } from '../components/admin';
import { Button, ButtonLink, type Column, DataTable, ErrorBox, IconButton, PageHeader, Section, Spinner, StatusText, Surface, useToast } from '../components/ui';
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

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

export function ImportPage() {
  const toast = useToast();
  const [file, setFile] = useState<string>('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [check, setCheck] = useState<ImportResponse | null>(null);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reset = () => {
    setFile('');
    setRows([]);
    setParseErrors([]);
    setCheck(null);
    setDone(null);
    setError(null);
  };

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
  const problems = [...parseErrors, ...(check?.results.filter((r) => r.status === 'error').map((r) => ({ line: r.line, message: r.message ?? '' })) ?? [])];
  const step = done ? 2 : file ? 1 : 0;
  const ready = check?.summary.created ?? 0;

  const columns: Column<ImportRow>[] = [
    {
      key: 'element',
      header: 'Element',
      mobile: 'primary',
      cell: (r) => (
        <span>
          {getCategory(r.category).label}
          {(resultByLine.get(r.line)?.code ?? r.code) && <span className="ml-2 font-mono text-caption font-normal text-ink-3">{resultByLine.get(r.line)?.code ?? r.code}</span>}
        </span>
      ),
    },
    { key: 'ort', header: 'Objekt · Gebäude', cell: (r) => `${r.property} · ${r.building}` },
    { key: 'standort', header: 'Standort', cell: (r) => r.location || '–' },
    { key: 'hersteller', header: 'Hersteller', mobile: 'hidden', cell: (r) => r.manufacturer || '–' },
    { key: 'letzte', header: 'Letzte Prüfung', mobile: 'hidden', cell: (r) => <span className="tabular-nums">{fmtDate(r.lastInspectedAt)}</span> },
    {
      key: 'status',
      header: 'Prüfung',
      mobile: 'trailing',
      cell: (r) => {
        const res = resultByLine.get(r.line);
        return res ? (
          <StatusText tone={res.status === 'ok' ? 'ok' : 'bad'}>{res.status === 'ok' ? 'Bereit' : 'Fehler'}</StatusText>
        ) : (
          <span className="text-ink-4">–</span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="Import" subtitle="Elemente aus Excel oder CSV übernehmen. Fehlende Objekte und Gebäude legt Prüfkompass automatisch an." />
      <Stepper className="mb-6" steps={['Datei wählen', 'Vorschau prüfen', 'Importiert']} current={step} />

      {done ? (
        <Surface className="flex flex-col items-center px-6 py-14 text-center">
          <p className="text-h3 font-semibold">{done.summary.created} Elemente importiert</p>
          <p className="mt-1 text-body text-ink-3">
            {n(done.summary.newProperties, 'neues Objekt', 'neue Objekte')} · {n(done.summary.newBuildings, 'neues Gebäude', 'neue Gebäude')}
            {done.summary.failed > 0 && ` · ${n(done.summary.failed, 'Zeile', 'Zeilen')} übersprungen`}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" icon={<RotateCcw />} onClick={reset}>
              Weitere Datei
            </Button>
            <ButtonLink to="/elemente">Zu den Elementen</ButtonLink>
          </div>
        </Surface>
      ) : (
        <Surface>
          <Section title="Datei">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
            {file ? (
              <div className="flex items-center gap-3 self-start border-y border-line py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">{file}</p>
                  <p className="text-meta text-ink-3">
                    {busy ? 'Wird geprüft …' : error ? 'Konnte nicht gelesen werden' : `${n(rows.length, 'Zeile', 'Zeilen')} gelesen${problems.length ? ` · ${n(problems.length, 'Fehler', 'Fehler')}` : ''}`}
                  </p>
                </div>
                {busy ? <Spinner className="py-0" /> : <IconButton label="Andere Datei wählen" icon={<X />} onClick={reset} />}
              </div>
            ) : (
              <label
                htmlFor="import-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) onFile(f);
                }}
                className={clsx(
                  'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 py-10 text-center transition-colors',
                  drag ? 'border-ink bg-hover' : 'border-line-strong hover:border-ink-3 hover:bg-hover',
                )}
              >
                <Upload className="size-5 text-ink-3" />
                <span>
                  <span className="block text-body font-medium">Datei hierher ziehen</span>
                  <span className="mt-0.5 block text-body text-ink-3">oder hier eine Excel- (.xlsx) oder CSV-Datei auswählen</span>
                </span>
                <span className="text-caption text-ink-3">Bis 1000 Zeilen pro Import</span>
              </label>
            )}
            <input
              id="import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onFile(f);
              }}
            />
            <div className="flex flex-col gap-3 lg:border-l lg:border-line lg:pl-6">
              <p className="text-meta font-medium text-ink-3">So klappt der Import</p>
              <ul className="flex flex-col gap-1.5 text-meta text-ink-2">
                <li>Erste Zeile enthält die Spaltennamen.</li>
                <li>
                  Pflicht:{' '}
                  {IMPORT_COLUMNS.filter((c) => c.required)
                    .map((c) => c.label)
                    .join(', ')}
                  .
                </li>
                <li>Art z. B. „Feuerschutztür“, „BSK“, „Feuerlöscher“, „Rauchmelder“.</li>
                <li>Die Excel-Elementliste aus „Berichte“ lässt sich direkt wieder einlesen.</li>
              </ul>
              <details className="text-meta text-ink-3">
                <summary className="cursor-pointer text-ink-2 hover:text-ink">Alle {IMPORT_COLUMNS.length} Spalten</summary>
                <p className="mt-1.5">{IMPORT_COLUMNS.map((c) => c.label + (c.required ? '*' : '')).join(', ')}</p>
              </details>
              <Button variant="secondary" icon={<Download />} onClick={downloadTemplate} className="mt-1 self-start">
                Vorlage (CSV)
              </Button>
            </div>
          </div>
          {!!error && <ErrorBox error={error} className="mt-4" />}
          </Section>

          {(rows.length > 0 || parseErrors.length > 0) && (
            <Section title="Vorschau" count={rows.length} flush>
              <div className="mb-3 flex flex-col gap-3 px-(--row-px) sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-meta text-ink-2" aria-live="polite">
                    {check
                      ? `${ready} Zeilen bereit · ${n(check.summary.newProperties, 'neues Objekt', 'neue Objekte')} · ${n(check.summary.newBuildings, 'neues Gebäude', 'neue Gebäude')}`
                      : busy
                        ? 'Wird geprüft …'
                        : `${rows.length} Zeilen gelesen`}
                  </p>
                </div>
                <Button icon={<Upload />} disabled={!ready} loading={busy} onClick={run}>
                  {ready} importieren
                </Button>
              </div>
              {problems.length > 0 && (
                <div className="mx-(--row-px) mb-4 border-l border-shu pl-3">
                  <p className="text-body text-shu">{`${n(problems.length, 'Zeile wird', 'Zeilen werden')} übersprungen`}</p>
                  <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto text-meta text-ink-2">
                    {problems.map((e, i) => (
                      <li key={i}>
                        Zeile {e.line}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rows.length > 0 && (
                <DataTable
                  className="!rounded-none border-t border-line !bg-transparent !shadow-none [&_td:first-child]:pl-(--row-px) [&_th:first-child]:pl-(--row-px) [&_td:last-child]:pr-(--row-px) [&_th:last-child]:pr-(--row-px)"
                  columns={columns}
                  rows={rows.slice(0, 200)}
                  rowKey={(r) => String(r.line)}
                />
              )}
              {rows.length > 200 && <p className="mt-2 px-(--row-px) text-meta text-ink-3">… und {rows.length - 200} weitere Zeilen</p>}
            </Section>
          )}
        </Surface>
      )}
    </>
  );
}
