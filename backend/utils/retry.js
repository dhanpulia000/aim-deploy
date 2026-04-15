/**
 * Exponential Backoff Retry Utility
 * 
 * Provides retry logic with exponential backoff for network requests and other operations
 */

const logger = require('./logger');

/**
 * Retry a function with exponential backoff
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in milliseconds (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in milliseconds (default: 30000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {Function} options.onRetry - Callback function called before each retry (attempt, error, delay)
 * @param {Function} options.shouldRetry - Function to determine if error should be retried (error) => boolean
 * @returns {Promise<any>} Result of the function
 * @throws {Error} Last error if all retries fail
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    onRetry = null,
    shouldRetry = null
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error should be retried
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt >= maxRetries) {
        break;
      }

      // Call onRetry callback if provided
      if (onRetry) {
        const retryDelay = onRetry(attempt + 1, error, delay);
        if (typeof retryDelay === 'number') {
          delay = retryDelay;
        }
      } else {
        // Default logging
        logger.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`, {
          error: error.message,
          attempt: attempt + 1
        });
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

      // Calculate next delay with exponential backoff
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  // All retries failed
  logger.error(`[Retry] All ${maxRetries + 1} attempts failed`, {
    error: lastError?.message,
    stack: lastError?.stack
  });

  throw lastError;
}

/**
 * Retry with exponential backoff for network requests
 * Special handling for rate limiting and timeout errors
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options (same as retryWithBackoff)
 * @returns {Promise<any>} Result of the function
 */
async function retryNetworkRequest(fn, options = {}) {
  return retryWithBackoff(fn, {
    maxRetries: options.maxRetries || 5,
    initialDelay: options.initialDelay || 1000,
    maxDelay: options.maxDelay || 60000, // 1 minute max for rate limits
    backoffMultiplier: options.backoffMultiplier || 2,
    shouldRetry: (error) => {
      // Retry on network errors, timeouts, and rate limits
      const errorMessage = error.message?.toLowerCase() || '';
      const errorCode = error.code?.toLowerCase() || '';
      
      // Network errors
      if (errorCode === 'econnreset' || 
          errorCode === 'etimedout' || 
          errorCode === 'econnrefused' ||
          errorCode === 'enotfound' ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('network') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('rate_limited') ||
          errorMessage.includes('too many requests')) {
        return true;
      }
      
      // HTTP status codes that should be retried
      if (error.status || error.response?.status) {
        const status = error.status || error.response.status;
        // 429 (Too Many Requests), 500-599 (Server Errors), 408 (Request Timeout)
        if (status === 429 || status === 408 || (status >= 500 && status < 600)) {
          return true;
        }
      }
      
      return false;
    },
    onRetry: (attempt, error, delay) => {
      // Handle rate limiting with custom delay
      if (error.response?.status === 429 || error.message?.includes('rate limit')) {
        const retryAfter = error.response?.headers?.['retry-after'] || 
                          error.retryAfter || 
                          delay;
        const retryAfterMs = typeof retryAfter === 'string' 
          ? parseInt(retryAfter) * 1000 
          : retryAfter;
        
        logger.warn(`[Retry] Rate limited, retrying after ${retryAfterMs}ms`, {
          attempt,
          retryAfter: retryAfterMs
        });
        
        return Math.max(retryAfterMs, delay);
      }
      
      logger.warn(`[Retry] Network request failed, retrying in ${delay}ms`, {
        attempt,
        error: error.message,
        status: error.status || error.response?.status
      });
      
      return delay;
    },
    ...options
  });
}

/**
 * Retry with exponential backoff for browser/page operations
 * Special handling for Playwright/Puppeteer errors
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the function
 */
async function retryBrowserOperation(fn, options = {}) {
  return retryWithBackoff(fn, {
    maxRetries: options.maxRetries || 3,
    initialDelay: options.initialDelay || 2000,
    maxDelay: options.maxDelay || 10000,
    backoffMultiplier: options.backoffMultiplier || 1.5,
    shouldRetry: (error) => {
      const errorMessage = error.message?.toLowerCase() || '';
      
      // Retry on timeout, network, and navigation errors
      if (errorMessage.includes('timeout') ||
          errorMessage.includes('navigation') ||
          errorMessage.includes('network') ||
          errorMessage.includes('target closed') ||
          errorMessage.includes('page closed') ||
          error.name === 'TimeoutError') {
        return true;
      }
      
      return false;
    },
    onRetry: (attempt, error, delay) => {
      logger.warn(`[Retry] Browser operation failed, retrying in ${delay}ms`, {
        attempt,
        error: error.message
      });
      return delay;
    },
    ...options
  });
}

module.exports = {
  retryWithBackoff,
  retryNetworkRequest,
  retryBrowserOperation
};












