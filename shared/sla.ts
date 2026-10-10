export type Priority = 'low' | 'medium' | 'high';
export const HOUR = 3_600_000;
/** Standard-Reaktions- und Lösungszeiten in Stunden, wenn der Workspace nichts festgelegt hat. */
export const DEFAULT_SLA: Record<Priority, { responseHours: number; resolutionHours: number }> = {
  high: { responseHours: 4, resolutionHours: 48 },
  medium: { responseHours: 24, resolutionHours: 120 },
  low: { responseHours: 72, resolutionHours: 336 },
};
