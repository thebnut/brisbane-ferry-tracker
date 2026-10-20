// The part of Vite's `import.meta.env` this package reads (apps type it fully through vite/client).
interface ImportMetaEnv {
  readonly SSR: boolean
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
