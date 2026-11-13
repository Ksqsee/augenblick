import { describe, expect, it } from 'vitest';
import { weekSummary } from './automation';
import { DAY } from './logic';
import { hasOneAction, monthBounds, neverItem, NOW_LIMIT, type NowItem, nowUrgency, rankNow } from './now';

const NOW = Date.UTC(2026, 10, 12, 9);
const item = (p: Partial<NowItem> & Pick<NowItem, 'id' | 'kind'>): NowItem => ({
  tone: 'info',
  title: p.id,
  text: '',
  count: 1,
  action: { verb: 'open', label: 'Öffnen', link: `/x/${p.id}` },
  ...p,
});

describe('Jetzt: Rangfolge', () => {
  it('Unterschriften stehen ganz oben – auch vor kritischen, lange liegenden Dingen', () => {
    const r = rankNow(
      [
        item({ id: 'crit', kind: 'defects_without_task', tone: 'bad', at: NOW - 400 * DAY }),
        item({ id: 'offline', kind: 'offline_failures', tone: 'bad', at: NOW - 90 * DAY }),
        item({ id: 'sign', kind: 'sign', tone: 'warn', action: { verb: 'sign', label: 'Unterschreiben', link: '/unterschreiben' } }),
      ],
      NOW,
    );
    expect(r.items.map((i) => i.id)).toEqual(['sign', 'offline', 'crit']);
  });

  it('kritische Mängel vor überfälligen Aufgaben, Rundgängen und Vorschlägen', () => {
    const r = rankNow(
      [
        item({ id: 'interval', kind: 'interval', tone: 'warn' }),
        item({ id: 'auto', kind: 'automation', tone: 'info', action: { verb: 'run', label: 'Ausführen', endpoint: '/automation/plan_week/run' } }),
        item({ id: 'round', kind: 'round', tone: 'bad', at: NOW - 10 * DAY }),
        item({ id: 'task', kind: 'overdue_tasks', tone: 'bad', at: NOW - 2 * DAY }),
        item({ id: 'defect', kind: 'defects_without_task', tone: 'bad' }),
        item({ id: 'draft', kind: 'stale_drafts' }),
      ],
      NOW,
    );
    expect(r.items.map((i) => i.id)).toEqual(['defect', 'task', 'round', 'auto', 'draft', 'interval']);
    expect(r.items.every((i, k) => k === 0 || r.items[k - 1].urgency >= i.urgency)).toBe(true);
  });

  it('Alter erhöht die Dringlichkeit, gedeckelt; Zukünftiges zählt nicht', () => {
    const base = nowUrgency({ kind: 'round', tone: 'warn', at: null }, NOW);
    expect(nowUrgency({ kind: 'round', tone: 'warn', at: NOW + 5 * DAY }, NOW)).toBe(base);
    expect(nowUrgency({ kind: 'round', tone: 'warn', at: NOW - 10 * DAY }, NOW)).toBe(base + 5);
    expect(nowUrgency({ kind: 'round', tone: 'warn', at: NOW - 1000 * DAY }, NOW)).toBe(base + 30);
  });

  it('höchstens zwölf Zeilen, der Rest als Zahl', () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ id: `t${String(i).padStart(2, '0')}`, kind: 'overdue_tasks', at: NOW - i * DAY }));
    const r = rankNow(many, NOW);
    expect(r.items).toHaveLength(NOW_LIMIT);
    expect(r.more).toBe(8);
    expect(r.items[0].id).toBe('t19');
  });

  it('jede Zeile hat genau eine Aktion; Zeilen ohne oder mit zwei Aktionen fallen weg', () => {
    expect(hasOneAction({ verb: 'open', label: 'Öffnen', link: '/a' })).toBe(true);
    expect(hasOneAction({ verb: 'run', label: 'Ausführen', endpoint: '/b' })).toBe(true);
    expect(hasOneAction({ verb: 'open', label: 'Öffnen', link: '/a', endpoint: '/b' })).toBe(false);
    expect(hasOneAction({ verb: 'open', label: 'Öffnen' })).toBe(false);
    const r = rankNow([item({ id: 'ok', kind: 'stale_drafts' }), item({ id: 'bad', kind: 'stale_drafts', action: { verb: 'open', label: 'Öffnen' } })], NOW);
    expect(r.items.map((i) => i.id)).toEqual(['ok']);
  });

  it('bei Gleichstand zuerst die Zeile mit mehr Dingen', () => {
    const r = rankNow([item({ id: 'a', kind: 'walkthrough_due', count: 1 }), item({ id: 'b', kind: 'walkthrough_due', count: 3 })], NOW);
    expect(r.items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('Jetzt: noch nie geprüft (v5)', () => {
  const g = { buildingId: 'b1', buildingName: 'Hauptgebäude', propertyName: 'Seehafer', never: 3, overdue: 0, due: 0, earliest: null };

  it('steht direkt nach den Unterschriften – vor kritischen Mängeln, Offline-Fehlern und Rundgängen, auch wenn diese lange liegen', () => {
    const r = rankNow(
      [
        item({ id: 'round', kind: 'round', tone: 'bad', at: NOW - 400 * DAY }),
        item({ id: 'crit', kind: 'defects_without_task', tone: 'bad', at: NOW - 400 * DAY }),
        item({ id: 'offline', kind: 'offline_failures', tone: 'bad', at: NOW - 400 * DAY }),
        neverItem(g),
        item({ id: 'sign', kind: 'sign', tone: 'warn', action: { verb: 'sign', label: 'Unterschreiben', link: '/unterschreiben' } }),
        item({ id: 'walk', kind: 'walkthrough_due', tone: 'bad' }),
        item({ id: 'auto', kind: 'automation', tone: 'info', action: { verb: 'open', label: 'Öffnen', link: '/berichte?monatsbericht=1' } }),
      ],
      NOW,
    );
    expect(r.items.map((i) => i.id)).toEqual(['sign', 'never-b1', 'offline', 'crit', 'round', 'walk', 'auto']);
  });

  it('Unterschriften bleiben vorn, auch wenn die nie geprüften Elemente schon lange überfällig sind', () => {
    const late = { ...neverItem({ ...g, overdue: 2, earliest: NOW - 1000 * DAY }) };
    expect(nowUrgency(late, NOW)).toBeLessThan(nowUrgency({ kind: 'sign', tone: 'warn', at: null }, NOW));
  });

  it('eine Zeile je Gebäude mit genau einer Aktion „Rundgang starten“', () => {
    const one = neverItem({ ...g, never: 1 });
    expect(one.title).toBe('Ein Element noch nie geprüft');
    expect(one.text).toBe('Hauptgebäude · Seehafer');
    expect(one.action).toEqual({ verb: 'start', label: 'Rundgang starten', link: '/rundgang/b1' });
    expect(hasOneAction(one.action)).toBe(true);
    const mixed = neverItem({ ...g, overdue: 2, due: 1 });
    expect(mixed.title).toBe('3 Elemente noch nie geprüft');
    expect(mixed.text).toBe('Hauptgebäude · Seehafer – außerdem 2 überfällig, 1 bald fällig');
    expect(mixed.tone).toBe('bad');
    expect(mixed.count).toBe(6);
  });
});

describe('Jetzt: Berichtsmonat in der Zeitzone des Workspaces', () => {
  it('Oktober in Berlin beginnt um 22 Uhr UTC am Vortag (Sommerzeit) und endet um 23 Uhr UTC (Winterzeit)', () => {
    const [from, to] = monthBounds('2026-10', 'Europe/Berlin');
    expect(new Date(from).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(new Date(to).toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('Dezember läuft ins neue Jahr; UTC ohne Versatz', () => {
    const [from, to] = monthBounds('2026-12', 'UTC');
    expect(from).toBe(Date.UTC(2026, 11, 1));
    expect(to).toBe(Date.UTC(2027, 0, 1));
  });
});

describe('Autopilot: Wochenzusammenfassung', () => {
  it('nennt die Schritte in Kreislauf-Reihenfolge und lässt leere weg', () => {
    expect(weekSummary({ verify_repairs: 2, plan_week: 3, assign_defect_tasks: 0 })).toBe('Planen 3 · Nachprüfen 2');
    expect(weekSummary({})).toBeNull();
  });
});
