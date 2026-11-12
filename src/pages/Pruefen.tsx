// „Prüfen“ (docs/plan/v4.md 5): ein Ort für alles, was vor Ort geprüft wird. Ohne ?tab= der Überblick – Rundgänge,
// Fälliges, Angefangenes, Begehungen, zuletzt Abgeschlossenes – in einer Fläche. Mit ?tab=… die ausführlichen Listen
// (Überfällig, Entwürfe, Durchgeführt, Archiv …). Scannen, Offline und „Begehung starten“ stehen im Kopf.
import { CloudDownload, Footprints, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WALK_PURPOSES } from '../../shared/catalog';
import { useDashboard, useInspections, useMe, useWalkthroughs, type WalkRow } from '../api';
import { scheduleLabel } from '../categories';
import { CategoryGlyph } from '../components/inspect/Glyph';
import { ButtonLink, ErrorBox, List, ListRow, Menu, PageHeader, PageSkeleton, ResultBadge, Section, SectionLink, StatusDot, StatusText, Surface } from '../components/ui';
import { useOutbox } from '../offline';
import { defectsLabel, fmtDate, fmtRelative, type Tone } from '../format';
import { type Round, useRounds } from './Dashboard';
import { InspectionsPage } from './Inspections';
import { StartWalkthrough } from './Walkthroughs';

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

export function roundStatus(r: Round): { tone: Tone; text: string } {
  if (r.overdue && r.earliest) return { tone: 'bad', text: `seit ${fmtRelative(r.earliest).replace(/^vor /, '')} überfällig` };
  if (r.earliest) return { tone: 'warn', text: `fällig ab ${fmtDate(r.earliest)}` };
  return { tone: 'info', text: 'nie geprüft' };
}

export function PruefenPage() {
  const [params] = useSearchParams();
  // Ausführliche Listen (früher /pruefungen?tab=…)
  if (params.get('tab')) return <InspectionsPage />;
  return <PruefenHub />;
}

function PruefenHub() {
  const { data: me } = useMe();
  const dash = useDashboard();
  const rounds = useRounds(30);
  const drafts = useInspections({ status: 'draft' });
  const done = useInspections({ status: 'submitted' });
  const walks = useWalkthroughs();
  const outbox = useOutbox();
  const [allRounds, setAllRounds] = useState(false);
  const [starting, setStarting] = useState(false);
  const canWrite = me?.user.role !== 'viewer';
  if (dash.isLoading) return <PageSkeleton />;
  if (dash.error || !dash.data) return <ErrorBox error={dash.error} onRetry={() => dash.refetch()} />;
  const c = dash.data.counts;
  const due = (rounds.data ?? []).filter((r) => r.overdue + r.due + r.never > 0);
  const topRound = due.find((r) => r.overdue + r.due > 0);
  const shownRounds = allRounds ? due : due.slice(0, 6);
  const dueRows: { tab: string; label: string; tone: Tone; value: number }[] = [
    { tab: 'overdue', label: 'Überfällig', tone: 'bad', value: c.overdue },
    { tab: 'soon', label: 'Bald fällig', tone: 'warn', value: c.soon },
    { tab: 'never', label: 'Nie geprüft', tone: 'info', value: c.never },
    { tab: 'not_inspectable', label: 'Nicht prüfbar', tone: 'muted', value: c.notInspectable },
  ];
  const openWalks = (walks.data ?? []).filter((w) => w.status === 'draft');
  const lastWalks = [...openWalks, ...(walks.data ?? []).filter((w) => w.status !== 'draft').slice(0, Math.max(0, 3 - openWalks.length))];
  const recent = (done.data ?? []).slice(0, 5);
  const draftRows = (drafts.data ?? []).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Prüfen"
        subtitle="Rundgänge, angefangene und abgeschlossene Prüfungen"
        actions={
          <>
            {canWrite && topRound && <ButtonLink to={`/rundgang/${topRound.buildingId}`}>Rundgang starten</ButtonLink>}
            <ButtonLink to="/scan" variant={canWrite && topRound ? 'ghost' : 'primary'} icon={<ScanLine />}>
              Scannen
            </ButtonLink>
            <Menu
              label="Weitere Aktionen zum Prüfen"
              items={[
                ...(canWrite ? [{ label: 'Begehung starten', icon: <Footprints />, onClick: () => setStarting(true) }] : []),
                { label: outbox.length ? `Offline-Modus (${outbox.length} wartend)` : 'Offline vorbereiten', icon: <CloudDownload />, to: '/offline' },
              ]}
            />
          </>
        }
      />
      {starting && <StartWalkthrough onClose={() => setStarting(false)} />}
      <Surface>
        <Section title="Rundgänge" count={due.length || undefined} action={<span className="text-meta text-ink-3">fällig in 30 Tagen</span>} flush>
          {rounds.data && due.length === 0 ? (
            <p className="px-(--row-px) pb-3 text-body text-ink-2">In den nächsten 30 Tagen ist nichts fällig.</p>
          ) : (
            <List plain aria-label="Rundgänge">
              {shownRounds.map((r) => {
                const st = roundStatus(r);
                return (
                  <ListRow
                    key={r.buildingId}
                    to={`/rundgang/${r.buildingId}`}
                    chevron
                    title={
                      <>
                        {r.buildingName}
                        <span className="text-ink-3"> · {r.propertyName}</span>
                      </>
                    }
                    subtitle={
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums">{n(r.assets.length, 'Element', 'Elemente')}</span>
                        <span aria-hidden>·</span>
                        <StatusText tone={st.tone}>{st.text}</StatusText>
                      </span>
                    }
                  />
                );
              })}
            </List>
          )}
          {!allRounds && due.length > 6 && (
            <p className="px-(--row-px) pt-1 pb-3">
              <button type="button" onClick={() => setAllRounds(true)} className="min-h-8 text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                Alle {due.length} anzeigen
              </button>
            </p>
          )}
        </Section>

        <Section title="Fällig" action={<SectionLink to="/pruefen?tab=new">Neue Elemente</SectionLink>} flush>
          <List plain aria-label="Fällig">
            {dueRows.map((d) => (
              <ListRow
                key={d.tab}
                to={`/pruefen?tab=${d.tab}`}
                chevron
                leading={<StatusDot tone={d.tone} />}
                title={d.label}
                trailing={<span className={d.value ? (d.tone === 'bad' ? 'text-shu tabular-nums' : 'text-ink tabular-nums') : 'text-ink-4 tabular-nums'}>{d.value}</span>}
              />
            ))}
          </List>
        </Section>

        <Section title="Angefangen" count={drafts.data?.length || undefined} action={(drafts.data?.length ?? 0) > 5 && <SectionLink to="/pruefen?tab=drafts">Alle</SectionLink>} flush>
          {drafts.data && draftRows.length === 0 ? (
            <p className="px-(--row-px) pb-3 text-body text-ink-2">Keine angefangenen Prüfungen.</p>
          ) : (
            <List plain aria-label="Angefangene Prüfungen">
              {draftRows.map((i) => (
                <ListRow
                  key={i.id}
                  to={`/pruefung/${i.id}`}
                  chevron
                  leading={<CategoryGlyph category={i.category} />}
                  title={
                    <>
                      {i.code} <span className="text-ink-3">· {scheduleLabel(i.category, i.schedule ?? 'main')}</span>
                    </>
                  }
                  subtitle={[`begonnen ${fmtRelative(i.createdAt)}`, i.inspector, [i.location, i.buildingName].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  trailing={<StatusText tone="info">Entwurf</StatusText>}
                />
              ))}
            </List>
          )}
        </Section>

        <Section title="Begehungen" action={<SectionLink to="/pruefen/begehungen">Alle</SectionLink>} flush>
          {walks.data && lastWalks.length === 0 ? (
            <p className="px-(--row-px) pb-3 text-body text-ink-2">Noch keine Begehung. Bei einer Begehung prüfst du ein ganzes Objekt mit Fragenkatalog.</p>
          ) : (
            <List plain aria-label="Begehungen">
              {lastWalks.map((w) => (
                <WalkListRow key={w.id} w={w} />
              ))}
            </List>
          )}
        </Section>

        <Section title="Zuletzt abgeschlossen" action={<SectionLink to="/pruefen?tab=done">Alle</SectionLink>} flush>
          {done.data && recent.length === 0 ? (
            <p className="px-(--row-px) pb-3 text-body text-ink-2">Noch keine Prüfung abgeschlossen.</p>
          ) : (
            <List plain aria-label="Zuletzt abgeschlossen">
              {recent.map((i) => (
                <ListRow
                  key={i.id}
                  to={`/druck/protokoll/${i.id}`}
                  chevron
                  leading={<CategoryGlyph category={i.category} />}
                  title={
                    <>
                      {i.code} <span className="text-ink-3">· {scheduleLabel(i.category, i.schedule ?? 'main')}</span>
                    </>
                  }
                  subtitle={[fmtDate(i.inspectedAt ?? i.createdAt), i.inspector, [i.location, i.buildingName].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  trailing={i.supersededAt ? <StatusText tone="muted">Berichtigt</StatusText> : i.result && <ResultBadge result={i.result} />}
                />
              ))}
            </List>
          )}
        </Section>
      </Surface>
    </>
  );
}

function WalkListRow({ w }: { w: WalkRow }) {
  return (
    <ListRow
      to={w.status === 'draft' ? `/begehung/${w.id}` : `/druck/begehung/${w.id}`}
      chevron
      title={
        <>
          {w.propertyName}
          {w.buildingName && <span className="text-ink-3"> · {w.buildingName}</span>}
        </>
      }
      subtitle={[fmtDate(w.inspectedAt ?? w.createdAt), w.inspector, w.purpose && w.purpose !== 'regular' && WALK_PURPOSES[w.purpose], w.openDefects > 0 && `${defectsLabel(w.openDefects)} offen`]
        .filter(Boolean)
        .join(' · ')}
      trailing={w.status === 'draft' ? <StatusText tone="info">Entwurf</StatusText> : w.result && <ResultBadge result={w.result} />}
    />
  );
}
