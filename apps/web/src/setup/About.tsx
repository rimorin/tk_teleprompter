import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  AudioLines,
  Compass,
  CornerDownRight,
  Eye,
  FastForward,
  Hand,
  Lightbulb,
  Lock,
  Mic,
  Pause,
  RefreshCw,
  Repeat,
  ScrollText,
  Server,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** How voice following works, as a left-to-right (phones: top-to-bottom) flow. */
const FLOW: Array<{ icon: ReactNode; title: string; text: string }> = [
  { icon: <Mic size={20} aria-hidden />, title: 'You speak', text: 'Read your script aloud.' },
  {
    icon: <AudioLines size={20} aria-hidden />,
    title: 'Words are heard',
    text: 'Your voice becomes text, live.',
  },
  {
    icon: <Compass size={20} aria-hidden />,
    title: 'Your place is found',
    text: 'The words are matched to your script.',
  },
  {
    icon: <ScrollText size={20} aria-hidden />,
    title: 'Your line stays in view',
    text: 'The script moves so it sits at eye level.',
  },
];

const OFF_SCRIPT: Array<{ icon: ReactNode; when: string; then: string }> = [
  { icon: <Pause size={16} aria-hidden />, when: 'You pause', then: 'It waits. Nothing moves.' },
  {
    icon: <Sparkles size={16} aria-hidden />,
    when: 'You tell a story',
    then: 'It keeps your place and picks up when you come back.',
  },
  {
    icon: <CornerDownRight size={16} aria-hidden />,
    when: 'You skip ahead',
    then: 'A “Jump to …” button appears. Tap it, or keep talking.',
  },
  {
    icon: <Repeat size={16} aria-hidden />,
    when: 'You repeat a line',
    then: 'It never jumps back by itself.',
  },
  {
    icon: <RefreshCw size={16} aria-hidden />,
    when: 'The network drops',
    then: 'It reconnects by itself. The buttons always work.',
  },
];

/** Line widths (%) for the two little screens in the problem and solution cards. */
const NOTE_BARS = [92, 86, 95, 70, 90, 84, 96, 78, 88, 93];
const PROMPTER_BARS: Array<[number, 'spoken' | 'current' | 'next']> = [
  [60, 'spoken'],
  [48, 'spoken'],
  [90, 'current'],
  [82, 'next'],
  [58, 'next'],
];

/** What research and speaking coaches say about looking down at notes. */
const FACTS: Array<{ icon: ReactNode; title: string; text: string }> = [
  {
    icon: <Eye size={16} aria-hidden />,
    title: 'Eye contact builds trust.',
    text: 'Audiences rate speakers who look at them as more skilled and honest.',
  },
  {
    icon: <ArrowDown size={16} aria-hidden />,
    title: 'Looking down looks unsure,',
    text: 'even when you are not.',
  },
  {
    icon: <FastForward size={16} aria-hidden />,
    title: 'Auto-scroll does not wait.',
    text: 'It keeps moving when you pause for a laugh or a question.',
  },
];

/** Why the app exists and how it works, in plain words for speakers. */
export function About() {
  return (
    <section className="about" aria-label="Why this app">
      <p className="about-lead">A teleprompter that listens, so you can look at your audience.</p>

      <div className="about-grid">
        <div className="card about-card" data-kind="problem">
          <h3 className="card-title">
            <AlertCircle size={17} aria-hidden /> The problem
          </h3>
          <div className="mock" data-kind="notes" aria-hidden>
            {NOTE_BARS.map((width, i) => (
              <span key={i} className="mock-bar" style={{ width: `${width}%` }} />
            ))}
            <span className="mock-tag">
              <Hand size={14} /> Where was I?
            </span>
          </div>
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
          <div className="mock" data-kind="prompter" aria-hidden>
            {PROMPTER_BARS.map(([width, state], i) => {
              const bar = (
                <span className="mock-bar" data-state={state} style={{ width: `${width}%` }} />
              );
              return state === 'current' ? (
                <span key={i} className="mock-line">
                  {bar}
                </span>
              ) : (
                <span key={i}>{bar}</span>
              );
            })}
            <span className="mock-tag">
              <Mic size={14} /> Following you
            </span>
          </div>
          <ul>
            <li>It listens as you speak and keeps your line at eye level. No scrolling.</li>
            <li>Look up, pause or tell a story. When you look back down, your place is waiting.</li>
            <li>Went somewhere else? Tap any word, and the script goes there.</li>
          </ul>
        </div>
      </div>

      <h3 className="about-heading">Why it matters</h3>
      <ul className="facts">
        {FACTS.map((fact) => (
          <li key={fact.title} className="card fact">
            <span className="off-icon">{fact.icon}</span>
            <span>
              <strong>{fact.title}</strong> {fact.text}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="about-heading">How it follows you</h3>
      <ol className="flow" aria-label="How voice following works">
        {FLOW.map((step, i) => (
          <li key={step.title} className="flow-step">
            <span className="flow-icon">{step.icon}</span>
            <span className="flow-title">{step.title}</span>
            <span className="flow-text">{step.text}</span>
            {i < FLOW.length - 1 && (
              <span className="flow-arrow" aria-hidden>
                <ArrowRight size={18} className="arrow-wide" />
                <ArrowDown size={18} className="arrow-narrow" />
              </span>
            )}
          </li>
        ))}
      </ol>

      <h3 className="about-heading">Reading the screen</h3>
      <div className="card screen-demo">
        <p className="demo-line" aria-hidden>
          <span className="demo-spoken">Good morning, everyone, and </span>
          <span className="demo-heard">thank you for </span>
          <span className="demo-next">being</span> here today.
        </p>
        <dl className="legend">
          <div>
            <dt>
              <span className="swatch" data-kind="spoken" /> Faded
            </dt>
            <dd>You have said it.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="heard" /> Warm
            </dt>
            <dd>What it is hearing right now.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="next" /> Highlighted
            </dt>
            <dd>Your next word. It glides along as you speak.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="line" /> Reading line
            </dt>
            <dd>Your line always settles here, between the ◀ ▶ markers.</dd>
          </div>
        </dl>
      </div>

      <h3 className="about-heading">When the talk doesn’t go to plan</h3>
      <ul className="card off-script">
        {OFF_SCRIPT.map((row) => (
          <li key={row.when}>
            <span className="off-icon">{row.icon}</span>
            <span>
              <strong>{row.when}.</strong> {row.then}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="about-heading">Your privacy</h3>
      <div className="card privacy-map">
        <div className="privacy-flow" aria-hidden>
          <div className="pnode" data-kind="device">
            <Smartphone size={18} />
            <span>Your device</span>
            <small>Script stays here</small>
          </div>
          <span className="pline">
            <span>voice out, words back (only while the mic is on)</span>
          </span>
          <div className="pnode">
            <Server size={18} />
            <span>App server</span>
            <small>Stores nothing</small>
          </div>
          <span className="pline">
            <span>voice out, words back</span>
          </span>
          <div className="pnode">
            <AudioLines size={18} />
            <span>Speech service</span>
            <small>Turns speech into text</small>
          </div>
        </div>
        <ul className="privacy-points">
          <li>
            <Lock size={15} aria-hidden /> Your script never leaves this browser.
          </li>
          <li>
            <Lock size={15} aria-hidden /> Your voice is sent only while the microphone is on, and
            only the words come back.
          </li>
          <li>
            <Lock size={15} aria-hidden /> Nothing is recorded or stored.
          </li>
        </ul>
      </div>
    </section>
  );
}
