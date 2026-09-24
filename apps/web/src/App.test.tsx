import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

function tokenClass(text: string) {
  return screen.getByText(text, { selector: '[data-tid]' }).className;
}

describe('App (manual mode)', () => {
  beforeEach(() => window.localStorage.clear());

  it('pastes a script, presents it, and navigates manually', async () => {
    const user = userEvent.setup();
    render(<App />);
    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.paste('Alpha beta gamma.\n\nDelta epsilon.\n\nZeta eta.');
    expect(within(screen.getByLabelText('Script statistics')).getByText('3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    const scroller = screen.getByTestId('scroller');
    expect(within(scroller).getByText('Alpha')).toBeInTheDocument();
    expect(tokenClass('Alpha')).toContain('next');
    // One marker glides behind the next word.
    expect(document.querySelectorAll('.focus-marker')).toHaveLength(1);
    expect(document.querySelector('.focus-marker')).not.toHaveAttribute('hidden');

    await user.click(screen.getByRole('button', { name: 'Next paragraph' }));
    expect(tokenClass('Delta')).toContain('next');
    expect(tokenClass('gamma.')).toContain('spoken');

    await user.keyboard('{ArrowDown}');
    expect(tokenClass('Zeta')).toContain('next');

    // Tap a word to reposition backward.
    await user.click(screen.getByText('beta'));
    expect(tokenClass('beta')).toContain('next');
    expect(tokenClass('Alpha')).toContain('spoken');
    expect(tokenClass('Delta')).not.toContain('spoken');
  });

  it('guides a first visit: explains the steps, and says why presenting is not ready', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('Paste your talk here')).toBeInTheDocument();
    expect(screen.getByText(/tap the mic and speak/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start presenting/i })).toBeDisabled();
    expect(screen.getByText('Add a script to start.')).toBeInTheDocument();
    // About lives behind a header button, not on the page.
    expect(screen.queryByRole('region', { name: 'Why this app' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About' }));
    const about = within(screen.getByRole('dialog', { name: 'About this app' }));
    for (const heading of [
      /the problem/i,
      /the solution/i,
      /how it follows you/i,
      /reading the screen/i,
      /go to plan/i,
      /privacy/i,
    ]) {
      expect(about.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'About this app' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    expect(screen.queryByText('Paste your talk here')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start presenting/i })).toBeEnabled();
    expect(screen.queryByText('Add a script to start.')).not.toBeInTheDocument();
  });

  it('pastes from the clipboard: fills an empty script, then adds a new paragraph', async () => {
    const user = userEvent.setup();
    // user-event installs its own clipboard; replace it with one we control.
    const readText = vi.fn(async () => 'Hello from my notes.');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Hello from my notes.');

    readText.mockResolvedValueOnce('Second part.');
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(textarea.value).toBe('Hello from my notes.\n\nSecond part.');

    readText.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/did not allow reading the clipboard/i);
    expect(textarea.value).toBe('Hello from my notes.\n\nSecond part.');
  });

  it('pastes at the cursor once the speaker has clicked into the script', async () => {
    const user = userEvent.setup();
    const readText = vi.fn(async () => 'brave ');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    render(<App />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.click(textarea);
    await user.paste('Hello world.');
    textarea.setSelectionRange(6, 6);
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(textarea.value).toBe('Hello brave world.');
  });

  it('hides Paste when the browser cannot read the clipboard', async () => {
    userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Paste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload a file/i })).toBeInTheDocument();
  });

  it('shows the presenter tip until it is closed, and remembers that', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    // The health check fails in tests, so the tip explains that voice following is off.
    expect(await screen.findByText(/tap any word to jump there/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/tap any word to jump there/i)).not.toBeInTheDocument();

    unmount();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    await act(async () => {}); // let the health check settle
    expect(screen.queryByText(/tap any word to jump there/i)).not.toBeInTheDocument();
  });

  it('labels the dock buttons with visible text', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    const dock = screen.getByRole('toolbar', { name: 'Presenter controls' });
    for (const label of ['Previous', 'Pause', 'Next', 'Settings']) {
      expect(within(dock).getByText(label)).toBeInTheDocument();
    }
  });

  it('resets position with a notice when the script is edited between sessions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('textbox'));
    await user.paste('One two.\n\nThree four.');
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    await user.type(screen.getByRole('textbox'), ' Five.');
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    expect(screen.getByRole('note')).toHaveTextContent(/position was reset/);
    expect(tokenClass('One')).toContain('next');
  });

  it('blocks presenting when the script exceeds the size limit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('textbox'));
    await user.paste('a'.repeat(100_001));
    expect(screen.getByRole('alert')).toHaveTextContent(/limit is 100,000/);
    expect(screen.getByRole('button', { name: /start presenting/i })).toBeDisabled();
  });

  it('persists the script locally', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    await new Promise((r) => setTimeout(r, 450));
    unmount();
    render(<App />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/^Good morning/);
  });
});

describe('App (presenter controls)', () => {
  beforeEach(() => window.localStorage.clear());

  it('changes display settings from the settings sheet and persists them', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    await user.click(within(panel).getByRole('radio', { name: /light/i }));
    await user.click(within(panel).getByRole('radio', { name: /serif/i }));
    await user.click(within(panel).getByRole('switch', { name: /mirror/i }));
    const presenter = document.querySelector('.presenter') as HTMLElement;
    expect(presenter.dataset.theme).toBe('light');
    expect(presenter.dataset.face).toBe('serif');
    expect(document.querySelector('.content')).toHaveClass('mirrored');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('teleprompter.settings.v1')!)).toMatchObject({
      theme: 'light',
      typeface: 'serif',
      mirrored: true,
    });
  });

  it('shows keyboard shortcuts with ?', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
  });
});

describe('App (simulated tracking)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  function presentSample() {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /try the sample/i }));
    fireEvent.click(screen.getByRole('button', { name: /start presenting/i }));
    // Fake the timers the simulation uses (user-event relies on real timers, so use fireEvent).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  }

  function startSimulation() {
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: /start simulation/i }));
  }

  it('simulated speech drives the highlight to the expected phrase', async () => {
    presentSample();
    startSimulation();
    expect(screen.getByRole('status')).toHaveTextContent(/following \(simulated\)/i);

    // 150 wpm = 400 ms/word. After ~12 s about 30 words have been spoken and finalized.
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    const spoken = document.querySelectorAll('.tok.spoken');
    expect(spoken.length).toBeGreaterThan(15);
    expect(spoken.length).toBeLessThan(35);
    // Everything up to the last spoken token is spoken; nothing after the tentative phrase is.
    const lastSpoken = Number((spoken[spoken.length - 1] as HTMLElement).dataset.tid);
    expect(Number((spoken[0] as HTMLElement).dataset.tid)).toBe(0);
    expect(spoken.length).toBe(lastSpoken + 1);
    expect(screen.getByText('Good', { selector: '[data-tid]' }).className).toContain('spoken');
  });

  it('offers a jump when the speaker skips ahead, and a tap moves there', async () => {
    presentSample();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Simulation scenario' }), {
      target: { value: 'detours' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start simulation/i }));
    let chip: HTMLElement | null = null;
    for (let t = 0; t < 120_000 && !chip; t += 250) {
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      chip = screen.queryByRole('button', { name: /jump to/i });
    }
    expect(chip).not.toBeNull();
    const confirmedBefore = document.querySelectorAll('.tok.spoken').length;
    fireEvent.click(chip!);
    // The tap is a manual reposition: everything up to the suggested spot is now spoken.
    expect(document.querySelectorAll('.tok.spoken').length).toBeGreaterThan(confirmedBefore);
    // It is the paragraph the simulated speaker skipped to ("Here is the plan…"), not the ad-lib.
    expect(document.querySelector('.tok.next')!.closest('[data-pid]')).toHaveAttribute(
      'data-pid',
      '3',
    );
    expect(screen.queryByRole('button', { name: /jump to/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop simulation' }));
  });

  it('pausing freezes the highlight while the simulated speaker continues', async () => {
    presentSample();
    startSimulation();
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pause following' }));
    const frozen = document.querySelectorAll('.tok.spoken').length;
    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });
    expect(document.querySelectorAll('.tok.spoken').length).toBe(frozen);
    expect(screen.getByRole('status')).toHaveTextContent(/paused/i);
    fireEvent.click(screen.getByRole('button', { name: 'Resume following' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop simulation' }));
    expect(screen.getByRole('status')).toHaveTextContent(/mic off/i);
  });
});

describe('App (access code)', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the access code before starting the microphone when the server requires one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              protocolVersion: 1,
              asr: { provider: 'deepgram', configured: true },
              access: { codeRequired: true },
            }),
          ),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /try the sample/i }));
    expect(await screen.findByPlaceholderText(/needed for voice following/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start presenting/i }));
    await user.click(screen.getByRole('button', { name: 'Start microphone' }));
    const dialog = await screen.findByRole('dialog', { name: /access code/i });
    await user.type(within(dialog).getByPlaceholderText('Access code'), 'rehearse-42');
    // Submitting saves the code for this device (then starts the mic, which jsdom can't do).
    await user.click(within(dialog).getByRole('button', { name: 'Start microphone' }));
    expect(JSON.parse(window.localStorage.getItem('teleprompter.accessCode.v1')!)).toBe(
      'rehearse-42',
    );
  });
});
