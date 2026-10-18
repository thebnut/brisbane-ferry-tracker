/**
 * Hibernating-WebSocket prototype for service detail (ADR-0003, Phase 4 exit criterion). When the Worker has TRIP_WS
 * on, the page opens `${base}/v1/train/trips/{key}/ws` on the edge Worker; the TripSocket Durable Object pushes a
 * full TripResponse on connect and then only when the trip changes. Pushed bodies go straight into the TanStack
 * Query cache, and polling stops while the socket is open. Any failure falls back to 15 s polling.
 *
 * Fixture mode never uses the socket (the fixture API is in this Worker, not the edge).
 */
import type { TripResponse } from '@bft/core/contract'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { DataMode } from './queries.ts'

export function useTripSocket(base: string | null, tripInstance: string, mode: DataMode) {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!base || mode.fixtures || typeof WebSocket === 'undefined') return
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let closed = false
    const open = () => {
      ws = new WebSocket(`${base}/v1/train/trips/${encodeURIComponent(tripInstance)}/ws`)
      ws.onopen = () => {
        attempts = 0
        setConnected(true)
      }
      ws.onmessage = (e) => {
        try {
          const body = JSON.parse(String(e.data)) as TripResponse
          if (body?.tripInstance === tripInstance)
            client.setQueryData(['trip', mode.fixtures, mode.rt, tripInstance], body)
        } catch {
          // Ignore malformed frames; the next push or a poll will correct it.
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (closed || document.hidden || attempts >= 3) return
        attempts++
        retry = setTimeout(open, 2000 * attempts)
      }
    }
    open()
    // Hidden tabs close the socket (the DO hibernates); visible again reconnects.
    const onVisibility = () => {
      if (document.hidden) ws?.close(1000, 'hidden')
      else if (!ws || ws.readyState === WebSocket.CLOSED) {
        attempts = 0
        open()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      closed = true
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisibility)
      ws?.close(1000, 'unmount')
    }
  }, [base, tripInstance, mode, client])
  return { connected }
}
