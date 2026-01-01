# n8n Workflow Optimizations

This document details the custom JavaScript optimizations and configurations implemented to ensure stability, prevent API blocking (HTTP 429), and handle data efficiently.

## 1. Progressive Rate Limit Backoff
**Purpose:** Prevents OpenAI `429 Too Many Requests` errors by dynamically increasing the wait time between subsequent API calls.
**Node Name:** `Progressive Rate Limit`
**Type:** Code Node

```javascript
// PROGRESSIVE RATE LIMIT BACKOFF
// This script uses static workflow data to track the number of API calls in the current execution
// and applies an increasingly longer delay to ensure we stay within rate limits.

const staticData = $getWorkflowStaticData('global');
const apiCallsThisRun = staticData.apiCallsThisRun || 0;

// Track this call
staticData.apiCallsThisRun = apiCallsThisRun + 1;

// Progressive delay calculation
// Base delay: 120 seconds (2 minutes)
// Increment: +60 seconds per additional call
const baseDelay = 120; 
const incrementalDelay = 60; 
const totalDelay = baseDelay + (apiCallsThisRun * incrementalDelay);

console.log(`🔄 API Call #${apiCallsThisRun + 1} - Will wait ${totalDelay}s after this call`);

// Pass through the data with delay info to be used by a Wait node
return [{
  json: {
    ...$input.first().json,
    _delaySeconds: totalDelay,
    _apiCallNumber: apiCallsThisRun + 1
  }
}];
```

## 2. Smart Caching System
**Purpose:** Reduces scraping costs and time by reusing previously scraped data if it is recent (default: 24 hours).
**Node Name:** `Setup 5 Competitors1` (and `Save to Cache`)
**Type:** Code Node

```javascript
// CHECK CACHE & SETUP COMPETITORS
const staticData = $getWorkflowStaticData('global');
const config = $input.first().json;
const cacheHours = config.cache_hours || 24;

// Check if valid cache exists
const cache = staticData.instagramCache;
let useCache = false;
let cacheAge = null;

if (cache && cache.timestamp) {
  const ageMs = Date.now() - cache.timestamp;
  const ageHours = ageMs / (1000 * 60 * 60);
  cacheAge = ageHours.toFixed(1) + ' hours';
  
  // Use cache if it's fresh enough and contains data
  if (ageHours < cacheHours && cache.clientPosts?.length > 0) {
    useCache = true;
    console.log(`✅ USING CACHED DATA (${cacheAge} old, expires after ${cacheHours}h)`);
    console.log(`📦 Cached: ${cache.clientPosts?.length || 0} client posts, ${cache.competitorPosts?.length || 0} competitor posts`);
  } else {
    console.log(`⏰ Cache expired (${cacheAge} old), will re-scrape`);
  }
} else {
  console.log('🆕 No cache found, will scrape fresh data');
}

// ... rest of the setup code ...

return [{
  json: {
    ...config,
    // ... basic config ...
    useCache: useCache,
    cachedClientPosts: useCache ? cache.clientPosts : null,
    cachedCompetitorPosts: useCache ? cache.competitorPosts : null,
    // ...
  }
}];
```

## 3. Service Rotation Manager
**Purpose:** Rotates between multiple scraping providers (Apify, BrightData, SociaVault, etc.) to redundancy and avoid IP blocking.
**Node Name:** `Rotation Manager`
**Type:** Code Node

```javascript
// ROTATION MANAGER
// Rotates through available services to ensure high availability
const staticData = $getWorkflowStaticData('global');
const services = ['apify', 'brightdata', 'sociavault', 'scrapeless', 'scrapingbot']; // Configurable list

let lastIndex = staticData.lastServiceIndex;
if (typeof lastIndex === 'undefined') lastIndex = -1;

// Cycle to the next service
let currentIndex = (lastIndex + 1) % services.length;
const currentService = services[currentIndex];

staticData.lastServiceIndex = currentIndex;

console.log(`Using service: ${currentService} (index ${currentIndex})`);

return [{
  json: {
    ...$input.first().json,
    currentService: currentService,
    serviceIndex: currentIndex
  }
}];
```

## 4. HTTP Request Batching
**Purpose:** Ensures requests are sent sequentially with a safety buffer, rather than all at once (which triggers rate limits).
**Location:** HTTP Request Nodes (OpenAI nodes)
**Configuration:**

In the "Options" -> "Batching" section of the HTTP Request node:

```json
{
  "batching": {
    "batch": {
      "batchSize": 1,        // Process 1 item at a time
      "batchInterval": 3000  // Wait 3000ms (3s) between items
    }
  }
}
```

**Recommendation:** For lower tier OpenAI accounts, increase `batchInterval` to `5000` or higher.
