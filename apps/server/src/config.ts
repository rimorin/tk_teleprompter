import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  /** 127.0.0.1 for local dev; the container image sets '::' (all interfaces, IPv4 + IPv6). */
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEEPGRAM_API_KEY: z.string().trim().optional(),
  DEEPGRAM_URL: z.url().default('wss://api.deepgram.com/v1/listen'),
  DEEPGRAM_MODEL: z.string().default('nova-3'),
  /** Comma-separated origins allowed to open the audio WebSocket. */
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
    ),
  /**
   * Which proxies may set X-Forwarded-For: 'false' (none), 'true' (any — only safe when the
   * proxy in front overwrites the header, as the web image does), a hop count ('1'), or
   * comma-separated IPs/CIDRs ('10.0.0.0/8').
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v): boolean | number | string => {
      const t = v.trim().toLowerCase();
      if (t === '' || t === 'false') return false;
      if (t === 'true') return true;
      if (/^\d+$/.test(t)) return Number(t);
      return v.trim();
    }),
  /** Shared passcode required to start voice tracking. Unset = no passcode (local dev). */
  APP_ACCESS_CODE: z.string().trim().optional(),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().min(1).default(10),
  /** Speakers at one venue or office usually share a public IP, so allow a group per address. */
  MAX_SESSIONS_PER_IP: z.coerce.number().int().min(1).default(10),
  MAX_SESSION_MINUTES: z.coerce.number().min(0.01).default(90),
  /** Failed access-code attempts allowed per IP per window before blocking. */
  MAX_ACCESS_FAILURES: z.coerce.number().int().min(1).default(10),
  ACCESS_FAILURE_WINDOW_MINUTES: z.coerce.number().min(1).default(15),
  /** Time allowed to finalize open sessions on SIGTERM (keep below the platform's stop timeout). */
  SHUTDOWN_GRACE_SECONDS: z.coerce.number().min(0).default(8),
});

export type SessionLimits = {
  accessCode: string | null;
  maxConcurrentSessions: number;
  maxSessionsPerIp: number;
  maxSessionMs: number;
  maxAccessFailures: number;
  accessFailureWindowMs: number;
};

export type ServerConfig = {
  port: number;
  host: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  allowedOrigins: string[];
  trustProxy: boolean | number | string;
  shutdownGraceMs: number;
  limits: SessionLimits;
  deepgram: { apiKey: string | null; url: string; model: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    shutdownGraceMs: e.SHUTDOWN_GRACE_SECONDS * 1000,
    limits: {
      accessCode: e.APP_ACCESS_CODE || null,
      maxConcurrentSessions: e.MAX_CONCURRENT_SESSIONS,
      maxSessionsPerIp: e.MAX_SESSIONS_PER_IP,
      maxSessionMs: e.MAX_SESSION_MINUTES * 60_000,
      maxAccessFailures: e.MAX_ACCESS_FAILURES,
      accessFailureWindowMs: e.ACCESS_FAILURE_WINDOW_MINUTES * 60_000,
    },
    deepgram: { apiKey: e.DEEPGRAM_API_KEY || null, url: e.DEEPGRAM_URL, model: e.DEEPGRAM_MODEL },
  };
}
