import { useId } from 'react';
import { THEMES, type Theme, type ThemeName } from '../settings';

const OPTIONS: Array<{ id: Theme; name: string }> = [{ id: 'system', name: 'System' }, ...THEMES];

/** A miniature page drawn with the theme's own colours (its tokens apply under data-theme). */
function Preview({ id }: { id: ThemeName }) {
  return (
    <span className="theme-preview" data-theme={id}>
      <span className="tp-line" />
      <span className="tp-line short" />
      <span className="tp-dot" />
    </span>
  );
}

/** Theme choice as a grid of previews (a styled radio group). */
export function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  const name = useId();
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <label key={o.id} className="theme-option" data-checked={o.id === value || undefined}>
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={o.id === value}
            onChange={() => onChange(o.id)}
          />
          <span className="theme-swatch" aria-hidden>
            {o.id === 'system' ? (
              <>
                <Preview id="graphite" />
                <Preview id="daylight" />
              </>
            ) : (
              <Preview id={o.id} />
            )}
          </span>
          <span className="theme-name">{o.name}</span>
        </label>
      ))}
    </div>
  );
}
