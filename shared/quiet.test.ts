import { describe, expect, it } from 'vitest';
import { inQuietHours } from './quiet';

// 10.10.2026 ist ein Samstag; Berlin = UTC+2 (Sommerzeit)
const at = (iso: string) => Date.parse(iso);
const night = { enabled: true, from: '22:00', to: '07:00', weekends: false, timeZone: 'Europe/Berlin' };

describe('inQuietHours', () => {
  it('über Mitternacht', () => {
    expect(inQuietHours(night, at('2026-10-08T21:30:00Z'))).toBe(true); // 23:30 Berlin
    expect(inQuietHours(night, at('2026-10-09T04:59:00Z'))).toBe(true); // 06:59
    expect(inQuietHours(night, at('2026-10-09T05:00:00Z'))).toBe(false); // 07:00
    expect(inQuietHours(night, at('2026-10-09T10:00:00Z'))).toBe(false);
  });
  it('am selben Tag und ausgeschaltet', () => {
    const lunch = { ...night, from: '12:00', to: '13:00' };
    expect(inQuietHours(lunch, at('2026-10-08T10:30:00Z'))).toBe(true);
    expect(inQuietHours(lunch, at('2026-10-08T11:00:00Z'))).toBe(false);
    expect(inQuietHours({ ...night, enabled: false }, at('2026-10-08T21:30:00Z'))).toBe(false);
  });
  it('Wochenende ganztägig', () => {
    expect(inQuietHours({ ...night, weekends: true }, at('2026-10-10T10:00:00Z'))).toBe(true);
    expect(inQuietHours(night, at('2026-10-10T10:00:00Z'))).toBe(false);
  });
});
