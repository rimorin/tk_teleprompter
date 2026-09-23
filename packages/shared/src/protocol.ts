import { z } from 'zod';

/** Bump when the client/server message contract changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Audio format the browser sends: mono 16-bit little-endian PCM. */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_FRAME_MS = 100;
/** Largest binary audio frame the server accepts (1 s of audio, well above one 100 ms frame). */
export const MAX_AUDIO_FRAME_BYTES = AUDIO_SAMPLE_RATE * 2;

// Client -> server (JSON text frames; audio travels as binary frames after session.start).

const SessionStartMessage = z.object({
  type: z.literal('session.start'),
  v: z.number().int(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  audio: z.object({
    encoding: z.literal('linear16'),
    sampleRate: z.number().int().min(8_000).max(48_000),
    channels: z.literal(1),
  }),
  /** Required when the server sets APP_ACCESS_CODE. */
  accessCode: z.string().max(256).optional(),
});

const SessionStopMessage = z.object({ type: z.literal('session.stop') });

export const ClientMessage = z.discriminatedUnion('type', [
  SessionStartMessage,
  SessionStopMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// Server -> client.

export const SessionStatus = z.enum([
  'connecting',
  'listening',
  'disconnected',
  'error',
  'stopped',
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const ErrorCode = z.enum([
  'asr_not_configured',
  'asr_auth_failed',
  'asr_unavailable',
  'asr_error',
  'bad_message',
  'unsupported_version',
  'access_denied',
  'too_many_attempts',
  'server_busy',
  'session_time_limit',
  'server_restarting',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

const TranscriptWordSchema = z.object({
  text: z.string(),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  confidence: z.number().optional(),
});

const TranscriptFields = {
  sessionId: z.string(),
  segmentId: z.string(),
  segmentOrder: z.number(),
  sequence: z.number().int(),
  text: z.string(),
  words: z.array(TranscriptWordSchema).optional(),
};

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.status'),
    status: SessionStatus,
    sessionId: z.string().optional(),
  }),
  z.object({ type: z.literal('transcript.interim'), ...TranscriptFields }),
  z.object({ type: z.literal('transcript.final'), ...TranscriptFields }),
  z.object({ type: z.literal('session.error'), code: ErrorCode, message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** User-facing text for each error code. Never includes provider details or credentials. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  asr_not_configured:
    'Live tracking is not configured on the server (no speech provider key). Manual mode still works.',
  asr_auth_failed: 'The speech provider rejected the server’s credentials.',
  asr_unavailable: 'The speech provider is unreachable right now.',
  asr_error: 'The speech provider reported an error.',
  bad_message: 'The server received an unexpected message.',
  unsupported_version: 'This page is out of date with the server. Reload the page.',
  access_denied: 'The access code is missing or incorrect.',
  too_many_attempts: 'Too many incorrect access codes. Try again in a few minutes.',
  server_busy:
    'Voice tracking is at capacity right now. Try again shortly; manual mode still works.',
  session_time_limit:
    'The voice session reached its time limit. Start the microphone again to continue.',
  server_restarting: 'The server is restarting. Start the microphone again in a moment.',
  internal: 'Something went wrong on the server.',
};

/** Response of GET /health. */
export const HealthResponse = z.object({
  ok: z.boolean(),
  protocolVersion: z.number(),
  asr: z.object({ provider: z.string(), configured: z.boolean() }),
  access: z.object({ codeRequired: z.boolean() }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
