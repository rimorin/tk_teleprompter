import { HealthResponse } from '@teleprompter/shared';
import { endpoints } from './endpoints';

/** GET /health, or null if the server is unreachable or the response is unexpected. */
export async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(endpoints.healthUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    return HealthResponse.parse(await res.json());
  } catch {
    return null;
  }
}
