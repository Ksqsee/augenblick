// Tabelle ohne eigenen Kasten – für eine Section (flush) in der einen Surface einer Seite.
// Wie DataTable (ui.tsx): ab md eine Tabelle, auf dem Handy Zeilen (ListRow). DataTable bringt eine Card mit,
// die in einer Surface eine Karte in der Karte wäre.
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { type Column, ListRow } from '../ui';

export function PlainTable<T>({ columns, rows, rowKey, rowTo, 'aria-label': ariaLabel }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; rowTo: (row: T) => string; 'aria-label'?: string }) {
  const role = (c: Column<T>, i: number) => c.mobile ?? (i === 0 ? 'primary' : i === columns.length - 1 ? 'trailing' : 'secondary');
  const pick = (m: string) => columns.filter((c, i) => role(c, i) === m);
  return (
    <>
      <table className="hidden w-full border-collapse text-body md:table" aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((c) => (
              <th key={c.key} className={clsx('h-9 px-3 text-caption font-normal text-ink-3 first:pl-(--row-px) last:pr-(--row-px)', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="relative transition-colors hover:bg-hover">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={clsx('h-12 px-3 py-2 first:pl-(--row-px) last:pr-(--row-px)', c.align === 'right' && 'text-right tabular-nums', i === 0 ? 'text-ink' : 'text-ink-2', c.className)}
                >
                  {i === 0 ? (
                    <Link to={rowTo(r)} className="after:absolute after:inset-0">
                      {c.cell(r)}
                    </Link>
                  ) : (
                    c.cell(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="pk-list md:hidden" aria-label={ariaLabel}>
        {rows.map((r) => (
          <ListRow
            key={rowKey(r)}
            to={rowTo(r)}
            title={pick('primary').map((c) => (
              <span key={c.key}>{c.cell(r)}</span>
            ))}
            subtitle={
              pick('secondary').length ? (
                <span className="flex min-w-0 gap-x-2">
                  {pick('secondary').map((c) => (
                    <span key={c.key} className="truncate">
                      {c.cell(r)}
                    </span>
                  ))}
                </span>
              ) : undefined
            }
            trailing={pick('trailing').map((c) => (
              <span key={c.key}>{c.cell(r)}</span>
            ))}
          />
        ))}
      </ul>
    </>
  );
}
