/** Shard bucket for a stop key: FNV-1a 32-bit over UTF-16 code units, modulo the shard count (GenerationIndex.shards). */
export function shardOf(stopKey: string, count: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < stopKey.length; i++) {
    h ^= stopKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % count
}
