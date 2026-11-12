import { describe, expect, it } from 'vitest';
import { MCP_PROMPTS, MCP_TOOLS } from '../shared/mcp';
import { PROMPTS, TOOLS } from './mcp';

describe('MCP-Server', () => {
  it('Werkzeugliste der Einstellungen passt zum Server', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(MCP_TOOLS.map(([n]) => n));
    expect(PROMPTS.map((p) => p.title)).toEqual(MCP_PROMPTS);
  });

  it('jedes Werkzeug hat Titel, ausführliche Beschreibung und ein geschlossenes Objekt-Schema', () => {
    for (const t of TOOLS) {
      expect(t.title.length, t.name).toBeGreaterThan(3);
      expect(t.description.length, t.name).toBeGreaterThan(120);
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      const props = t.inputSchema.properties as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(props)) expect(v.description, `${t.name}.${k}`).toBeTruthy();
      for (const r of (t.inputSchema.required as string[]) ?? []) expect(props[r], `${t.name}.${r}`).toBeTruthy();
    }
  });

  it('lesende Werkzeuge sind markiert, schreibende nicht', () => {
    const ro = TOOLS.filter((t) => t.readOnly).map((t) => t.name);
    expect(ro).toEqual(['briefing', 'search', 'list', 'get', 'get_photo', 'tour', 'report']);
  });

  it('Prompts erzeugen Text mit ihren Argumenten', () => {
    const p = PROMPTS.find((x) => x.name === 'rundgang_fuehren')!;
    expect(p.text({ gebaeude: 'Haupthaus' })).toContain('Haupthaus');
    expect(p.text({ gebaeude: 'Haupthaus' })).toContain('Unterschreibe nie');
  });
});
