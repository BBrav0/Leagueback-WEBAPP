/**
 * Client-side rate limiter using sliding window algorithm
 * Tracks requests in sessionStorage to persist across page refreshes
 */

const STORAGE_KEY = "rate_limiter_requests";
const DEFAULT_LIMIT = 50; // requests per minute
const WINDOW_MS = 60_000; // 1 minute

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

class RateLimiter {
  private limit: number;
  private windowMs: number;

  constructor(limit: number = DEFAULT_LIMIT, windowMs: number = WINDOW_MS) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /**
   * Get stored request timestamps from sessionStorage
   */
  private getStoredRequests(): number[] {
    if (typeof window === "undefined") return [];
    
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      return JSON.parse(stored) as number[];
    } catch {
      return [];
    }
  }

  /**
   * Save request timestamps to sessionStorage
   */
  private saveRequests(timestamps: number[]): void {
    if (typeof window === "undefined") return;
    
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(timestamps));
    } catch {
      // Ignore storage errors (e.g., quota exceeded)
    }
  }

  /**
   * Clean up old requests outside the current window
   */
  private cleanOldRequests(timestamps: number[]): number[] {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    return timestamps.filter((ts) => ts > cutoff);
  }

  /**
   * Check if a request is allowed and record it
   */
  checkRateLimit(): RateLimitResult {
    const now = Date.now();
    let timestamps = this.getStoredRequests();
    
    // Clean up old requests outside the window
    timestamps = this.cleanOldRequests(timestamps);
    
    // Check if we're at the limit
    if (timestamps.length >= this.limit) {
      // Find the oldest request to calculate reset time
      const oldestRequest = Math.min(...timestamps);
      const resetAt = oldestRequest + this.windowMs;
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: retryAfter > 0 ? retryAfter : 0,
      };
    }

    // Record this request
    timestamps.push(now);
    this.saveRequests(timestamps);

    const remaining = this.limit - timestamps.length;
    const resetAt = timestamps.length > 0 
      ? Math.min(...timestamps) + this.windowMs 
      : now + this.windowMs;

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  /**
   * Get current rate limit status without recording a request
   */
  getStatus(): RateLimitResult {
    const now = Date.now();
    let timestamps = this.getStoredRequests();
    timestamps = this.cleanOldRequests(timestamps);
    
    if (timestamps.length >= this.limit) {
      const oldestRequest = Math.min(...timestamps);
      const resetAt = oldestRequest + this.windowMs;
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: retryAfter > 0 ? retryAfter : 0,
      };
    }

    const remaining = this.limit - timestamps.length;
    const resetAt = timestamps.length > 0 
      ? Math.min(...timestamps) + this.windowMs 
      : now + this.windowMs;

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  /**
   * Reset the rate limiter (useful for testing or manual reset)
   */
  reset(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Export class for testing or custom instances
export { RateLimiter };
export type { RateLimitResult };
