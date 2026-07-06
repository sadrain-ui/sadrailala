import { addLog, updateCloneStatus } from './db';

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

export async function retryOperation<T>(
  operation: () => Promise<T>,
  cloneId: string,
  operationName: string,
  config: RetryConfig = DEFAULT_CONFIG
): Promise<T> {
  let lastError: Error | null = null;
  let delay = config.delayMs;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      addLog(cloneId, 'recovery', `Attempting ${operationName} (attempt ${attempt}/${config.maxRetries})`);
      return await operation();
    } catch (error) {
      lastError = error as Error;
      addLog(cloneId, 'error', `${operationName} failed: ${lastError.message}`);

      if (attempt < config.maxRetries) {
        addLog(cloneId, 'recovery', `Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= config.backoffMultiplier;
      }
    }
  }

  addLog(cloneId, 'error', `${operationName} failed after ${config.maxRetries} attempts`);
  updateCloneStatus(cloneId, 'error');
  throw lastError || new Error(`${operationName} failed after ${config.maxRetries} attempts`);
}

export function handleOperationError(
  cloneId: string,
  operation: string,
  error: any,
  suggestedFix?: string
) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  addLog(cloneId, 'error', `${operation}: ${errorMsg}`);

  if (suggestedFix) {
    addLog(cloneId, 'recovery', `Suggested fix: ${suggestedFix}`);
  }

  // Log to system for monitoring
  console.error(`[${cloneId}] ${operation}: ${errorMsg}`);
}

export async function gracefulShutdown(cloneId: string) {
  try {
    addLog(cloneId, 'recovery', 'Initiating graceful shutdown...');
    updateCloneStatus(cloneId, 'stopping');
    addLog(cloneId, 'recovery', 'Graceful shutdown complete');
  } catch (error) {
    handleOperationError(cloneId, 'Graceful shutdown', error);
  }
}
