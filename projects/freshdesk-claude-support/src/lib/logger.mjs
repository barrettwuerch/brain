import pino from 'pino';

export function makeLogger({ level }) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        '*.apiKey',
        '*.token',
      ],
      remove: true,
    },
  });
}
