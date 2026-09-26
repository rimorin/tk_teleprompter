import dotenv from 'dotenv';
import { buildApp } from './app';
import { loadConfig } from './config';

// Local development reads apps/server/.env; in production variables come from the platform.
dotenv.config({ quiet: true });

async function main() {
  const config = loadConfig();
  const { app, shutdown } = await buildApp({ config });
  if (!config.deepgram.apiKey && !config.assemblyai.apiKey) {
    app.log.warn(
      'Neither DEEPGRAM_API_KEY nor ASSEMBLYAI_API_KEY is set: live tracking is disabled ' +
        '(manual/simulated modes still work)',
    );
  }
  if (!config.limits.accessCode) {
    app.log.warn(
      'APP_ACCESS_CODE is not set: anyone who can reach this server can use voice tracking',
    );
  }

  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      shutdown().then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error(err);
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
