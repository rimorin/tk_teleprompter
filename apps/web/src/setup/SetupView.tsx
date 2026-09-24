import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Lightbulb,
  Loader2,
  Mic,
  Moon,
  Play,
  ScrollText,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { parseScript } from '@teleprompter/shared';
import { MAX_SCRIPT_CHARS } from '../config';
import { SAMPLE_SCRIPT } from '../sampleScript';
import type { Theme } from '../settings';
import { Segmented } from '../ui/controls';
import { ACCEPTED_FILE_TYPES, checkScriptLength, ImportError, readScriptFile } from './importFile';
import { loadAccessCode, saveAccessCode } from '../live/accessCode';
import { useServerStatus, type ServerStatus } from './useServerStatus';

type Props = {
  text: string;
  onTextChange: (text: string) => void;
  onPresent: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

/** Typical presentation pace used for the duration estimate. */
const WORDS_PER_MINUTE = 140;
/** Show the length meter only once a script gets close to the limit. */
const SHOW_LENGTH_FROM = 0.8;

/** Developer-only fixes, shown in dev builds so presenters never see them. */
const DEV_HINTS: Partial<Record<ServerStatus, string>> = {
  not_configured: 'Set DEEPGRAM_API_KEY in apps/server/.env.',
  offline: 'Start the server with pnpm dev.',
};

const VOICE_STATUS: Record<ServerStatus, { icon: React.ReactNode; label: string; detail: string }> =
  {
    checking: {
      icon: <Loader2 size={16} className="spin" aria-hidden />,
      label: 'Checking…',
      detail: 'Checking that voice following is available.',
    },
    ready: {
      icon: <CheckCircle2 size={16} aria-hidden />,
      label: 'Ready',
      detail: 'When you present, tap the microphone and start speaking. The script follows you.',
    },
    not_configured: {
      icon: <AlertCircle size={16} aria-hidden />,
      label: 'Not set up',
      detail:
        'Voice following is not set up on this server. You can still present and move through the script by hand.',
    },
    offline: {
      icon: <WifiOff size={16} aria-hidden />,
      label: 'Unavailable',
      detail:
        'Can’t reach the server, so voice following is off. You can still present and move through the script by hand.',
    },
  };

export function SetupView({ text, onTextChange, onPresent, theme, onThemeChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaId = useId();
  const deferredText = useDeferredValue(text);
  const preview = useMemo(() => parseScript(deferredText), [deferredText]);
  const { status: serverStatus, codeRequired } = useServerStatus();
  const [accessCode, setAccessCode] = useState(loadAccessCode);
  const lengthError = checkScriptLength(text);
  const canPresent = !lengthError && text.trim().length > 0;
  const words = preview.tokens.filter((t) => t.normalized).length;
  const minutes = words / WORDS_PER_MINUTE;
  const usage = Math.min(1, text.length / MAX_SCRIPT_CHARS);
  const voice = VOICE_STATUS[serverStatus];
  const devHint = import.meta.env.DEV ? DEV_HINTS[serverStatus] : undefined;
  const empty = text.length === 0;
  const openFilePicker = () => fileInputRef.current?.click();

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      onTextChange(await readScriptFile(file));
    } catch (err) {
      setImportError(err instanceof ImportError ? err.message : 'Could not read this file.');
    } finally {
      setImporting(false);
    }
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    void importFile(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void importFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="setup">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <ScrollText size={20} />
          </span>
          <div>
            <h1>Teleprompter</h1>
            <p className="muted small">A script that follows your voice.</p>
          </div>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'dark', label: <Moon size={15} aria-label="Dark" />, title: 'Dark' },
            { value: 'light', label: <Sun size={15} aria-label="Light" />, title: 'Light' },
          ]}
        />
      </header>

      <main className="setup-grid">
        <section className="card editor-card" aria-labelledby={`${textareaId}-label`}>
          <div className="card-head">
            <label id={`${textareaId}-label`} htmlFor={textareaId} className="card-title">
              <FileText size={17} aria-hidden /> Script
            </label>
            <div className="card-actions" hidden={empty}>
              <button
                type="button"
                className="btn ghost"
                onClick={openFilePicker}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 size={15} className="spin" aria-hidden />
                ) : (
                  <Upload size={15} aria-hidden />
                )}
                {importing ? (
                  'Reading…'
                ) : (
                  <>
                    Upload<span className="upload-extra"> .txt / .docx</span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => onTextChange(SAMPLE_SCRIPT)}
              >
                <Sparkles size={15} aria-hidden /> Load sample
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => onTextChange('')}
                disabled={!text}
                aria-label="Clear"
                title="Clear script"
              >
                <Trash2 size={15} aria-hidden />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                onChange={handleFile}
                hidden
                data-testid="file-input"
              />
            </div>
          </div>

          <div
            className="dropzone"
            data-dragging={dragging || undefined}
            data-empty={empty || undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <textarea
              id={textareaId}
              value={text}
              onChange={(e) => {
                setImportError(null);
                onTextChange(e.target.value);
              }}
              aria-describedby={empty ? `${textareaId}-empty` : undefined}
              spellCheck
            />
            {empty && !dragging && (
              <div className="empty-state" id={`${textareaId}-empty`}>
                <p className="empty-title">Paste your talk here</p>
                <p className="muted small">
                  Or upload a .txt or .docx file. Leave a blank line between paragraphs.
                </p>
                <div className="empty-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={openFilePicker}
                    disabled={importing}
                  >
                    {importing ? (
                      <Loader2 size={15} className="spin" aria-hidden />
                    ) : (
                      <Upload size={15} aria-hidden />
                    )}
                    {importing ? 'Reading…' : 'Upload a file'}
                  </button>
                  <button type="button" className="btn" onClick={() => onTextChange(SAMPLE_SCRIPT)}>
                    <Sparkles size={15} aria-hidden /> Try the sample
                  </button>
                </div>
                <ol className="how-steps">
                  <li>Add your script</li>
                  <li>Tap Start presenting</li>
                  <li>Tap the mic and speak. The script follows your voice.</li>
                </ol>
              </div>
            )}
            {dragging && (
              <div className="drop-hint" aria-hidden>
                <Upload size={28} /> Drop to import
              </div>
            )}
          </div>

          {(usage >= SHOW_LENGTH_FROM || lengthError) && (
            <div className="card-foot">
              <div className="meter" aria-hidden>
                <div
                  className="meter-fill"
                  data-over={lengthError ? true : undefined}
                  style={{ width: `${usage * 100}%` }}
                />
              </div>
              <span className={lengthError ? 'error small' : 'muted small'}>
                {text.length.toLocaleString()} / {MAX_SCRIPT_CHARS.toLocaleString()} characters
              </span>
            </div>
          )}
          {(importError || lengthError) && (
            <p className="error small inline-error" role="alert">
              <AlertCircle size={15} aria-hidden /> {importError ?? lengthError}
            </p>
          )}
        </section>

        <aside className="sidebar">
          <section className="card start-card">
            <dl className="stats" aria-label="Script statistics">
              <div>
                <dt>Paragraphs</dt>
                <dd>{preview.paragraphs.length}</dd>
              </div>
              <div>
                <dt>Words</dt>
                <dd>{words.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Speaking</dt>
                <dd>{words ? (minutes < 1 ? '< 1 min' : `~${Math.round(minutes)} min`) : '–'}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn primary large"
              onClick={onPresent}
              disabled={!canPresent}
            >
              <Play size={18} aria-hidden fill="currentColor" /> Start presenting
            </button>
            {canPresent ? (
              <p className="muted small center hover-only-block">
                Press <kbd className="kbd">?</kbd> in the presenter for shortcuts.
              </p>
            ) : (
              !lengthError && <p className="muted small center">Add a script to start.</p>
            )}
          </section>

          <section className="card" aria-label="Voice following">
            <div className="card-title">
              <Mic size={17} aria-hidden /> Voice following
              <span className="voice-status" data-status={serverStatus}>
                {voice.icon} {voice.label}
              </span>
            </div>
            <p className="muted small">
              {voice.detail}
              {devHint && <span className="dev-hint"> Developer: {devHint}</span>}
            </p>
            {codeRequired && (
              <label className="field">
                <span className="small">Access code</span>
                <input
                  className="text-input"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={accessCode}
                  onChange={(e) => {
                    setAccessCode(e.target.value);
                    saveAccessCode(e.target.value.trim());
                  }}
                  placeholder="Needed for voice following"
                />
              </label>
            )}
            <p className="privacy small">
              Your script stays in this browser. Only while the microphone is on, your voice is sent
              through this app’s server to Deepgram to turn it into text. Nothing is recorded or
              stored.
            </p>
          </section>

          {preview.paragraphs.length > 0 && (
            <section className="card outline-card" aria-label="Paragraph outline">
              <div className="card-title">Outline</div>
              <ol className="outline">
                {preview.paragraphs.map((p) => (
                  <li key={p.id}>
                    <span className="outline-num">{p.id + 1}</span>
                    <span className="outline-text">
                      {preview.source.slice(p.startOffset, p.endOffset)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </main>

      <About />
    </div>
  );
}

/** Why the app exists, in a few plain sentences for speakers. */
function About() {
  return (
    <section className="about" aria-labelledby="about-title">
      <h2 id="about-title">Why this app</h2>
      <p className="muted">A teleprompter that listens, so you can look at your audience.</p>
      <div className="about-grid">
        <div className="card about-card" data-kind="problem">
          <h3 className="card-title">
            <AlertCircle size={17} aria-hidden /> The problem
          </h3>
          <ul>
            <li>
              Notes on a phone or tablet need scrolling. Every swipe takes your eyes off the room.
            </li>
            <li>
              When you look up to connect, you come back to a wall of text and lose your place.
            </li>
          </ul>
        </div>
        <div className="card about-card" data-kind="solution">
          <h3 className="card-title">
            <Lightbulb size={17} aria-hidden /> The solution
          </h3>
          <ul>
            <li>It listens as you speak and keeps your line at eye level. No scrolling.</li>
            <li>Look up, pause or tell a story. When you look back down, your place is waiting.</li>
            <li>Went somewhere else? Tap any word, and the script goes there.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
