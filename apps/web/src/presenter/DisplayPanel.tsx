import { Moon, Sun } from 'lucide-react';
import { SETTINGS_LIMITS, type PresenterSettings } from '../settings';
import { Segmented, Slider, Switch } from '../ui/controls';

type Props = {
  settings: PresenterSettings;
  onChange: (patch: Partial<PresenterSettings>) => void;
};

export function DisplayPanel({ settings, onChange }: Props) {
  const L = SETTINGS_LIMITS;
  return (
    <div className="panel-body">
      <h3 className="panel-title">Display</h3>
      <Segmented
        label="Theme"
        value={settings.theme}
        onChange={(theme) => onChange({ theme })}
        options={[
          {
            value: 'dark',
            label: (
              <>
                <Moon size={15} aria-hidden /> Dark
              </>
            ),
          },
          {
            value: 'light',
            label: (
              <>
                <Sun size={15} aria-hidden /> Light
              </>
            ),
          },
        ]}
      />
      <Segmented
        label="Typeface"
        value={settings.typeface}
        onChange={(typeface) => onChange({ typeface })}
        options={[
          { value: 'sans', label: <span className="face-sans">Sans</span> },
          { value: 'serif', label: <span className="face-serif">Serif</span> },
        ]}
      />
      <Slider
        label="Text size"
        value={settings.fontSizePx}
        {...L.fontSizePx}
        format={(v) => `${v}px`}
        onChange={(fontSizePx) => onChange({ fontSizePx })}
      />
      <Slider
        label="Line spacing"
        value={settings.lineHeight}
        {...L.lineHeight}
        format={(v) => v.toFixed(1)}
        onChange={(lineHeight) => onChange({ lineHeight: Math.round(lineHeight * 10) / 10 })}
      />
      <Slider
        label="Column width"
        value={settings.columnWidthEm}
        {...L.columnWidthEm}
        format={(v) => `${v} em`}
        onChange={(columnWidthEm) => onChange({ columnWidthEm })}
      />
      <Slider
        label="Reading line"
        value={settings.readingZone}
        {...L.readingZone}
        format={(v) => `${Math.round(v * 100)}% from top`}
        onChange={(readingZone) => onChange({ readingZone: Math.round(readingZone * 100) / 100 })}
      />
      <Switch
        label="Mirror text"
        hint="For beam-splitter teleprompter glass"
        checked={settings.mirrored}
        onChange={(mirrored) => onChange({ mirrored })}
      />
    </div>
  );
}
