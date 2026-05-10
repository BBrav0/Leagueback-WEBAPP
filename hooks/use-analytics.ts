/**
 * React hook wrapping the browser analytics client for dashboard use.
 *
 * Initializes the analytics session on first mount and provides stable
 * tracking function references that survive re-renders.
 */
"use client"

import { useRef, useCallback, useEffect } from "react"
import {
  initAnalyticsSession,
  trackPageView,
  trackPlayerPageView,
  trackSearchAttempt,
  trackLookupSuccess,
  trackLookupFailure,
  trackMatchDetailView,
  trackLoadMore,
  trackManualUpdate,
  trackClientError,
  sanitizeClientPath,
} from "@/lib/analytics-client"

/**
 * Provides analytics tracking functions for React components.
 *
 * Session initialization is idempotent — calling this hook in multiple
 * components is safe; the session is initialized exactly once.
 */
export function useAnalytics() {
  const initializedRef = useRef(false)
  const pageViewTrackedRef = useRef<string | null>(null)

  // Initialize session exactly once (via effect to avoid render-time ref access)
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      initAnalyticsSession()
    }
  }, [])

  const trackPageViewOnce = useCallback((path: string) => {
    const sanitized = sanitizeClientPath(path)
    if (pageViewTrackedRef.current === sanitized) return
    pageViewTrackedRef.current = sanitized

    if (sanitized === "/player") {
      void trackPlayerPageView(path)
    } else {
      void trackPageView(path)
    }
  }, [])

  const onSearchAttempt = useCallback((gameName: string, tagLine: string) => {
    void trackSearchAttempt(gameName, tagLine)
  }, [])

  const onLookupSuccess = useCallback((matchCount: number) => {
    void trackLookupSuccess({ matchCount })
  }, [])

  const onLookupFailure = useCallback((category: string, rawMessage?: string) => {
    void trackLookupFailure(category, rawMessage)
  }, [])

  const onMatchDetailView = useCallback((matchId: string) => {
    void trackMatchDetailView(matchId)
  }, [])

  const onLoadMore = useCallback((context: { offset: number; limit: number; source: string }) => {
    void trackLoadMore(context)
  }, [])

  const onManualUpdate = useCallback((outcome: string) => {
    void trackManualUpdate({ outcome })
  }, [])

  const onClientError = useCallback((category: string, context?: Record<string, unknown>) => {
    void trackClientError(category, context)
  }, [])

  return {
    trackPageViewOnce,
    onSearchAttempt,
    onLookupSuccess,
    onLookupFailure,
    onMatchDetailView,
    onLoadMore,
    onManualUpdate,
    onClientError,
  } as const
}
