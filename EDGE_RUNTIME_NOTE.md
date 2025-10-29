# Edge Runtime vs Node.js Runtime

**Decision**: Using **Node.js Runtime** for Train API
**Date**: October 29, 2025

---

## The Issue

Vercel build failed with:
```
Error: The Edge Function "api/schedule/train/route" is referencing unsupported modules:
	- @redis: string_decoder, url, net, tls, crypto
```

---

## Why Edge Runtime Failed

### Edge Runtime Limitations
- Runs on Cloudflare Workers (V8 isolates)
- **Cannot create TCP connections**
- No access to Node.js native modules (net, tls, crypto, etc.)
- Optimized for ultra-low latency (<50ms globally)

### Our Redis Setup
- **Redis Cloud** provides native Redis protocol (redis://)
- Native protocol requires **TCP connections**
- Standard `redis` npm package needs Node.js modules
- **Incompatible with Edge Runtime**

---

## Solutions Considered

### Option 1: Node.js Runtime ✅ **SELECTED**

**Pros:**
- ✅ Keep existing Redis Cloud setup
- ✅ Keep existing `redis` package
- ✅ No code changes needed
- ✅ Full Redis protocol support
- ✅ No additional costs

**Cons:**
- ❌ Slightly slower cold starts (~200-300ms vs ~50ms)
- ❌ Regional (not globally distributed)

**Performance:**
- Cold start: 200-300ms (first request)
- Warm: <100ms (subsequent requests)
- With Redis cache: <50ms (cache hits)
- **Total response time**: ~100-200ms (acceptable)

---

### Option 2: Switch to Upstash Redis (Edge Compatible)

**Pros:**
- ✅ Edge Runtime compatible (REST API)
- ✅ Ultra-fast global distribution
- ✅ <50ms response times

**Cons:**
- ❌ Requires changing Redis provider (Redis Cloud → Upstash)
- ❌ Different package (`@upstash/redis`)
- ❌ REST API overhead (vs native protocol)
- ❌ Additional setup and migration

**Not chosen**: Too much overhead for marginal benefit

---

### Option 3: @vercel/kv (Deprecated)

**Status**: Deprecated by Vercel
**Not recommended**: Legacy solution being phased out

---

## Performance Comparison

| Metric | Edge Runtime | Node.js Runtime |
|--------|-------------|-----------------|
| Cold start | 50-100ms | 200-300ms |
| Warm requests | 10-20ms | 50-100ms |
| With Redis cache | 20-30ms | 30-50ms |
| Global distribution | Yes | No (regional) |
| TCP connections | ❌ No | ✅ Yes |
| Native modules | ❌ No | ✅ Yes |

### For Our Use Case (Train Schedules)

**Expected traffic pattern:**
- Most queries cached (5-min TTL)
- Peak times: morning/evening commute
- Regional users (Brisbane, Australia)

**Performance impact:**
- Cache hits: ~30-50ms (very fast)
- Cache misses: ~150-200ms (acceptable for schedules)
- 80%+ cache hit rate expected

**Verdict**: Node.js runtime is perfectly acceptable for train schedules ✅

---

## Edge Runtime Use Cases

### When to Use Edge Runtime

✅ **Perfect for:**
- Static content delivery
- Simple API routes without database connections
- Serverless KV stores (Upstash, Vercel KV)
- Global user base needing <50ms response
- Simple transformations and redirects

❌ **Not suitable for:**
- Native database protocols (Postgres, MySQL, Redis)
- Node.js native modules
- File system access
- Complex crypto operations
- WebSockets

---

## Node.js Runtime Use Cases

### When to Use Node.js Runtime

✅ **Perfect for:**
- Database connections (native protocols)
- Redis, Postgres, MySQL, MongoDB
- Full Node.js API access
- Complex backend logic
- File uploads/processing
- WebSockets
- **Our train schedule API** ✅

❌ **Overkill for:**
- Static JSON responses
- Simple redirects
- Edge KV lookups

---

## Implementation

### Code Change

**File**: `api/schedule/train/route.js`

```javascript
export const config = {
  runtime: 'nodejs', // Changed from 'edge'
};
```

**That's it!** One line change. Everything else stays the same.

---

## Performance Optimization

Even with Node.js runtime, we maintain excellent performance through:

### 1. Redis Caching
- 5-minute TTL
- 80%+ cache hit rate
- <50ms cached responses

### 2. Vercel Blob Storage
- CDN-backed object storage
- Fast file retrieval
- Only hit on cache misses

### 3. Regional Deployment
- Sydney region (close to Brisbane)
- Low latency for Australian users
- <50ms network overhead

### 4. Efficient Code
- Minimal processing
- JSON streaming
- No unnecessary transformations

**Result**: ~100-200ms average response time (excellent for train schedules)

---

## Alternative: Hybrid Approach

**Future optimization** (if needed):

### Edge Runtime for Static Data
```javascript
// api/schedule/train/stations.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Return static station list (no Redis)
  return Response.json(STATIONS);
}
```

### Node.js Runtime for Dynamic Queries
```javascript
// api/schedule/train/route.js (current)
export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  // Query Redis + Blob Storage
  return Response.json(scheduleData);
}
```

**Benefit**: Best of both worlds
- Static data: Ultra-fast Edge
- Dynamic data: Full Node.js capabilities

---

## Cost Implications

### Node.js Runtime
- **Execution time**: ~100-200ms per request
- **Pricing**: $0.00002 per request (after 100k free)
- **Expected**: <100k requests/month (free tier)

### Edge Runtime
- **Execution time**: ~20-50ms per request
- **Pricing**: Same ($0.00002 per request)
- **Benefit**: Minimal cost difference

**Verdict**: No significant cost difference for our traffic levels

---

## Monitoring

### Key Metrics to Watch

**Response Times:**
- Target: <200ms P95
- Monitor: Vercel Analytics
- Alert: >500ms sustained

**Cache Hit Rate:**
- Target: >80%
- Monitor: Redis dashboard
- Alert: <60%

**Cold Starts:**
- Target: <300ms
- Monitor: Vercel logs
- Improve: Warm-up requests if needed

---

## Future Considerations

### If Traffic Increases 10x

**Symptoms:**
- Cold starts becoming frequent
- Response times degrading
- Cache hit rate dropping

**Solutions:**
1. **Add warm-up requests** (keep functions warm)
2. **Increase cache TTL** (5 min → 10 min)
3. **Pre-warm popular routes** (top 20)
4. **Consider Edge Runtime** (switch to Upstash)

---

## Decision Summary

**Runtime**: Node.js ✅
**Package**: `redis` (node-redis v4)
**Provider**: Redis Cloud
**Protocol**: Native (redis://)
**Performance**: ~100-200ms (excellent)
**Cost**: $0/month (free tier)

**Rationale**:
- Simplest solution
- Keeps existing setup
- Excellent performance
- No migration needed
- Future-proof

---

## Documentation References

- [Vercel Edge Runtime](https://vercel.com/docs/functions/edge-functions)
- [Vercel Node.js Runtime](https://vercel.com/docs/functions/serverless-functions)
- [Redis Cloud + Vercel](https://redis.io/docs/latest/operate/rc/cloud-integrations/vercel/)
- [node-redis v4](https://github.com/redis/node-redis)

---

**Decision made: Node.js runtime is the right choice for our train schedule API with Redis Cloud. Simple, performant, and cost-effective! ✅**
