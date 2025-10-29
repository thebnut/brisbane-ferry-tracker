# Phase 2: API Infrastructure - Setup Guide

## Status: CODE COMPLETE - READY FOR INFRASTRUCTURE SETUP

**Date**: October 29, 2025
**Branch**: mode-abstraction-v2
**Phase**: 2 of 4

---

## ✅ What's Been Created

### New API Files (Production-Ready)
```
api/schedule/train/route.js           ✅ Train route query endpoint
schedule-processor/process-schedule-api.js  ✅ API route generator
.github/workflows/update-train-api.yml      ✅ Daily automation workflow
```

### Ferry Production Files (UNTOUCHED 🔒)
```
.github/workflows/update-schedule.yml  🔒 NO CHANGES
schedule-processor/process-schedule.js 🔒 NO CHANGES
schedule-data/                        🔒 NO CHANGES
```

**Verification**: `git status` shows zero changes to ferry production files

---

## 🚀 Next Steps: Vercel Infrastructure Setup

### Step 1: Initialize Vercel KV (Redis Cache)

**Via Vercel Dashboard:**
1. Go to https://vercel.com/dashboard
2. Select project: `brisbane-ferry-tracker`
3. Navigate to: **Storage** tab
4. Click: **Create Database**
5. Choose: **KV (Redis)**
6. Configure:
   - Name: `brisbane-transit-cache`
   - Region: **Sydney** (ap-southeast-2) - closest to Brisbane
   - Tier: **Free tier** (included in Pro)
7. Click: **Create**
8. Environment variables auto-created:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`

**Verification:**
```bash
vercel env ls | grep KV_
```

Expected output:
```
KV_REST_API_URL       Encrypted  Production, Preview, Development
KV_REST_API_TOKEN     Encrypted  Production, Preview, Development
```

---

### Step 2: Initialize Vercel Blob Storage

**Via Vercel Dashboard:**
1. In same project: `brisbane-ferry-tracker`
2. Navigate to: **Storage** tab
3. Click: **Create Blob Store**
4. Configure:
   - Name: `brisbane-transit-schedules`
   - Region: **Sydney** (ap-southeast-2)
   - Tier: **Free tier** (starts at $0, pay as you go)
5. Click: **Create**
6. Environment variable auto-created:
   - `BLOB_READ_WRITE_TOKEN`

**Verification:**
```bash
vercel env ls | grep BLOB_
```

Expected output:
```
BLOB_READ_WRITE_TOKEN  Encrypted  Production, Preview, Development
```

---

### Step 3: Configure GitHub Secrets (For GitHub Actions)

The workflow needs the Blob token to upload files.

**Via GitHub:**
1. Go to repository: `brisbane-ferry-tracker`
2. Navigate to: **Settings** → **Secrets and variables** → **Actions**
3. Click: **New repository secret**
4. Add secret:
   - Name: `BLOB_READ_WRITE_TOKEN`
   - Value: Get from Vercel Dashboard → Storage → Blob → Settings → Token
5. Click: **Add secret**

**Verification:**
- GitHub → Settings → Secrets → Actions should show `BLOB_READ_WRITE_TOKEN`

---

## 🧪 Testing Phase 2

### Test 1: Local Development (Without Blob Storage)

```bash
# Start local dev server
npm run dev

# Server runs on http://localhost:5174
# Ferry functionality should work unchanged
```

**Expected**: Ferry app works identically to Phase 1

---

### Test 2: Vercel Dev (With Edge Functions)

```bash
# Install Vercel CLI if needed
npm install -g vercel

# Run Vercel dev server (simulates production)
vercel dev

# Server runs on http://localhost:3000
```

**Test the API endpoint:**
```bash
# Test API (will fail initially - expected without data)
curl "http://localhost:3000/api/schedule/train/route?origin=600016&destination=600029"
```

**Expected response (404):**
```json
{
  "error": "Route not found",
  "message": "No direct route exists between these stations"
}
```

This is **correct** - we haven't uploaded route data yet!

---

### Test 3: Run Schedule Processor Locally

**Prerequisites:**
- Vercel KV and Blob Storage configured
- Environment variables linked

```bash
cd schedule-processor

# Run the API processor
node process-schedule-api.js
```

**Expected output:**
```
🚀 Train Schedule API Processor
================================

📥 Downloading GTFS data from TransLink...
✅ Downloaded XX.XX MB
📦 Extracting GTFS files...
  ✓ stops.txt: XXXX records
  ✓ routes.txt: XXX records
  ✓ trips.txt: XXXXX records
  ✓ stop_times.txt: XXXXXX records
🚂 Filtering train data...
  Found XX train routes
  Found XXXX train trips
  Found XXXXX train stop times
  Found XXX train stops
🔄 Generating route pairs...
  Processed XXXX/XXXX trips...
✅ Generated XXXX unique route pairs
📊 Identifying popular routes...

🔥 Top 20 Popular Routes:
  1. Central station → Roma Street station: XXX departures
  2. ...

☁️  Uploading to Vercel Blob Storage...
  Uploaded 100/XXXX routes...
  Uploaded 200/XXXX routes...
  ...
✅ Uploaded XXXX route files
⚠️  Skipped XX empty routes

✅ Process complete!
   Total routes: XXXX
   Uploaded: XXXX
   Skipped: XX
```

**Duration**: 2-5 minutes depending on internet speed

---

### Test 4: Test API After Upload

```bash
# Now test with real data
curl "http://localhost:3000/api/schedule/train/route?origin=600016&destination=600029&hours=4"
```

**Expected response (200 OK):**
```json
{
  "origin": {
    "id": "600016",
    "name": "Central station",
    "lat": -27.4661,
    "lng": 153.0250,
    "platform": "..."
  },
  "destination": {
    "id": "600029",
    "name": "Roma Street station",
    "lat": -27.4646,
    "lng": 153.0188,
    "platform": "..."
  },
  "departures": [
    {
      "tripId": "...",
      "routeId": "...",
      "routeName": "...",
      "headsign": "...",
      "scheduledDeparture": "HH:MM:SS",
      "scheduledArrival": "HH:MM:SS",
      "platform": "..."
    }
  ],
  "totalDepartures": X,
  "timeWindow": {
    "hours": 4,
    "from": "2025-10-29T...",
    "to": "2025-10-29T..."
  },
  "generated": "2025-10-29T...",
  "validUntil": "2025-10-29T...",
  "meta": {
    "cached": false,
    "responseTime": "XXms",
    "cacheKey": "train:route:600016:600029:..."
  }
}
```

---

### Test 5: Test Caching

```bash
# First request (cache miss)
time curl "http://localhost:3000/api/schedule/train/route?origin=600016&destination=600029"
# Note responseTime

# Second request (cache hit)
time curl "http://localhost:3000/api/schedule/train/route?origin=600016&destination=600029"
# Should be faster, meta.cached should be true
```

**Expected**:
- First request: `cached: false`, slower
- Second request: `cached: true`, much faster (< 50ms)

---

## 🚀 Deploy to Production

### Step 1: Commit Phase 2 Code

```bash
git add .
git commit -m "feat: Phase 2 - Add train API infrastructure

- Add train schedule API endpoint
- Add separate schedule processor for API
- Add GitHub Actions workflow for daily updates
- Uploads to Vercel Blob Storage
- Ferry production workflows unchanged"

git push origin mode-abstraction-v2
```

### Step 2: Trigger GitHub Actions Manually

1. Go to: GitHub → Actions
2. Select workflow: **Update Train API Schedules**
3. Click: **Run workflow**
4. Select branch: `mode-abstraction-v2`
5. Click: **Run workflow**

**Monitor the run:**
- Should complete in 3-5 minutes
- Check logs for errors
- Verify upload count matches local test

### Step 3: Test Production API

Once deployed:

```bash
# Get your preview URL
vercel ls | grep mode-abstraction-v2

# Or from Vercel dashboard
# Test the API
curl "https://your-preview-url.vercel.app/api/schedule/train/route?origin=600016&destination=600029"
```

**Expected**: Same successful response as local testing

---

## 📊 Success Criteria

### Phase 2 Complete When:

- [x] Code files created
- [ ] Vercel KV initialized
- [ ] Vercel Blob Storage initialized
- [ ] GitHub secret configured
- [ ] Local processor test successful
- [ ] API responds with data
- [ ] Cache hit rate >80% after warmup
- [ ] Response time <200ms (P95)
- [ ] GitHub Actions workflow successful
- [ ] Production API tested
- [ ] Ferry production unchanged

### Performance Targets

| Metric | Target | How to Measure |
|--------|--------|----------------|
| API Response Time | <200ms | Check `meta.responseTime` in response |
| Cache Hit Rate | >80% | Monitor Vercel KV metrics after 1 hour |
| Route Files Generated | 5,000+ | Check processor output |
| Blob Storage Size | ~100-200MB | Vercel Dashboard → Storage |
| Daily Updates | Success | GitHub Actions should run at 3:30 AM AEST |

---

## 🔍 Monitoring & Validation

### After Deployment, Monitor:

**Vercel KV Dashboard:**
- Keys created: Should grow to ~1,000+ as routes are queried
- Hit rate: Target >80% after initial warmup
- Memory usage: Should stay under 50MB

**Vercel Blob Storage:**
- Total files: ~5,000+ route JSON files + 1 metadata
- Total size: ~100-200MB
- Last updated: Should match GitHub Actions schedule

**GitHub Actions:**
- Workflow runs: Daily at 3:30 AM AEST
- Success rate: 100% target
- Duration: 3-5 minutes expected
- Logs: Check for any errors

**API Performance (via curl):**
```bash
# Test multiple routes
for i in {1..10}; do
  curl -w "Time: %{time_total}s\n" \
    "https://your-url.vercel.app/api/schedule/train/route?origin=600016&destination=600029"
done
```

Target: All responses <200ms after first (cache warmup)

---

## 🛡️ Safety & Rollback

### If Something Goes Wrong

**Level 1: Disable train API only**
```bash
# Rename the API file temporarily
git mv api/schedule/train/route.js api/schedule/train/route.js.disabled
git commit -m "temp: Disable train API"
git push
```

**Level 2: Disable GitHub Actions workflow**
- GitHub → Actions → Update Train API Schedules → Disable workflow

**Level 3: Full rollback to Phase 1**
```bash
git revert <phase-2-commit-hash>
git push
```

**Ferry production is safe**: Completely isolated, no dependencies on Phase 2

---

## 📋 Cost Estimate

### Vercel Storage Costs (Monthly)

**KV (Redis):**
- Free tier: 256MB storage, 100K requests
- Expected usage: <10MB, <50K requests/month
- **Cost: $0/month** (well within free tier)

**Blob Storage:**
- Pricing: $0.15/GB stored, $0.20/GB bandwidth
- Expected: ~0.2GB storage, ~1GB bandwidth/month
- **Cost: $0.03 + $0.20 = $0.23/month**

**Total Phase 2 Cost: ~$0.25/month**
**Total Project Cost: Vercel Pro ($20) + Domains ($1) + Storage ($0.25) = ~$21.25/month**

Well within budget! ✅

---

## 🎯 Next Phase Preview

### Phase 3: Train Mode UI (Week 3)

Once Phase 2 is stable:
1. Add train configuration to mode system
2. Update components for platform display
3. Integrate API with frontend
4. Test real-time train tracking
5. Polish UI for train stations

**Depends on Phase 2**: API infrastructure must be working and stable

---

## 🆘 Troubleshooting

### Issue: Processor fails to upload to Blob

**Check:**
```bash
vercel env ls | grep BLOB_READ_WRITE_TOKEN
```

**Fix:** Ensure Blob Storage is initialized and token is linked

---

### Issue: API returns 500 errors

**Check Vercel logs:**
```bash
vercel logs --follow
```

**Common causes:**
- KV not initialized
- Blob Storage not accessible
- Missing environment variables

---

### Issue: GitHub Actions fails

**Check:**
1. Secrets configured correctly
2. Branch `mode-abstraction-v2` exists
3. Dependencies installed correctly
4. Vercel Blob token valid

---

### Issue: Cache not working

**Verify KV setup:**
- Vercel Dashboard → Storage → KV
- Check if database is active
- Verify environment variables linked

---

## 📝 Documentation Status

- [x] Setup guide created
- [x] Testing procedures documented
- [x] Success criteria defined
- [x] Troubleshooting guide included
- [x] Cost estimates provided
- [ ] Performance baseline established (after deployment)
- [ ] Monitoring dashboard configured (after deployment)

---

## ✅ Ready to Proceed

**You are ready to:**
1. Initialize Vercel KV Store
2. Initialize Vercel Blob Storage
3. Configure GitHub secret
4. Run tests
5. Deploy to production

**Estimated time:** 30-45 minutes for setup + testing

**Questions?** Review this guide or check:
- [START_HERE.md](../START_HERE.md)
- [STEP_BY_STEP_IMPLEMENTATION.md](../STEP_BY_STEP_IMPLEMENTATION.md)
- [PHASE1_COMPLETE_SUMMARY.md](../PHASE1_COMPLETE_SUMMARY.md)

---

**Let's build Phase 2! 🚀**
