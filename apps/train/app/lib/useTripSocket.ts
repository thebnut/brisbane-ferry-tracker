/**
 * Hibernating-WebSocket prototype for service detail (ADR-0003, Phase 4 exit criterion). When the Worker has TRIP_WS
 * on, the page opens `/v1/train/trips/{key}/ws`; the TripSocket Durable Object sends the trip, then each 15 s cycle
 * either the changed trip or a small tick. Trips go straight into the TanStack Query cache; ticks refresh its
 * timestamps.
 *
 * Polling stops only while the socket is healthy: after the first valid trip, and for as long as a frame arrives at
 * least every 40 s. An `unavailable` frame, silence or a closed socket switch back to 15 s polling at once.
 *
 * `base` null = polling only; '' = same origin (the prototype DO in this Worker); otherwise a wss:// base. The root
 * loader passes null when the request's data mode (per-visitor fixtures, forced rtState) differs from the DO's.
 */
import type { TripResponse } from '@bft/core/contract'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { DataMode } from './queries.ts'
import type { TripFrame } from './tripFingerprint.ts'

export const SOCKET_SILENCE_MS = 40_000

export function useTripSocket(base: string | null, tripInstance: string, mode: DataMode) {
  const client = useQueryClient()
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (base == null || mode.rt || typeof WebSocket === 'undefined') return
    const origin = base || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    const queryKey = ['train', 'trip', mode.fixtures, mode.rt, tripInstance]
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let silence: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let closed = false
    const healthy = () => {
      clearTimeout(silence)
      silence = setTimeout(() => {
        // No frame for 40 s: assume the stream is stuck and poll instead.
        setConnected(false)
        ws?.close(4000, 'silent')
      }, SOCKET_SILENCE_MS)
    }
    const open = () => {
      ws = new WebSocket(`${origin}/v1/train/trips/${encodeURIComponent(tripInstance)}/ws`)
      ws.onmessage = (e) => {
        let body: TripResponse | TripFrame
        try {
          body = JSON.parse(String(e.data)) as TripResponse | TripFrame
        } catch {
          return
        }
        if (body?.tripInstance !== tripInstance) return
        if ('type' in body && body.type === 'unavailable') {
          setConnected(false)
          return
        }
        if ('type' in body && body.type === 'tick') {
          client.setQueryData<TripResponse>(queryKey, (old) =>
            old ? { ...old, rtSourceTimestamp: body.rtSourceTimestamp, generatedAt: body.generatedAt } : old,
          )
        } else {
          client.setQueryData(queryKey, body)
        }
        attempts = 0
        healthy()
        setConnected(true)
      }
      ws.onclose = () => {
        clearTimeout(silence)
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
      clearTimeout(silence)
      document.removeEventListener('visibilitychange', onVisibility)
      ws?.close(1000, 'unmount')
    }
  }, [base, tripInstance, mode, client])
  return { connected }
}
