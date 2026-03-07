

## Diagnosis: Why the Redirect is Slow

The current flow has **3 layers of latency** stacked:

```text
User clicks link
  └─ 1. Load entire React SPA (~1-3s: JS bundle, hydration, React mount)
       └─ 2. Fetch edge function API (~300-800ms: cold start + DB queries)
            └─ 3. setTimeout delay (400ms iOS / 800ms Android)
                 └─ 4. Browser navigates to WhatsApp
```

**Total: 2-5 seconds** before anything happens. On mobile with slower connections, even worse.

### Root Causes

| Bottleneck | Impact | Where |
|---|---|---|
| Loading full React SPA just to redirect | ~1-3s | VipGroupRedirectPage.tsx |
| Edge function does 3+ sequential DB queries | ~300ms | group-redirect-link |
| Click count update blocks response | ~100ms | group-redirect-link |
| Artificial setTimeout before redirect | 400-800ms | VipGroupRedirectPage.tsx |
| No caching of resolved invite URL | repeat cost | group_redirect_links table |

---

## Optimization Plan

### Strategy: Eliminate the SPA, go direct HTML redirect

Instead of loading React, the edge function itself should return an **instant HTML redirect** with the cached URL. The React page becomes a fallback only for in-app browsers.

### Change 1 — Add `cached_invite_url` column to `group_redirect_links`

Store the resolved WhatsApp invite URL directly on the link record so lookups become a single query.

```sql
ALTER TABLE group_redirect_links ADD COLUMN cached_invite_url text;
ALTER TABLE group_redirect_links ADD COLUMN cached_at timestamptz;
```

### Change 2 — Rewrite edge function for speed

The optimized flow:

```text
User clicks link
  └─ 1 query: fetch link + cached_invite_url
       ├─ HAS cache → instant HTML redirect (< 200ms total)
       └─ NO cache → resolve group → cache → redirect (~500ms)
       └─ (click/redirect counts updated async, non-blocking)
```

Key changes in `group-redirect-link/index.ts`:
- **Check `cached_invite_url` first** — if present and fresh (< 1 hour), skip all group resolution logic
- **Fire-and-forget analytics** — update click_count and redirect_count without `await` (don't block the response)
- **Return instant 302 redirect** for non-API, non-in-app requests instead of an HTML page with JS redirect
- **Cache the resolved URL** back to the link record after resolution
- For API mode: same fast path, return JSON immediately

### Change 3 — Optimize the React page (fallback path)

For cases where the React page is still used (in-app browsers, no-group scenarios):
- Remove the `setTimeout` delays — redirect with `window.location.href` immediately
- On Android, try intent URL immediately without 800ms fallback delay

### Change 4 — Add direct edge function route for production

For the production domain (`checkout.bananacalcados.com.br/vip/slug`), the optimal path is:
- Keep the React route as-is for SPA navigation
- But add a note: for maximum speed, the link could point directly to the edge function URL (skipping SPA entirely), which now returns a 302 redirect in ~100-200ms

### Expected Performance

| Scenario | Before | After |
|---|---|---|
| Cached URL, normal browser | 2-5s | **< 300ms** (302 redirect) |
| No cache, needs group lookup | 2-5s | **< 800ms** |
| In-app browser (Instagram/FB) | 2-5s | **~1.5s** (SPA still loads, but no setTimeout) |

### Files to Modify
1. **Database migration** — add `cached_invite_url` and `cached_at` columns
2. **`supabase/functions/group-redirect-link/index.ts`** — fast-path with cache, 302 redirects, non-blocking analytics
3. **`src/pages/VipGroupRedirectPage.tsx`** — remove setTimeout delays, redirect instantly

