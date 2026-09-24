import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  createMatchContext,
  markDisconnected,
  pauseTracking,
  reposition,
  simulateReading,
  startTracking,
  stopTracking,
  update,
  type ParsedScript,
  type TrackingState,
} from '@teleprompter/shared';
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Keyboard,
  Maximize2,
  Mic,
  Minimize2,
  Pause,
  Play,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import { SETTINGS_LIMITS, type PresenterSettings } from '../settings';
import { Sheet } from '../ui/Sheet';
import { Switch } from '../ui/controls';
import { AccessCodeDialog } from '../live/AccessCodeDialog';
import { saveAccessCode } from '../live/accessCode';
import { useLiveSession } from '../live/useLiveSession';
import { useAutoScroll } from '../scroll/useAutoScroll';
import { playSimulation, type SimPlayer } from '../sim/simPlayer';
import { scenarioOptions, SIM_SCENARIOS, type SimScenario } from '../sim/scenarios';
import { currentParagraphId, focusTokenId, paragraphStepTarget } from './cursor';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { DisplayPanel } from './DisplayPanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useIdle } from './useIdle';
import { useWakeLock } from './useWakeLock';
import { ScriptDisplay } from './ScriptDisplay';
import { StatusPill, type Source } from './StatusPill';

type Props = {
  script: ParsedScript;
  settings: PresenterSettings;
  onSettingsChange: (settings: PresenterSettings) => void;
  tracking: TrackingState;
  setTracking: Dispatch<SetStateAction<TrackingState>>;
  onExit: () => void;
  notice: string | null;
  onDismissNotice: () => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}

function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.().catch(() => {});
  }, [ref]);
  return {
    isFullscreen,
    toggle,
    supported: typeof document.documentElement.requestFullscreen === 'function',
  };
}

function Toast({
  message,
  error = false,
  onDismiss,
}: {
  message: string;
  error?: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className={error ? 'toast error' : 'toast'} role={error ? 'alert' : 'note'}>
      {error && <Activity size={16} aria-hidden />}
      <span>{message}</span>
      <button
        type="button"
        className="icon-btn small"
        onClick={onDismiss}
        aria-label={error ? 'Dismiss error' : 'Dismiss notice'}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Offers the distant place the speaker seems to have skipped to; one tap moves there. */
function JumpChip({
  script,
  tokenId,
  onJump,
}: {
  script: ParsedScript;
  tokenId: number;
  onJump: () => void;
}) {
  // The last few words heard there, as written, so the speaker recognizes the spot.
  const paragraph = script.paragraphs[script.tokens[tokenId]!.paragraphId]!;
  const from = script.tokens[Math.max(paragraph.firstTokenId, tokenId - 4)]!;
  const snippet = script.source.slice(from.startOffset, script.tokens[tokenId]!.endOffset);
  return (
    <button type="button" className="toast jump" onClick={onJump} aria-live="polite">
      <CornerDownRight size={18} aria-hidden />
      <span>
        Jump to <q>…{snippet}</q>
      </span>
      <span className="jump-tap" aria-hidden>
        Tap
      </span>
    </button>
  );
}

export function PresenterView({
  script,
  settings,
  onSettingsChange,
  tracking,
  setTracking,
  onExit,
  notice,
  onDismissNotice,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  const ctx = useMemo(() => createMatchContext(script), [script]);
  const [source, setSource] = useState<Source>('none');
  const [scenario, setScenario] = useState<SimScenario>('clean');
  /** Each simulation run gets a new seed so repeated runs differ, while staying reproducible. */
  const [simRuns, setSimRuns] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** null = closed; otherwise whether the last code was rejected. */
  const [codePrompt, setCodePrompt] = useState<{ rejected: boolean } | null>(null);
  const simRef = useRef<SimPlayer | null>(null);
  const focus = focusTokenId(script, tracking);
  const lineHeightPx = settings.fontSizePx * settings.lineHeight;

  useAutoScroll(scrollerRef, focus, {
    readingZone: settings.readingZone,
    lineHeightPx,
    layoutKey: `${settings.fontSizePx}|${settings.lineHeight}|${settings.readingZone}|${settings.columnWidthEm}|${settings.typeface}|${settings.mirrored}|${fullscreen.isFullscreen}`,
  });

  const stopSimulation = () => {
    simRef.current?.stop();
    simRef.current = null;
    setSource('none');
    setTracking(stopTracking);
  };

  const startSimulation = () => {
    simRef.current?.stop();
    const events = simulateReading(
      script,
      scenarioOptions(script, scenario, focus ?? 0, simRuns + 1),
    );
    setSimRuns((n) => n + 1);
    setTracking(startTracking);
    setSource('simulation');
    simRef.current = playSimulation(
      events,
      (ev) => setTracking((s) => update(ctx, s, ev)),
      stopSimulation,
    );
  };

  // Stop any simulation when leaving the presenter.
  useEffect(() => () => simRef.current?.stop(), []);

  const live = useLiveSession({
    // A reconnect keeps a paused session paused.
    onListening: () => setTracking((s) => (s.status === 'paused' ? s : startTracking(s))),
    onReconnecting: () => setTracking((s) => (s.status === 'paused' ? s : markDisconnected(s))),
    onTranscript: (ev) => setTracking((s) => update(ctx, s, ev)),
    onInterrupted: () => {
      setSource('none');
      // Freeze automatic tracking but keep the position; manual control keeps working.
      setTracking(markDisconnected);
    },
    onStopped: () => {
      setSource('none');
      setTracking(stopTracking);
    },
    onNeedsAccessCode: (rejected) => setCodePrompt({ rejected }),
  });
  const micOn = source === 'microphone';
  const toggleMic = () => {
    if (micOn) {
      void live.stop();
    } else if (source === 'none') {
      setSource('microphone');
      void live.start().then((result) => {
        if (result !== 'started') setSource('none');
      });
    }
  };

  const active = source !== 'none';
  const togglePause = () => {
    if (!active) return;
    setTracking((s) => (s.status === 'paused' ? startTracking(s) : pauseTracking(s)));
  };
  const goTo = (tokenId: number | null) => {
    if (tokenId !== null) setTracking((s) => reposition(s, tokenId));
  };

  const update_ = (patch: Partial<PresenterSettings>) =>
    onSettingsChange({ ...settings, ...patch });
  const changeFont = (delta: number) => {
    const { min, max } = SETTINGS_LIMITS.fontSizePx;
    update_({ fontSizePx: Math.min(max, Math.max(min, settings.fontSizePx + delta)) });
  };
  const step = (delta: 1 | -1) => goTo(paragraphStepTarget(script, tracking, delta));

  // Latest-value ref so the global key listener never goes stale.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      const actions: Record<string, () => void> = {
        ArrowDown: () => step(1),
        PageDown: () => step(1),
        ArrowUp: () => step(-1),
        PageUp: () => step(-1),
        Home: () => goTo(0),
        ' ': togglePause,
        m: toggleMic,
        f: fullscreen.toggle,
        d: () => setShowDiagnostics((v) => !v),
        '?': () => setShowShortcuts((v) => !v),
        '+': () => changeFont(SETTINGS_LIMITS.fontSizePx.step),
        '=': () => changeFont(SETTINGS_LIMITS.fontSizePx.step),
        '-': () => changeFont(-SETTINGS_LIMITS.fontSizePx.step),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const paragraphIndex = currentParagraphId(script, tracking) ?? 0;
  const progress = script.tokens.length
    ? ((tracking.confirmedTokenId ?? -1) + 1) / script.tokens.length
    : 0;
  const finished =
    script.tokens.length > 0 && tracking.confirmedTokenId === script.tokens.length - 1;
  const connecting = micOn && (live.phase === 'starting' || live.phase === 'connecting');
  const reconnecting = micOn && live.phase === 'reconnecting';
  const paused = tracking.status === 'paused';
  const jumpTarget =
    active &&
    tracking.jumpSuggestion !== null &&
    tracking.jumpSuggestion > (tracking.confirmedTokenId ?? -1)
      ? tracking.jumpSuggestion
      : null;
  // Fade controls away (mouse devices only) while tracking runs normally. Anything needing
  // attention — paused, lost place, disconnected, errors — keeps them visible.
  const idle = useIdle(
    active &&
      tracking.status === 'tracking' &&
      !settingsOpen &&
      !showShortcuts &&
      !codePrompt &&
      !live.error &&
      jumpTarget === null,
  );
  useWakeLock(true);
  const title = script.source.slice(0, 80).split(/\s+/).slice(0, 7).join(' ');

  return (
    <div
      ref={rootRef}
      className="presenter"
      data-theme={settings.theme}
      data-face={settings.typeface}
      data-idle={idle || undefined}
      style={
        {
          '--font-size': `${settings.fontSizePx}px`,
          '--line-height': settings.lineHeight,
          '--zone': settings.readingZone,
          '--column': `${settings.columnWidthEm}em`,
        } as React.CSSProperties
      }
    >
      <header className="topstrip">
        <button
          type="button"
          className="icon-btn"
          onClick={onExit}
          aria-label="Back to setup"
          title="Back to setup"
        >
          <ArrowLeft size={20} aria-hidden />
        </button>
        <span className="script-title" title={title}>
          {title}…
        </span>
        <StatusPill
          status={tracking.status}
          source={source}
          connecting={connecting}
          reconnecting={reconnecting}
        />
        <span
          className="para-count"
          aria-label={`Paragraph ${paragraphIndex + 1} of ${script.paragraphs.length}`}
        >
          {paragraphIndex + 1}/{script.paragraphs.length}
        </span>
        <div className="progress" aria-hidden="true">
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </header>

      <div className="viewport">
        <div className="reading-zone" aria-hidden="true" />
        <div ref={scrollerRef} className="scroller" data-testid="scroller">
          <div className={settings.mirrored ? 'content mirrored' : 'content'}>
            <ScriptDisplay
              script={script}
              confirmedTokenId={tracking.confirmedTokenId}
              tentativeTokenId={tracking.tentativeTokenId}
              nextTokenId={finished ? null : focus}
              onReposition={goTo}
            />
            <div className="end-mark" data-finished={finished || undefined}>
              End of script
            </div>
          </div>
        </div>
        {showDiagnostics && <DiagnosticsPanel state={tracking} />}
      </div>

      <div className="toasts">
        {jumpTarget !== null && (
          <JumpChip script={script} tokenId={jumpTarget} onJump={() => goTo(jumpTarget + 1)} />
        )}
        {live.error && <Toast error message={live.error} onDismiss={live.clearError} />}
        {notice && <Toast message={notice} onDismiss={onDismissNotice} />}
      </div>

      <nav className="dock" role="toolbar" aria-label="Presenter controls">
        <button
          type="button"
          className="dock-btn"
          onClick={() => step(-1)}
          aria-label="Previous paragraph"
          title="Previous paragraph (↑)"
        >
          <ChevronUp size={24} aria-hidden />
        </button>
        <button
          type="button"
          className="dock-btn"
          onClick={togglePause}
          disabled={!active}
          aria-label={paused ? 'Resume tracking' : 'Pause tracking'}
          title={`${paused ? 'Resume' : 'Pause'} tracking (Space)`}
        >
          {paused ? <Play size={22} aria-hidden /> : <Pause size={22} aria-hidden />}
        </button>
        {source === 'simulation' ? (
          <button
            type="button"
            className="mic-btn"
            data-live
            onClick={stopSimulation}
            aria-label="Stop simulation"
            title="Stop simulation"
          >
            <Square size={22} aria-hidden fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="mic-btn"
            data-live={micOn || undefined}
            data-connecting={connecting || undefined}
            onClick={toggleMic}
            disabled={live.phase === 'stopping'}
            aria-pressed={micOn}
            aria-label={micOn ? 'Stop microphone' : 'Start microphone'}
            title="Follow your voice (M). Audio is sent to the speech provider while on."
          >
            {micOn ? (
              <Square size={22} aria-hidden fill="currentColor" />
            ) : (
              <Mic size={26} aria-hidden />
            )}
          </button>
        )}
        <button
          type="button"
          className="dock-btn"
          onClick={() => step(1)}
          aria-label="Next paragraph"
          title="Next paragraph (↓)"
        >
          <ChevronDown size={24} aria-hidden />
        </button>
        <button
          type="button"
          className="dock-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
          aria-haspopup="dialog"
        >
          <Settings2 size={22} aria-hidden />
        </button>
        {fullscreen.supported && (
          <button
            type="button"
            className="dock-btn desktop-only"
            onClick={fullscreen.toggle}
            aria-label={fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title="Fullscreen (F)"
          >
            {fullscreen.isFullscreen ? (
              <Minimize2 size={20} aria-hidden />
            ) : (
              <Maximize2 size={20} aria-hidden />
            )}
          </button>
        )}
      </nav>

      {settingsOpen && (
        <Sheet label="Settings" onClose={() => setSettingsOpen(false)}>
          <DisplayPanel settings={settings} onChange={update_} />
          <section className="panel-body">
            <h3 className="panel-title">Practice without a microphone</h3>
            <p className="muted small">
              Simulates a speaker reading from the current position, with realistic recognition
              behaviour.
            </p>
            <div className="stack">
              <select
                aria-label="Simulation scenario"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as SimScenario)}
                disabled={active}
              >
                {SIM_SCENARIOS.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSettingsOpen(false);
                  startSimulation();
                }}
                disabled={active}
              >
                <Play size={16} aria-hidden /> Start simulation
              </button>
            </div>
          </section>
          <section className="panel-body">
            <h3 className="panel-title">Tools</h3>
            <Switch
              label="Diagnostics"
              hint="Live transcript and matcher decisions"
              checked={showDiagnostics}
              onChange={setShowDiagnostics}
            />
            {fullscreen.supported && (
              <button type="button" className="btn ghost full" onClick={fullscreen.toggle}>
                <Maximize2 size={16} aria-hidden />
                {fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </button>
            )}
            <button
              type="button"
              className="btn ghost full hover-only"
              onClick={() => {
                setSettingsOpen(false);
                setShowShortcuts(true);
              }}
            >
              <Keyboard size={16} aria-hidden /> Keyboard shortcuts <span className="kbd">?</span>
            </button>
          </section>
        </Sheet>
      )}

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      {codePrompt && (
        <AccessCodeDialog
          rejected={codePrompt.rejected}
          onClose={() => setCodePrompt(null)}
          onSubmit={(code) => {
            saveAccessCode(code);
            setCodePrompt(null);
            toggleMic();
          }}
        />
      )}
    </div>
  );
}
