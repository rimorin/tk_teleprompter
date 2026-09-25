import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { formatElapsed, SessionTimer } from './SessionTimer';

describe('formatElapsed', () => {
  it('shows m:ss, and h:mm:ss past the hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(754_000)).toBe('12:34');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });
});

describe('SessionTimer', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }));
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('stays hidden until listening starts, then counts up', () => {
    const { rerender } = render(<SessionTimer running={false} stopped />);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    rerender(<SessionTimer running stopped={false} />);
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    advance(65_000);
    expect(screen.getByRole('timer')).toHaveTextContent('1:05');
  });

  it('holds while paused and carries on when resumed', () => {
    const { rerender } = render(<SessionTimer running stopped={false} />);
    advance(10_000);
    rerender(<SessionTimer running={false} stopped={false} />);
    advance(30_000);
    expect(screen.getByRole('timer')).toHaveTextContent('0:10');
    expect(screen.getByRole('timer')).toHaveAttribute('data-state', 'paused');
    rerender(<SessionTimer running stopped={false} />);
    advance(5_000);
    expect(screen.getByRole('timer')).toHaveTextContent('0:15');
  });

  it('keeps the time after stopping, continues on restart, and resets on tap', () => {
    const { rerender } = render(<SessionTimer running stopped={false} />);
    advance(20_000);
    rerender(<SessionTimer running={false} stopped />);
    advance(60_000);
    const reset = screen.getByRole('button', { name: /reset timer/i });
    expect(reset).toHaveTextContent('0:20');

    rerender(<SessionTimer running stopped={false} />);
    advance(1_000);
    expect(screen.getByRole('timer')).toHaveTextContent('0:21');

    rerender(<SessionTimer running={false} stopped />);
    fireEvent.click(screen.getByRole('button', { name: /reset timer/i }));
    expect(screen.queryByRole('button', { name: /reset timer/i })).not.toBeInTheDocument();
  });
});
