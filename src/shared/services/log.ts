/**
 * Logger com política de privacidade embutida: em produção nunca loga conteúdo
 * de transcript — apenas contagens e metadados. A regra também vale em dev.
 */

const IS_DEV = import.meta.env.DEV;

type LogPayload = Record<string, unknown>;

/** Allowlist: novos campos não entram no log até serem classificados. */
const SAFE_LOG_KEYS = new Set([
  'type',
  'phase',
  'tenantId',
  'meetingId',
  'clientMeetingId',
  'serverMeetingId',
  'opportunityId',
  'jobId',
  'durationSeconds',
  'participants',
  'segments',
  'commercialConfidence',
  'processingStatus',
  'attempts',
  'reconnectCount',
  'ok',
  'comContexto',
  'kind',
  'status',
  'code',
  'retryable',
  'errorType',
]);

function stamp(level: string): string {
  return `[TaqCITi ${level}]`;
}

function sanitized(payload: LogPayload | undefined): LogPayload | '' {
  if (!payload) return '';
  const safe: LogPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFE_LOG_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function errorDetails(error: unknown): LogPayload | '' {
  if (error instanceof Error) return { errorType: error.name };
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    return sanitized(error as LogPayload);
  }
  return error === undefined ? '' : { errorType: typeof error };
}

export const logger = {
  /** Apenas em dev, mas ainda sem texto, token, evidência ou dado sensível. */
  debug(message: string, payload?: LogPayload): void {
    if (IS_DEV) console.debug(stamp('debug'), message, sanitized(payload));
  },
  info(message: string, payload?: LogPayload): void {
    console.info(stamp('info'), message, sanitized(payload));
  },
  warn(message: string, payload?: LogPayload): void {
    console.warn(stamp('warn'), message, sanitized(payload));
  },
  error(message: string, error?: unknown): void {
    console.error(stamp('error'), message, errorDetails(error));
  },
};
