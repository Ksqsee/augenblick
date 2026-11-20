// Objekte (docs/plan/v8.md 1). Handy: die Startseite – Objektliste mit Ampel, Suche, Filter Alle · Fällig · Mit Mängeln ·
// Unterschrift offen, dringendstes zuerst; Tipp öffnet das Objekt. Desktop: die Liste ist die linke Leiste
// (components/Shell.tsx), hier öffnet sich das zuletzt geöffnete Objekt, sonst das dringendste. Ohne Objekte:
// der Ein-Feld-Einstieg (FirstProperty). ?filter=… setzt den Filter (z. B. /offen → ?filter=maengel), ?neu=1 öffnet „Neues Objekt“.
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { matchesAmpel } from '../../shared/ampel';
import { useMe } from '../api';
import { openCapture } from '../components/CaptureSheet';
import { PropertyForm } from '../components/forms';
import { ObjectViews } from '../components/objects/Views';
import { AmpelFilters, canCreateProperty, isAmpelFilter, PropertyLink, setPropertyFilter, startProperty, useIsDesktop, usePropertyList } from '../components/PropertyNav';
import { Button, Empty, ErrorBox, PageHeader, SearchField, Section, SkeletonList, Spinner, Surface } from '../components/ui';
import { FirstProperty } from './Dashboard';

export function PropertiesPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const desktop = useIsDesktop();
  const [q, setQ] = useState('');
  const { query, all, rows, counts, filter, setFilter, now } = usePropertyList(q);
  const creating = params.get('neu') === '1';
  const canEdit = canCreateProperty(me);
  // ?filter=maengel (z. B. aus /offen) gilt für Liste und Leiste
  const wanted = params.get('filter');
  useEffect(() => {
    if (isAmpelFilter(wanted)) setPropertyFilter(wanted);
  }, [wanted]);

  const form = creating && <PropertyForm onClose={() => setParams({})} onCreated={(id) => openCapture({ propertyId: id, mode: 'assets' })} />;
  if (query.error) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  // Leerer Workspace: nur die Frage nach dem ersten Objekt (Admins); sonst ein Satz
  if (query.data && !all.length)
    return (
      <>
        {form}
        <Start canEdit={canEdit} />
      </>
    );
  // Desktop: rechts ein Objekt – Filter aus der Adresse zuerst anwenden, dann das passende wählen
  if (desktop && !creating) {
    if (!query.data) return <Spinner className="min-h-[40vh] items-center" />;
    const hits = isAmpelFilter(wanted) ? all.filter((p) => matchesAmpel(p, wanted, now)) : [];
    const list = hits.length ? hits : all;
    const pick = startProperty(me?.tenant.id, list, now);
    return pick ? <Navigate to={`/objekte/${pick}`} replace /> : null;
  }
  const filtered = !!q.trim() || filter !== 'alle';
  const reset = () => {
    setQ('');
    setFilter('alle');
  };
  return (
    <>
      <PageHeader
        title="Objekte"
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setParams({ neu: '1' })}>
              Neues Objekt
            </Button>
          )
        }
      />
      <ObjectViews current="objekte" />
      {form}
      {all.length > 0 && (
        <div className="mb-4 flex flex-col gap-2.5">
          <SearchField value={q} onChange={setQ} placeholder="Name, Adresse, Ansprechperson" />
          {all.length > 1 && <AmpelFilters value={filter} onChange={setFilter} counts={counts} />}
        </div>
      )}
      <Surface>
        {query.isLoading ? (
          <Section>
            <SkeletonList rows={4} />
          </Section>
        ) : !rows.length ? (
          <Section>
            <Empty
              compact
              title="Keine Treffer"
              text={filtered ? 'Kein Objekt passt zu Suche und Filter.' : undefined}
              action={
                <Button variant="ghost" onClick={reset}>
                  Filter zurücksetzen
                </Button>
              }
            />
          </Section>
        ) : (
          <Section
            flush
            title={rows.length === 1 ? '1 Objekt' : `${rows.length} Objekte`}
            action={
              filtered ? (
                <button type="button" onClick={reset} className="text-meta font-medium text-ink-2 hover:text-ink">
                  Filter zurücksetzen
                </button>
              ) : (
                <span className="text-meta text-ink-3">dringendstes zuerst</span>
              )
            }
          >
            <ul className="pk-list" aria-label="Objekte">
              {rows.map((p) => (
                <li key={p.id}>
                  <PropertyLink p={p} now={now} variant="page" />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Surface>
    </>
  );
}

/** Leerer Workspace (Plan v5 Q): ein Feld, ein Knopf – für alle anderen ein Satz. */
function Start({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="lg:max-w-[52rem]">
      <Surface>
        <header className="px-(--row-px) pt-5 pb-6 sm:pt-7 sm:pb-8">
          <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-ink sm:text-h1">{canEdit ? 'Wie heißt dein erstes Objekt?' : 'Noch kein Objekt'}</h1>
          {!canEdit && <p className="mt-2 text-body text-ink-3">Objekte legt eine Admin-Person an. Danach siehst du sie hier.</p>}
        </header>
        {canEdit && <FirstProperty />}
      </Surface>
    </div>
  );
}
