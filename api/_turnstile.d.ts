// Types for the plain-JS Turnstile gate, so the Workers code (apps/ferry/workers/legacy.ts) can import it.
export interface TurnstileVerdict {
  success: boolean
  hostname: string | null
  action: string | null
}

export declare const IOS_ORIGINS: readonly string[]
export declare const IOS_CLIENT_HEADER: string
export declare const IOS_CLIENT_RE: RegExp
export declare const IOS_REQUIRE_CLIENT_HEADER: boolean
export declare const TURNSTILE_ACTION: string
export declare const VERIFY_TIMEOUT_MS: number
export declare const MAX_TOKEN_LENGTH: number
export declare const TURNSTILE_FAILED_BODY: Readonly<{ error: string }>
export declare const TURNSTILE_UNAVAILABLE_BODY: Readonly<{ error: string }>

export declare function isIosRequest(
  origin: string | null | undefined,
  clientHeader: string | null | undefined,
  requireHeader?: boolean,
): boolean
export declare function normalizeHost(host: string | null | undefined): string | null
export declare function verifyWithApi(
  post: (body: string, signal: AbortSignal) => Promise<Response>,
  token: string,
  remoteip: string | null,
): Promise<TurnstileVerdict>
export declare function checkTurnstile(opts: {
  origin?: string | null
  clientHeader?: string | null
  body: unknown
  host: string | null | undefined
  remoteip?: string | null
  verify: (token: string, remoteip: string | null) => Promise<TurnstileVerdict>
}): Promise<null | { status: number; body: object }>
