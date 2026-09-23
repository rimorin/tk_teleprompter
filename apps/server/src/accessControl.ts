import { createHash, timingSafeEqual } from 'node:crypto';
import type { ErrorCode } from '@teleprompter/shared';
import type { SessionLimits } from './config';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/**
 * Guards the (paid) speech provider: optional shared access code with per-IP brute-force
 * lockout, a global cap on concurrent sessions, and a per-IP cap. In-memory, so limits are
 * per server instance: run a single replica (or move these counters to a shared store).
 */
export class AccessControl {
  private active = 0;
  private readonly perIp = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  private readonly codeDigest: Buffer | null;

  constructor(
    readonly limits: SessionLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.codeDigest = limits.accessCode ? digest(limits.accessCode) : null;
  }

  get codeRequired(): boolean {
    return this.codeDigest !== null;
  }

  /** Check a session start. On success the slot is held until `release(ip)`. */
  admit(ip: string, accessCode: string | undefined): ErrorCode | null {
    const failure = this.failures.get(ip);
    if (failure && failure.resetAt <= this.now()) this.failures.delete(ip);
    if ((this.failures.get(ip)?.count ?? 0) >= this.limits.maxAccessFailures)
      return 'too_many_attempts';

    if (this.codeDigest && !(accessCode && timingSafeEqual(digest(accessCode), this.codeDigest))) {
      const entry = this.failures.get(ip) ?? {
        count: 0,
        resetAt: this.now() + this.limits.accessFailureWindowMs,
      };
      entry.count++;
      this.failures.set(ip, entry);
      return 'access_denied';
    }
    if (this.active >= this.limits.maxConcurrentSessions) return 'server_busy';
    if ((this.perIp.get(ip) ?? 0) >= this.limits.maxSessionsPerIp) return 'server_busy';

    this.active++;
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    return null;
  }

  release(ip: string): void {
    this.active = Math.max(0, this.active - 1);
    const n = (this.perIp.get(ip) ?? 1) - 1;
    if (n <= 0) this.perIp.delete(ip);
    else this.perIp.set(ip, n);
  }
}
