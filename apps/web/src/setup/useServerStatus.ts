import { useEffect, useState } from 'react';
import { fetchHealth } from '../net/health';

export type ServerStatus = 'checking' | 'ready' | 'not_configured' | 'offline';

/** Whether live voice tracking is available, and whether it needs an access code. */
export function useServerStatus(): { status: ServerStatus; codeRequired: boolean } {
  const [state, setState] = useState<{ status: ServerStatus; codeRequired: boolean }>({
    status: 'checking',
    codeRequired: false,
  });
  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((health) => {
      if (cancelled) return;
      if (!health) setState({ status: 'offline', codeRequired: false });
      else
        setState({
          status: health.asr.configured ? 'ready' : 'not_configured',
          codeRequired: health.access.codeRequired,
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
