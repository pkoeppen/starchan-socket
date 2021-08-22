import pino from 'pino';

/*
 * Configures and returns a logger instance.
 */
export const logger = (function () {
  const pinoPrettyOptions = {
    colorize: true,
    translateTime: 'HH:MM:ss.l',
  };
  const pinoOptions = {
    name: 'starchan-socket',
    prettyPrint:
      process.env.NODE_ENV === 'production' ? false : pinoPrettyOptions,
  };
  const logger = pino(pinoOptions);
  logger.level = process.env.NODE_ENV === 'production' ? 'error' : 'debug';
  return logger;
})();
