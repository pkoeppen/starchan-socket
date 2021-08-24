import pino from 'pino';

/*
 * Configures and returns a logger instance.
 */
export const logger = (function () {
  const pinoOptions = {
    name: 'starchan-socket',
    prettyPrint: {
      colorize: process.env.NODE_ENV !== 'production',
      translateTime: 'HH:MM:ss.l',
    },
  };
  const logger = pino(pinoOptions);
  logger.level = process.env.NODE_ENV === 'production' ? 'error' : 'debug';
  return logger;
})();

/*
 * Set and verify environment variables.
 */
let missingEnvironmentVariable = false;

export const SIMPLE_ENCRYPTION_KEY = process.env.SIMPLE_ENCRYPTION_KEY;
if (!SIMPLE_ENCRYPTION_KEY) {
  logger.error(
    "Fatal error: Missing environment variable 'SIMPLE_ENCRYPTION_KEY'"
  );
  missingEnvironmentVariable = true;
}

if (missingEnvironmentVariable) {
  process.exit(1);
}
