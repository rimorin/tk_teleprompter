import { describe, expect, it } from 'vitest';
import { AccessControl } from './accessControl';

const limits = {
  accessCode: 'open sesame',
  maxConcurrentSessions: 3,
  maxSessionsPerIp: 2,
  maxSessionMs: 60_000,
  maxAccessFailures: 3,
  accessFailureWindowMs: 60_000,
};

describe('AccessControl', () => {
  it('requires the access code when configured', () => {
    const ac = new AccessControl(limits);
    expect(ac.codeRequired).toBe(true);
    expect(ac.admit('1.1.1.1', undefined)).toBe('access_denied');
    expect(ac.admit('1.1.1.1', 'wrong')).toBe('access_denied');
    expect(ac.admit('1.1.1.1', 'open sesame')).toBeNull();
    expect(new AccessControl({ ...limits, accessCode: null }).admit('x', undefined)).toBeNull();
  });

  it('locks out an IP after repeated failures until the window passes', () => {
    let t = 0;
    const ac = new AccessControl(limits, () => t);
    for (let i = 0; i < 3; i++) expect(ac.admit('2.2.2.2', 'nope')).toBe('access_denied');
    expect(ac.admit('2.2.2.2', 'open sesame')).toBe('too_many_attempts');
    expect(ac.admit('3.3.3.3', 'open sesame')).toBeNull(); // other IPs unaffected
    t = 60_001;
    expect(ac.admit('2.2.2.2', 'open sesame')).toBeNull();
  });

  it('caps concurrent sessions globally and per IP, and frees slots on release', () => {
    const ac = new AccessControl({ ...limits, accessCode: null });
    expect(ac.admit('a', undefined)).toBeNull();
    expect(ac.admit('a', undefined)).toBeNull();
    expect(ac.admit('a', undefined)).toBe('server_busy'); // per-IP cap
    expect(ac.admit('b', undefined)).toBeNull();
    expect(ac.admit('c', undefined)).toBe('server_busy'); // global cap
    ac.release('a');
    expect(ac.admit('c', undefined)).toBeNull(); // freed a global slot
    expect(ac.admit('d', undefined)).toBe('server_busy');
  });
});
