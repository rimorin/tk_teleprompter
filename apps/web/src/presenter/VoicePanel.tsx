import { useId, useState } from 'react';
import {
  describeProvider,
  loadProviderChoice,
  resolveProvider,
  saveProviderChoice,
} from '../live/asrProvider';
import { useServerStatus } from '../setup/useServerStatus';

/** Choice of speech service, shown only when the server offers more than one. */
export function VoicePanel({ micOn }: { micOn: boolean }) {
  const { status, providers } = useServerStatus();
  const [saved, setSaved] = useState(loadProviderChoice);
  const name = useId();
  if (status !== 'ready' || providers.length < 2) return null;
  const current = resolveProvider(providers, saved)?.name;
  return (
    <section className="panel-body">
      <h3 className="panel-title">Voice</h3>
      <div className="choices" role="radiogroup" aria-label="Speech service">
        {providers.map((p) => {
          const d = describeProvider(p.name);
          return (
            <label key={p.name} className="choice" data-checked={p.name === current || undefined}>
              <input
                type="radio"
                name={name}
                value={p.name}
                checked={p.name === current}
                onChange={() => {
                  setSaved(p.name);
                  saveProviderChoice(p.name);
                }}
              />
              <span className="choice-text">
                <span className="choice-label">
                  {d.label} <span className="choice-vendor">{d.vendor}</span>
                </span>
                <small>{d.detail}</small>
              </span>
            </label>
          );
        })}
      </div>
      {micOn && <p className="muted small">Applies the next time you start the microphone.</p>}
    </section>
  );
}
