// Diktat auswerten – rein regelbasiert (shared/smart.ts). Der Worker ruft keine KI auf:
// Sprache erkennt der Browser, Bilder und freie Texte versteht Claude über den MCP-Server (worker/mcp.ts).
import { Hono } from 'hono';
import { z } from 'zod';
import { parseCapture } from '../shared/smart';
import { listCategories } from './categories';
import { type AppEnv, requireRole } from './lib';

export const ai = new Hono<AppEnv>();

/** Fester Stand: keine Server-KI (Feldnamen bleiben für bestehende Clients gleich). */
ai.get('/ai/status', (c) => c.json({ transcribe: false, structure: 'rules', vision: false }));

/** Text (z. B. Diktat) in Mängel, Aufgaben, Notizen und Sammelanlagen zerlegen. */
ai.post('/ai/parse', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({
      text: z.string().trim().min(1).max(8000),
      checkpoints: z.array(z.object({ id: z.string().max(40), label: z.string().max(300) })).max(120).default([]),
      /** Elementarten für Sammelanlagen; ohne Angabe die des Workspaces */
      categories: z.array(z.object({ key: z.string().max(60), label: z.string().max(120), plural: z.string().max(120).optional() })).max(200).optional(),
    })
    .parse(await c.req.json());
  const categories = b.categories ?? (await listCategories(c)).map((x) => ({ key: x.key, label: x.label, plural: x.plural }));
  return c.json({ items: parseCapture(b.text, { checkpoints: b.checkpoints, categories }), source: 'rules' });
});
