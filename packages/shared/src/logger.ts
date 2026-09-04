export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * One structured JSON line per call so `correlationId` (and anything else
 * relevant to a given message) survives across process boundaries and log
 * aggregation, instead of being buried in a free-text console.log string.
 */
export function createLogger(service: string): Logger {
  function write(level: "info" | "warn" | "error", message: string, fields: LogFields = {}) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...fields,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
