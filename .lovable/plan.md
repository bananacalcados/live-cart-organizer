

## Plan: Add 48h cutoff to Yampi webhook phone fallback

**File:** `supabase/functions/yampi-webhook/index.ts`

**Change:** In the phone-based fallback search (around lines 80-95), add a 48-hour time filter and an error log when no recent order is found.

**Specific edits:**

1. Before the `.order("created_at"...)` query on `orders`, add:
   - `const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();`
   - Add `.gte("created_at", cutoff)` to the query chain

2. After the query, if no orders found, add `console.error` with phone and truncated payload, then skip the update block.

No other logic changes.

