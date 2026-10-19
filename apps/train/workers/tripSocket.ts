/**
 * Hibernating-WebSocket prototype for service detail (ADR-0003, Phase 4 exit criterion), behind TRIP_WS="1".
 *
 * One Durable Object per trip instance (idFromName). Browsers connect to /v1/train/trips/{key}/ws; the DO accepts the
 * socket with the Hibernation API (no duration billing while idle), sends the current TripResponse at once, then
 * refreshes the trip every 15 s from an alarm and pushes it only when anything rendered changed (otherwise a small tick,
 * or `unavailable` when the load failed so clients fall back to polling). A changed trip seen on a new connection is
 * broadcast to everyone, so newer viewers never leave older ones behind. With no sockets left the alarm stops and the object goes idle. So upstream work is one fetch per
 * trip per cycle however many people watch it, instead of one per viewer per poll.
 *
 * Lives in the bft-train Worker until services/edge is on this branch's base; it should move there (next to the
 * RtHub snapshot) so it can read the snapshot in-process. Counters for the measurement are at
 * GET /__trip-ws-stats/{key} (only when TRIP_WS is on).
 */
import { DurableObject } from 'cloudflare:workers'
import { BUILD_HEADER, buildId } from '@bft/core/build'
import type { TripResponse } from '@bft/core/contract'
import { API_TIMEOUT_MS } from '@bft/ui/upstream'
import { validateTrip } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { onConnect, onCycle, type PushState } from '../app/lib/tripFingerprint.ts'

export const CYCLE_MS = 15_000
/** Run just after each 15 s source cycle (the RT snapshot cadence), so a push carries the newest data. */
export const nextCycle = (nowMs: number) => (Math.floor(nowMs / CYCLE_MS) + 1) * CYCLE_MS + 750

interface Stats {
  cycles: number
  upstream: number
  pushes: number
  pushBytes: number
  unchanged: number
  connects: number
}

export class TripSocket extends DurableObject<Env> {
  private stats: Stats = { cycles: 0, upstream: 0, pushes: 0, pushBytes: 0, unchanged: 0, connects: 0 }
  private state: PushState = { last: null }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Counters survive hibernation (one small write per cycle).
    ctx.blockConcurrencyWhile(async () => {
      this.stats = (await ctx.storage.get<Stats>('stats')) ?? this.stats
      this.state.last = (await ctx.storage.get<string>('last')) || null
    })
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put({ stats: this.stats, last: this.state.last ?? '' })
  }

  private async tripKey(): Promise<string | null> {
    return (await this.ctx.storage.get<string>('key')) ?? null
  }

  private async load(key: string): Promise<TripResponse | null> {
    this.stats.upstream++
    const path = `/v1/train/trips/${encodeURIComponent(key)}`
    // The /v1 proxies' deadline, body included: a call bft-api holds open must not stall the trip's cycle.
    const ctrl = new AbortController()
    const timer = setTimeout(
      () => ctrl.abort(new Error(`upstream timeout after ${API_TIMEOUT_MS} ms`)),
      API_TIMEOUT_MS,
    )
    try {
      const init = { signal: ctrl.signal }
      const res =
        this.env.FIXTURES === '1'
          ? await handleFixtureApi(new URL(`http://fixtures/__fixtures${path}`), Date.now())
          : this.env.API
            ? await this.env.API.fetch(new Request(`https://bft-api${path}`, init))
            : await fetch(`${this.env.API_BASE}${path}`, init)
      if (!res.ok) return null
      return validateTrip(await res.json())
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const key = url.searchParams.get('trip') ?? ''
    if (url.pathname.endsWith('/stats'))
      return Response.json({ ...this.stats, sockets: this.ctx.getWebSockets().length })
    if (request.headers.get('upgrade') !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 })
    await this.ctx.storage.put('key', key)
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    this.stats.connects++
    const action = onConnect(this.state, await this.load(key), key)
    this.send(action.kind === 'broadcast' ? this.ctx.getWebSockets() : [server], action.body)
    // Keep exactly one alarm in the next cycle: re-arm when none is set, or a stored one is overdue or too far out.
    const alarm = await this.ctx.storage.getAlarm()
    const now = Date.now()
    if (alarm == null || alarm < now - 5_000 || alarm > now + 2 * CYCLE_MS)
      await this.ctx.storage.setAlarm(nextCycle(now))
    await this.save()
    // The upgrade goes back untouched by the Worker's wrapper, so it carries the build marker from here.
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { [BUILD_HEADER]: buildId(this.env.BUILD_SHA) },
    })
  }

  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets()
    if (sockets.length === 0) return // nobody watching: stop the cycle and let the object idle
    // Re-arm first (like RtHub), so one failed cycle never ends the push stream.
    await this.ctx.storage.setAlarm(nextCycle(Date.now()))
    this.stats.cycles++
    const key = await this.tripKey()
    const action = onCycle(this.state, key ? await this.load(key) : null, key ?? '')
    if (action.kind === 'tick') this.stats.unchanged++
    this.send(sockets, action.body)
    await this.save()
  }

  /** Send one frame to these sockets (outgoing messages are free; a closing socket is cleaned up on close). */
  private send(sockets: WebSocket[], body: string): void {
    for (const ws of sockets) {
      try {
        ws.send(body)
        this.stats.pushes++
        this.stats.pushBytes += body.length
      } catch {
        // closing mid-send
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong')
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye')
    } catch {
      // already closed
    }
  }
}

const WS_PATH = /^\/v1\/train\/trips\/([^/]+)\/ws$/
const STATS_PATH = /^\/__trip-ws-stats\/([^/]+)$/

/** Route /v1/train/trips/{key}/ws and the stats endpoint to the trip's Durable Object; null for other paths. */
export function routeTripSocket(request: Request, env: Env): Promise<Response> | null {
  if (env.TRIP_WS !== '1' || !env.TRIP_SOCKET) return null
  const url = new URL(request.url)
  const m = WS_PATH.exec(url.pathname) ?? STATS_PATH.exec(url.pathname)
  if (!m) return null
  const key = decodeURIComponent(m[1] as string)
  if (!/^.+@\d{8}$/.test(key)) return Promise.resolve(new Response('Bad trip', { status: 400 }))
  const stub = env.TRIP_SOCKET.get(env.TRIP_SOCKET.idFromName(key))
  const target = new URL(STATS_PATH.test(url.pathname) ? 'https://do/stats' : 'https://do/ws')
  target.searchParams.set('trip', key)
  return stub.fetch(new Request(target, request))
}
