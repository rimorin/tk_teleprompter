import { z } from 'zod';

/** Bump when the client/server message contract changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Uncompressed fallback the browser sends: mono 16-bit little-endian PCM. */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_FRAME_MS = 100;
/** Target bitrate for compressed (Opus) audio: ~8x smaller than PCM, ample for speech. */
export const OPUS_BITS_PER_SECOND = 32_000;
/** Largest binary audio frame the server accepts (1 s of PCM, well above one 100 ms frame). */
export const MAX_AUDIO_FRAME_BYTES = AUDIO_SAMPLE_RATE * 2;

/**
 * Link health. While a session is active the server acknowledges received audio chunks
 * (session.ack) at least this often, which also serves as its heartbeat. The client uses the
 * acks to know exactly how stale its upload is, and treats silence as a stalled link.
 */
export const ACK_INTERVAL_MS = 250;

/**
 * Audio the client streams: raw PCM, or Opus in a container (the browser's MediaRecorder output).
 * Containerized chunks are one continuous stream and must never be dropped or reordered.
 */
export const AudioFormat = z.discriminatedUnion('encoding', [
  z.object({
    encoding: z.literal('linear16'),
    sampleRate: z.number().int().min(8_000).max(48_000),
    channels: z.literal(1),
  }),
  z.object({ encoding: z.literal('opus'), container: z.enum(['webm', 'ogg']) }),
]);
export type AudioFormat = z.infer<typeof AudioFormat>;

// Client -> server (JSON text frames; audio travels as binary frames after session.start).

const SessionStartMessage = z.object({
  type: z.literal('session.start'),
  v: z.number().int(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  audio: AudioFormat,
  /** Required when the server sets APP_ACCESS_CODE. */
  accessCode: z.string().max(256).optional(),
  /** Session this one replaces after a lost connection; the server ends it at once. */
  replaces: z.string().max(64).optional(),
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
  /** Audio chunks (binary frames) received so far in this session; also the heartbeat. */
  z.object({ type: z.literal('session.ack'), chunks: z.number().int().min(0) }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** User-facing text for each error code. Never includes provider details or credentials. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  asr_not_configured:
    'Voice following is not set up on this server. You can still move through the script yourself.',
  asr_auth_failed: 'The speech provider rejected the server’s credentials.',
  asr_unavailable: 'The speech provider is unreachable right now.',
  asr_error:
    'The speech provider refused this session, so voice following has stopped. You can still move through the script yourself.',
  bad_message: 'The server received an unexpected message.',
  unsupported_version: 'This page is out of date with the server. Reload the page.',
  access_denied: 'The access code is missing or incorrect.',
  too_many_attempts: 'Too many incorrect access codes. Try again in a few minutes.',
  server_busy: 'Voice following is busy right now. Try again shortly; the buttons still work.',
  session_time_limit:
    'The voice session reached its time limit. Start the microphone again to continue.',
  server_restarting: 'The server is restarting. Reconnecting…',
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
