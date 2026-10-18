/** Structured JSON logs for Workers Observability: one object per line, with a request id when there is one. */
export type LogFields = Record<string, unknown>

export interface Logger {
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

export function createLogger(base: LogFields = {}, sink: (line: string) => void = console.log): Logger {
  const emit = (level: string, msg: string, fields?: LogFields) =>
    sink(JSON.stringify({ level, msg, ...base, ...fields }))
  return {
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (f) => createLogger({ ...base, ...f }, sink),
  }
}

export const silentLogger: Logger = createLogger({}, () => {})

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
