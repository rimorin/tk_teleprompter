import {
  AlertCircle,
  CheckCircle2,
  Contrast,
  FileText,
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

const VOICE_STATUS: Record<ServerStatus, { icon: React.ReactNode; label: string; detail: string }> =
  {
    checking: {
      icon: <Loader2 size={16} className="spin" aria-hidden />,
      label: 'Checking…',
      detail: 'Looking for the tracking server.',
    },
    ready: {
      icon: <CheckCircle2 size={16} aria-hidden />,
      label: 'Ready',
      detail: 'Start the microphone in the presenter and the script will follow your voice.',
    },
    not_configured: {
      icon: <AlertCircle size={16} aria-hidden />,
      label: 'Not configured',
      detail: 'Set DEEPGRAM_API_KEY in apps/server/.env to enable voice tracking.',
    },
    offline: {
      icon: <WifiOff size={16} aria-hidden />,
      label: 'Server offline',
      detail: 'Voice tracking needs the local server (pnpm dev). Manual mode works without it.',
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
            {
              value: 'contrast',
              label: <Contrast size={15} aria-label="High contrast" />,
              title: 'High contrast',
            },
          ]}
        />
      </header>

      <main className="setup-grid">
        <section className="card editor-card" aria-labelledby={`${textareaId}-label`}>
          <div className="card-head">
            <label id={`${textareaId}-label`} htmlFor={textareaId} className="card-title">
              <FileText size={17} aria-hidden /> Script
            </label>
            <div className="card-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => fileInputRef.current?.click()}
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
              placeholder={
                'Paste your script here, or drop a .txt / .docx file.\n\nSeparate paragraphs with a blank line.'
              }
              spellCheck
            />
            {dragging && (
              <div className="drop-hint" aria-hidden>
                <Upload size={28} /> Drop to import
              </div>
            )}
          </div>

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
            <p className="muted small center hover-only-block">
              Press <kbd className="kbd">?</kbd> in the presenter for shortcuts.
            </p>
          </section>

          <section className="card" aria-label="Voice tracking">
            <div className="card-title">
              <Mic size={17} aria-hidden /> Voice tracking
              <span className="voice-status" data-status={serverStatus}>
                {voice.icon} {voice.label}
              </span>
            </div>
            <p className="muted small">{voice.detail}</p>
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
                  placeholder="Required for voice tracking"
                />
              </label>
            )}
            <p className="privacy small">
              Your script stays in this browser. While the microphone is on, live audio is sent
              through this app’s server to Deepgram for transcription. Nothing is recorded or
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
    </div>
  );
}
