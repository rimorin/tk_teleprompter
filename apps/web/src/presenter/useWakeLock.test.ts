import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('useWakeLock', () => {
  it('requests a screen wake lock while enabled and releases it afterwards', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release, released: false }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const { unmount } = renderHook(() => useWakeLock(true));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    unmount();
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
  });

  it('does nothing where the API is unsupported', () => {
    expect(() => renderHook(() => useWakeLock(true)).unmount()).not.toThrow();
  });
});
