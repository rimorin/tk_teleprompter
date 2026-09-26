import { useEffect, useState } from 'react';
import { fetchHealth } from '../net/health';

export type ServerStatus = 'checking' | 'ready' | 'not_configured' | 'offline';

type State = {
  status: ServerStatus;
  codeRequired: boolean;
  /** Speech providers the presenter can choose from, the server's default first. */
  providers: string[];
};

/** Whether live voice tracking is available, and whether it needs an access code. */
export function useServerStatus(): State {
  const [state, setState] = useState<State>({
    status: 'checking',
    codeRequired: false,
    providers: [],
  });
  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((health) => {
      if (cancelled) return;
      if (!health) setState({ status: 'offline', codeRequired: false, providers: [] });
      else
        setState({
          status: health.asr.configured ? 'ready' : 'not_configured',
          codeRequired: health.access.codeRequired,
          providers: health.asr.providers?.map((p) => p.name) ?? [health.asr.provider],
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
