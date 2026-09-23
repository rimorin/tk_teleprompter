import { describe, expect, it } from 'vitest';
import { resolveEndpoints } from './endpoints';

describe('resolveEndpoints', () => {
  it('defaults to the page origin', () => {
    expect(
      resolveEndpoints(undefined, { protocol: 'https:', host: 'prompter.example.com' }),
    ).toEqual({
      healthUrl: 'https://prompter.example.com/health',
      sessionUrl: 'wss://prompter.example.com/ws',
    });
    expect(resolveEndpoints('', { protocol: 'http:', host: 'localhost:5173' }).sessionUrl).toBe(
      'ws://localhost:5173/ws',
    );
  });

  it('uses a separately hosted API origin when configured', () => {
    expect(
      resolveEndpoints('https://api.example.com/', { protocol: 'https:', host: 'app.example.com' }),
    ).toEqual({
      healthUrl: 'https://api.example.com/health',
      sessionUrl: 'wss://api.example.com/ws',
    });
  });
});
