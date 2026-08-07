export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleLogEntry {
  level: ConsoleLogLevel;
  message: string;
  timestamp: string;
  args: unknown[];
}

type ConsoleMethod = (...args: unknown[]) => void;

/**
 * Keeps the last hundred console entries so a report can carry what the page
 * was saying before it broke.
 *
 * Reconstructed from the published 1.3.2 bundle.
 */
class ConsoleLogCapture {
  private logs: ConsoleLogEntry[] = [];
  private maxLogs = 100;
  private isCapturing = false;

  // Captured at construction, before anything else has a chance to wrap them,
  // so stopCapture can put the real ones back and the error path below can
  // report a failure without recursing through its own patched console.
  private originalConsole: Record<ConsoleLogLevel, ConsoleMethod> = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  /**
   * Start capturing console logs
   */
  startCapture(): void {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.logs = [];

    console.log = (...args: unknown[]) => {
      this.captureLog('log', args);
      this.originalConsole.log.apply(console, args);
    };
    console.info = (...args: unknown[]) => {
      this.captureLog('info', args);
      this.originalConsole.info.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      this.captureLog('warn', args);
      this.originalConsole.warn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      this.captureLog('error', args);
      this.originalConsole.error.apply(console, args);
    };
    console.debug = (...args: unknown[]) => {
      this.captureLog('debug', args);
      this.originalConsole.debug.apply(console, args);
    };
  }

  /**
   * Stop capturing console logs
   */
  stopCapture(): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;
  }

  /**
   * Capture a console log entry
   */
  private captureLog(level: ConsoleLogLevel, args: unknown[]): void {
    try {
      const message = args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ');

      const logEntry: ConsoleLogEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        args: args.map((arg) => {
          if (
            typeof arg === 'string' ||
            typeof arg === 'number' ||
            typeof arg === 'boolean'
          ) {
            return arg;
          }
          if (arg instanceof Error) {
            return {
              name: arg.name,
              message: arg.message,
              stack: arg.stack,
            };
          }
          try {
            return JSON.parse(JSON.stringify(arg));
          } catch {
            return String(arg);
          }
        }),
      };

      this.logs.push(logEntry);
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs);
      }
    } catch (error) {
      // The original, not the patched one — logging a capture failure through
      // the wrapper would call straight back into this method.
      this.originalConsole.error('[BugReporter] Failed to capture log:', error);
    }
  }

  /**
   * Get captured logs
   */
  getLogs(): ConsoleLogEntry[] {
    return [...this.logs];
  }

  /**
   * Clear captured logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get logs as JSON string
   */
  getLogsAsJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const consoleLogger = new ConsoleLogCapture();
