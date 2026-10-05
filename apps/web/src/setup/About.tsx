import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  AudioLines,
  Compass,
  CornerDownRight,
  Eye,
  FastForward,
  GraduationCap,
  Hand,
  Keyboard,
  Lightbulb,
  List,
  ListChecks,
  Lock,
  Mic,
  MousePointerClick,
  Pause,
  RefreshCw,
  Repeat,
  ScrollText,
  Server,
  Smartphone,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

/** How voice following works, as a left-to-right (phones: top-to-bottom) flow. */
const FLOW: Array<{ icon: ReactNode; title: string; text: string }> = [
  {
    icon: <Mic size={20} aria-hidden />,
    title: 'You speak',
    text: 'Read your script aloud, or talk around your points.',
  },
  {
    icon: <AudioLines size={20} aria-hidden />,
    title: 'Words are heard',
    text: 'Your voice becomes text, live.',
  },
  {
    icon: <Compass size={20} aria-hidden />,
    title: 'Your place is found',
    text: 'Your words are matched to your script, or to your points.',
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
    icon: <List size={16} aria-hidden />,
    when: 'You speak from bullet points',
    then: 'It follows you point by point, so your own words are fine.',
  },
  {
    icon: <CornerDownRight size={16} aria-hidden />,
    when: 'You skip a sentence',
    then: 'It catches up by itself within a few words.',
  },
  {
    icon: <FastForward size={16} aria-hidden />,
    when: 'You skip a whole section',
    then: 'A “Jump to …” button appears. Tap it, or keep talking and it follows.',
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

/** What research and speaking coaches say about looking down at notes (sources in the README). */
const FACTS: Array<{ icon: ReactNode; title: string; text: string }> = [
  {
    icon: <Eye size={16} aria-hidden />,
    title: 'Eye contact builds trust.',
    text: 'In a classic study, speakers who made more eye contact were rated as more credible.',
  },
  {
    icon: <ArrowDown size={16} aria-hidden />,
    title: 'Looking down reads as nerves,',
    text: 'speaking coaches warn, even when you feel fine.',
  },
  {
    icon: <FastForward size={16} aria-hidden />,
    title: 'A fixed-speed scroll does not wait.',
    text: 'It runs ahead when you pause, and falls behind when you skip.',
  },
];

/** When a word-for-word script makes sense (coaches otherwise suggest speaking from points). */
const FOR_WHOM = [
  'The exact words matter: a statement, a pitch, a eulogy or a toast.',
  'You are speaking in a second language.',
  'You are recording a video.',
  'You want a safety net for nerves.',
];

/*
 * Place in the script over one minute, for a speaker who pauses for a laugh and then skips a
 * sentence (the same story as docs/images/pace.svg, sized for phones). Words at 2.5 per second.
 */
const CHART = { w: 400, h: 210, left: 8, right: 392, top: 12, bottom: 196, tMax: 60, pMax: 170 };
const SPEAKER: Array<[number, number]> = [
  [0, 0],
  [20, 50],
  [28, 50],
  [45, 92.5],
  [45, 132.5],
  [60, 170],
];
const FIXED_SCROLL: Array<[number, number]> = [
  [0, 0],
  [60, 150],
];
/** Where the fixed scroll is off your place: ahead after the pause, behind after the skip. */
const GAPS: Array<Array<[number, number]>> = [
  [
    [20, 50],
    [28, 70],
    [45, 112.5],
    [45, 92.5],
    [28, 50],
  ],
  [
    [45, 112.5],
    [60, 150],
    [60, 170],
    [45, 132.5],
  ],
];
const cx = (t: number) => CHART.left + ((CHART.right - CHART.left) * t) / CHART.tMax;
const cy = (p: number) => CHART.bottom - ((CHART.bottom - CHART.top) * p) / CHART.pMax;
const points = (pts: Array<[number, number]>) =>
  pts.map(([t, p]) => `${cx(t).toFixed(1)},${cy(p).toFixed(1)}`).join(' ');

function PaceChart() {
  return (
    <figure className="card pace">
      <svg
        viewBox={`0 0 ${CHART.w} ${CHART.h}`}
        role="img"
        aria-label="Place in the script over time. When you pause, a fixed-speed scroll runs ahead of you. When you skip a sentence, it falls behind. Voice following stays on your line."
      >
        <line
          className="pace-axis"
          x1={CHART.left}
          y1={CHART.top}
          x2={CHART.left}
          y2={CHART.bottom}
        />
        <line
          className="pace-axis"
          x1={CHART.left}
          y1={CHART.bottom}
          x2={CHART.right}
          y2={CHART.bottom}
        />
        {GAPS.map((gap, i) => (
          <polygon key={i} className="pace-gap" points={points(gap)} />
        ))}
        <polyline className="pace-scroll" points={points(FIXED_SCROLL)} />
        <polyline className="pace-you" points={points(SPEAKER)} />
        <text className="pace-label" x={CHART.left + 8} y={CHART.top + 12}>
          Place in script
        </text>
        <text className="pace-label" x={CHART.right} y={CHART.bottom - 8} textAnchor="end">
          Time →
        </text>
        <text className="pace-note" x={cx(24)} y={cy(50) + 22} textAnchor="middle">
          Pause
        </text>
        <text className="pace-note" x={cx(45) - 8} y={cy(132.5)} textAnchor="end">
          Skip
        </text>
      </svg>
      <figcaption className="pace-legend">
        <span>
          <i className="key-you" /> You, and this app
        </span>
        <span>
          <i className="key-scroll" /> Fixed-speed scroll
        </span>
        <span>
          <i className="key-gap" /> How far off your place is
        </span>
      </figcaption>
    </figure>
  );
}

/** Small habits that make the first talk go smoothly. */
const TIPS: Array<{ icon: ReactNode; title: string; text: string }> = [
  {
    icon: <GraduationCap size={16} aria-hidden />,
    title: 'Practise first.',
    text: 'In the presenter, open Settings and start a simulation. No microphone needed.',
  },
  {
    icon: <MousePointerClick size={16} aria-hidden />,
    title: 'Lost your place?',
    text: 'Tap any word, or use Previous and Next, and the script goes there.',
  },
  {
    icon: <ListChecks size={16} aria-hidden />,
    title: 'Speaking from points?',
    text: 'Start each one with - or 1. Points with names, numbers or specific terms are the easiest to follow.',
  },
  {
    icon: <Keyboard size={16} aria-hidden />,
    title: 'On a laptop?',
    text: 'Press ? for keyboard shortcuts. Presenter clickers work too.',
  },
  {
    icon: <Zap size={16} aria-hidden />,
    title: 'Want it quicker?',
    text: 'If Settings offers “Fastest”, it confirms your words about a second sooner.',
  },
];

/** A sample line for "Reading the screen", with the words split for the demo. */
const DEMO_WORDS = 'Good morning, everyone, and thank you for being here today.'.split(' ');
/** Where the demo rests when motion is reduced: the same moment as the presenter legend. */
const DEMO_REST = DEMO_WORDS.indexOf('being');
/** Words shown as "being heard" just behind the next word. */
const DEMO_HEARD = 3;
const DEMO_STEP_MS = 520;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The sample line read aloud on a loop: faded, then tinted, then the boxed next word moves on. */
function ReadingDemo() {
  const [next, setNext] = useState(() => (prefersReducedMotion() ? DEMO_REST : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    // A few steps past the end hold the finished line (about 1.5 s) before it starts again.
    const id = setInterval(
      () => setNext((n) => (n >= DEMO_WORDS.length + 2 ? 0 : n + 1)),
      DEMO_STEP_MS,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <p className="demo-line" aria-hidden>
      {DEMO_WORDS.map((word, i) => (
        <span
          key={i}
          className={
            i === next
              ? 'demo-next'
              : i < next - DEMO_HEARD
                ? 'demo-spoken'
                : i < next
                  ? 'demo-heard'
                  : undefined
          }
        >
          {word}
        </span>
      )).flatMap((el, i) => (i ? [' ', el] : [el]))}
    </p>
  );
}

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

      <PaceChart />

      <h3 className="about-heading">Who it’s for</h3>
      <div className="card for-whom">
        <p className="muted small">
          Most coaches suggest speaking from a few points, and it follows those too: talk around
          them in your own words. A word-for-word script still makes sense when:
        </p>
        <ul>
          {FOR_WHOM.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="muted small">
          Put your phone or tablet on a stand at eye level. Reading from a phone in your hand looks
          unprepared.
        </p>
      </div>

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
        <ReadingDemo />
        <dl className="legend">
          <div>
            <dt>
              <span className="swatch" data-kind="spoken" /> Faded
            </dt>
            <dd>You have said it.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="heard" /> Tinted
            </dt>
            <dd>What it is hearing right now.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="next" /> Boxed
            </dt>
            <dd>Your next word. It glides along as you speak.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="line" /> Reading line
            </dt>
            <dd>Your line always settles here, between the marks at each edge.</dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="point" /> Band
            </dt>
            <dd>
              The point you are on, when you speak from bullet points. Dashed while it checks.
            </dd>
          </div>
          <div>
            <dt>
              <span className="swatch" data-kind="jump" /> Dashed underline
            </dt>
            <dd>Where a “Jump to …” button would take you.</dd>
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

      <h3 className="about-heading">Tips</h3>
      <ul className="facts tips">
        {TIPS.map((tip) => (
          <li key={tip.title} className="card fact">
            <span className="off-icon">{tip.icon}</span>
            <span>
              <strong>{tip.title}</strong> {tip.text}
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
