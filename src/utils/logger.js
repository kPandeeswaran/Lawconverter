const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configuredLevel = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';
const currentLevel = LEVELS[configuredLevel] ?? LEVELS.info;

function log(level, message, meta = undefined) {
  if (LEVELS[level] > currentLevel) return;
  const timestamp = new Date().toISOString();
  const details = meta ? ` ${JSON.stringify(meta)}` : '';
  process.stdout.write(`[${timestamp}] ${level.toUpperCase()} ${message}${details}\n`);
}

export const logger = {
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};
