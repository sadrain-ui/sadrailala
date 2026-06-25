/**
 * LEGION ERROR HANDLER
 *
 * Replaces silent .catch(() => {}) with proper error logging and fallback handling
 */

export interface ErrorContext {
  module: string
  operation: string
  severity: 'critical' | 'warning' | 'info'
  context?: Record<string, any>
}

export class LegionErrorHandler {
  private static errors: Array<{ timestamp: Date; context: ErrorContext; error: Error }> = []

  static handleError(context: ErrorContext, error: Error | unknown): void {
    const err = error instanceof Error ? error : new Error(String(error))

    const entry = {
      timestamp: new Date(),
      context,
      error: err,
    }

    this.errors.push(entry)
    this.log(context, err)

    // Report to backend if available
    this.reportToBackend(context, err).catch(() => {
      // Backend report failed, but don't cascade the error
      console.error(`[LEGION] Failed to report error to backend: ${err.message}`)
    })
  }

  private static log(context: ErrorContext, error: Error): void {
    const severity_icon =
      context.severity === 'critical' ? '❌' : context.severity === 'warning' ? '⚠️' : 'ℹ️'
    const message = `${severity_icon} [LEGION] ${context.module}/${context.operation}: ${error.message}`

    if (context.severity === 'critical') {
      console.error(message, context.context)
    } else if (context.severity === 'warning') {
      console.warn(message, context.context)
    } else {
      console.log(message, context.context)
    }
  }

  private static async reportToBackend(context: ErrorContext, error: Error): Promise<void> {
    try {
      await fetch('/__legion_proxy/api/v1/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: context.module,
          operation: context.operation,
          severity: context.severity,
          message: error.message,
          stack: error.stack,
          context: context.context,
          timestamp: new Date().toISOString(),
        }),
      })
    } catch {
      // Silently fail - don't cascade error reporting errors
    }
  }

  static wrap<T>(
    promise: Promise<T>,
    context: ErrorContext,
    fallback?: T
  ): Promise<T | undefined> {
    return promise.catch((error) => {
      this.handleError(context, error)
      return fallback
    })
  }

  static wrapSync<T>(fn: () => T, context: ErrorContext, fallback?: T): T | undefined {
    try {
      return fn()
    } catch (error) {
      this.handleError(context, error)
      return fallback
    }
  }

  static getErrors(module?: string): Array<{ timestamp: Date; context: ErrorContext; error: Error }> {
    return module ? this.errors.filter((e) => e.context.module === module) : this.errors
  }

  static clearErrors(): void {
    this.errors = []
  }
}

// Export convenience functions
export const handleError = LegionErrorHandler.handleError.bind(LegionErrorHandler)
export const wrapPromise = LegionErrorHandler.wrap.bind(LegionErrorHandler)
export const wrapSync = LegionErrorHandler.wrapSync.bind(LegionErrorHandler)
