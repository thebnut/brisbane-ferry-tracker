// Types for the plain-JS shared feedback module, so the Workers code (apps/ferry/workers/legacy.ts) can import it.
export declare const DISCORD_LIMITS: Readonly<{
  title: number
  description: number
  fieldName: number
  fieldValue: number
  footer: number
  total: number
  fields: number
}>
export declare const FEEDBACK_MIN: number
export declare const FEEDBACK_MAX: number
export declare const DISCORD_TIMEOUT_MS: number
export declare const SUCCESS_BODY: Readonly<{ success: true; message: string }>
export declare const UNAVAILABLE_BODY: Readonly<{ error: string }>
export declare const FAILED_BODY: Readonly<{ error: string }>
export declare const RATE_LIMITED_BODY: Readonly<{ error: string }>

export type HostApp = 'ferry' | 'transit' | 'legacy-web'
export declare function feedbackApp(origin: string | null | undefined, hostApp: HostApp): HostApp | 'ios'

export declare function validateFeedback(
  body: unknown,
):
  | { ok: true; value: { feedback: string; email: string | null; name: string | null; url: string | null } }
  | { ok: false; error: string }

export declare function truncate(s: string, max: number): string
export declare function sanitizeText(s: string): string

export interface DiscordEmbed {
  title: string
  description: string
  color: number
  fields: { name: string; value: string; inline: boolean }[]
  footer: { text: string }
  timestamp: string
}
export interface DiscordPayload {
  content: ''
  username: string
  allowed_mentions: { parse: [] }
  embeds: DiscordEmbed[]
}
export declare function buildDiscordPayload(input: {
  app: string
  feedback: string
  email?: string | null
  name?: string | null
  pageUrl?: string | null
  userAgent?: string | null
  now?: Date
}): DiscordPayload

export declare function relayFeedback(opts: {
  webhookUrl: string | undefined
  body: unknown
  app: string
  referer?: string | null
  userAgent?: string | null
  fetchImpl?: typeof fetch
  now?: Date
}): Promise<{ status: number; body: object }>
