/**
 * Privacy and terms copy, taken from the legacy static pages (public/privacy.html, public/terms.html) at build time
 * so there is one source of text. Only the article body is used; the page chrome is ours.
 */
import privacyHtml from '../../../../public/privacy.html?raw'
import termsHtml from '../../../../public/terms.html?raw'

function article(html: string): string {
  const main = /<main>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? ''
  // Drop the legacy page's own header (logo + home link); our SiteHeader replaces it.
  return main.replace(/<header>[\s\S]*?<\/header>/, '').trim()
}

export const PRIVACY_HTML = article(privacyHtml)
export const TERMS_HTML = article(termsHtml)
