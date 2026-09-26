import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Info,
  Loader2,
  Lock,
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
import { loadProviderChoice, providerDisplayName, saveProviderChoice } from '../live/asrProvider';
import { useServerStatus, type ServerStatus } from './useServerStatus';
import { About } from './About';
import { Sheet } from '../ui/Sheet';

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

const VOICE_STATUS: Record<ServerStatus, { icon: React.ReactNode; detail: string }> = {
  checking: {
    icon: <Loader2 size={14} className="spin" aria-hidden />,
    detail: 'Checking that voice following is available.',
  },
  ready: {
    icon: <CheckCircle2 size={14} aria-hidden />,
    detail: 'When you present, tap the microphone and start speaking. The script follows you.',
  },
  not_configured: {
    icon: <AlertCircle size={14} aria-hidden />,
    detail:
      'Voice following is not set up on this server. You can still present and move through the script by hand.',
  },
  offline: {
    icon: <WifiOff size={14} aria-hidden />,
    detail:
      'Can’t reach the server, so voice following is off. You can still present and move through the script by hand.',
  },
};

export function SetupView({ text, onTextChange, onPresent, theme, onThemeChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** null = automatic: open when the server needs a code and none was saved on this device. */
  const [voiceOpen, setVoiceOpen] = useState<boolean | null>(null);
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Whether the speaker has clicked or typed in the editor, so Paste knows the cursor counts. */
  const editedRef = useRef(false);
  const canReadClipboard = typeof navigator.clipboard?.readText === 'function';
  const deferredText = useDeferredValue(text);
  const preview = useMemo(() => parseScript(deferredText), [deferredText]);
  const { status: serverStatus, codeRequired, providers } = useServerStatus();
  const [accessCode, setAccessCode] = useState(loadAccessCode);
  const [savedProvider, setSavedProvider] = useState(loadProviderChoice);
  // The saved choice when the server offers it, else the server's default (as sessions resolve it).
  const provider = providers.find((p) => p === savedProvider) ?? providers[0];
  const [initialCode] = useState(accessCode);
  const lengthError = checkScriptLength(text);
  const canPresent = !lengthError && text.trim().length > 0;
  const words = preview.tokens.filter((t) => t.normalized).length;
  const minutes = words / WORDS_PER_MINUTE;
  const usage = Math.min(1, text.length / MAX_SCRIPT_CHARS);
  const voice = VOICE_STATUS[serverStatus];
  const devHint = import.meta.env.DEV ? DEV_HINTS[serverStatus] : undefined;
  const empty = text.length === 0;
  const openFilePicker = () => fileInputRef.current?.click();
  const needsCode = codeRequired && !accessCode.trim();
  const showVoice = voiceOpen ?? (codeRequired && !initialCode);
  const chipLabel = needsCode
    ? 'Access code needed'
    : serverStatus === 'ready'
      ? 'Voice ready'
      : serverStatus === 'checking'
        ? 'Checking voice…'
        : 'Voice off';

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

  /**
   * Paste like the keyboard shortcut would: fill an empty script, insert at the cursor (or over
   * the selection) once the editor has been used, otherwise add it at the end as a new paragraph.
   */
  async function pasteFromClipboard() {
    setImportError(null);
    let clip: string;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      setImportError(
        'The browser did not allow reading the clipboard. Tap in the box and choose Paste instead.',
      );
      return;
    }
    if (!clip.trim()) {
      setImportError('The clipboard is empty. Copy your script first.');
      return;
    }
    const el = textareaRef.current;
    let next: string;
    let caret: number;
    if (!text) {
      next = clip;
      caret = clip.length;
    } else if (el && editedRef.current) {
      next = text.slice(0, el.selectionStart) + clip + text.slice(el.selectionEnd);
      caret = el.selectionStart + clip.length;
    } else {
      const sep = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
      next = text + sep + clip;
      caret = next.length;
    }
    onTextChange(next);
    // Put the cursor after the pasted text once React has rendered it.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
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
        <div className="header-actions">
          <button
            type="button"
            className="btn ghost about-btn"
            onClick={() => setAboutOpen(true)}
            aria-haspopup="dialog"
          >
            <Info size={16} aria-hidden /> About
          </button>
          <Segmented
            label="Theme"
            value={theme}
            onChange={onThemeChange}
            options={[
              { value: 'dark', label: <Moon size={15} aria-label="Dark" />, title: 'Dark' },
              { value: 'light', label: <Sun size={15} aria-label="Light" />, title: 'Light' },
            ]}
          />
        </div>
      </header>

      {/* The one main action: top right on larger screens, a bar within thumb reach on phones. */}
      <div className="start-bar">
        <button
          type="button"
          className="btn primary large"
          onClick={onPresent}
          disabled={!canPresent}
        >
          <Play size={18} aria-hidden fill="currentColor" /> Start presenting
        </button>
        {!canPresent && !lengthError && (
          <p className="muted small center start-hint">Add a script to start.</p>
        )}
      </div>

      <main className="doc">
        <div className="doc-toolbar">
          <div className="card-actions" hidden={empty}>
            {canReadClipboard && (
              <button type="button" className="btn ghost" onClick={() => void pasteFromClipboard()}>
                <ClipboardPaste size={15} aria-hidden /> Paste
              </button>
            )}
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
              {importing ? 'Reading…' : 'Upload'}
            </button>
            <button
              type="button"
              className="btn ghost"
              aria-label="Load sample"
              onClick={() => onTextChange(SAMPLE_SCRIPT)}
            >
              <Sparkles size={15} aria-hidden />
              <span className="label-long">Load sample</span>
              <span className="label-short">Sample</span>
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
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            onChange={handleFile}
            hidden
            data-testid="file-input"
          />
          <button
            type="button"
            className="voice-chip"
            data-status={needsCode ? 'code' : serverStatus}
            onClick={() => setVoiceOpen(!showVoice)}
            aria-expanded={showVoice}
            aria-controls={`${textareaId}-voice`}
          >
            {voice.icon} {chipLabel}
            <ChevronDown size={14} aria-hidden className="chip-caret" />
          </button>
        </div>

        {showVoice && (
          <section
            id={`${textareaId}-voice`}
            className="voice-details"
            aria-label="Voice following"
          >
            <p>
              {voice.detail}
              {devHint && <span className="dev-hint"> Developer: {devHint}</span>}
            </p>
            {serverStatus === 'ready' && providers.length > 1 && (
              <div className="field">
                <span className="small">Speech service</span>
                <Segmented
                  label="Speech service"
                  value={provider!}
                  onChange={(name) => {
                    setSavedProvider(name);
                    saveProviderChoice(name);
                  }}
                  options={providers.map((name) => ({
                    value: name,
                    label: providerDisplayName(name),
                  }))}
                />
                {provider === 'assemblyai' && (
                  <span className="muted small">
                    Confirms words about a second sooner. Uses about 8 times more data.
                  </span>
                )}
              </div>
            )}
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
            <p className="muted small">
              Your script stays in this browser. Only while the microphone is on, your voice is sent
              through this app’s server to {provider ? providerDisplayName(provider) : 'Deepgram'}{' '}
              to turn it into text. Nothing is recorded or stored.
            </p>
          </section>
        )}

        <label htmlFor={textareaId} className="sr-only">
          Script
        </label>
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
            ref={textareaRef}
            id={textareaId}
            // Only the speaker's own taps and keys count, not the focus Paste gives back.
            onPointerDown={() => (editedRef.current = true)}
            onKeyDown={() => (editedRef.current = true)}
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
                Tap Paste, or upload a .txt or .docx file. Leave a blank line between paragraphs.
              </p>
              <div className="empty-actions">
                {canReadClipboard && (
                  <button type="button" className="btn" onClick={() => void pasteFromClipboard()}>
                    <ClipboardPaste size={15} aria-hidden /> Paste
                  </button>
                )}
                <button type="button" className="btn" onClick={openFilePicker} disabled={importing}>
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

        <div className="doc-meta">
          <dl className="stats" aria-label="Script statistics">
            <div>
              <dd>{preview.paragraphs.length}</dd>
              <dt>{preview.paragraphs.length === 1 ? 'paragraph' : 'paragraphs'}</dt>
            </div>
            <div>
              <dd>{words.toLocaleString()}</dd>
              <dt>words</dt>
            </div>
            <div>
              <dd>{words ? (minutes < 1 ? '< 1 min' : `~${Math.round(minutes)} min`) : '–'}</dd>
              <dt>speaking</dt>
            </div>
          </dl>
          <span className="muted small doc-private">
            <Lock size={13} aria-hidden /> Stays in this browser
          </span>
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
      </main>

      {aboutOpen && (
        <Sheet label="About this app" onClose={() => setAboutOpen(false)} wide>
          <About />
        </Sheet>
      )}
    </div>
  );
}
