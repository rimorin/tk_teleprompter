import { useEffect, useMemo, useState } from 'react';
import { initialTrackingState, parseScript, type TrackingState } from '@teleprompter/shared';
import { PresenterView } from './presenter/PresenterView';
import { SetupView } from './setup/SetupView';
import { loadSettings, saveSettings, type PresenterSettings } from './settings';
import { loadJson, saveJson } from './storage';

const SCRIPT_KEY = 'teleprompter.script.v1';

export function App() {
  const [view, setView] = useState<'setup' | 'presenter'>('setup');
  const [text, setText] = useState(() => loadJson<string>(SCRIPT_KEY) ?? '');
  const [settings, setSettings] = useState<PresenterSettings>(loadSettings);
  const [tracking, setTracking] = useState<TrackingState>(initialTrackingState);
  /** Script source the tracking state's token ids refer to. */
  const [trackedSource, setTrackedSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const script = useMemo(() => parseScript(text), [text]);

  useEffect(() => {
    const timer = setTimeout(() => saveJson(SCRIPT_KEY, text), 400);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => saveSettings(settings), [settings]);

  // Theme the page root too, so overscroll areas and mobile browser bars match.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0c0d10');
  }, [settings.theme]);

  function present() {
    if (trackedSource !== script.source) {
      // Token ids changed with the script; never silently shift the old position onto new text.
      if (trackedSource !== null && tracking.confirmedTokenId !== null) {
        setNotice('The script was edited, so the position was reset to the start.');
      }
      setTracking(initialTrackingState());
      setTrackedSource(script.source);
    }
    setView('presenter');
  }

  if (view === 'presenter') {
    return (
      <PresenterView
        script={script}
        settings={settings}
        onSettingsChange={setSettings}
        tracking={tracking}
        setTracking={setTracking}
        onExit={() => {
          setNotice(null);
          setView('setup');
        }}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />
    );
  }
  return (
    <div className="app" data-theme={settings.theme}>
      <SetupView
        text={text}
        onTextChange={setText}
        onPresent={present}
        theme={settings.theme}
        onThemeChange={(theme) => setSettings((s) => ({ ...s, theme }))}
      />
    </div>
  );
}
