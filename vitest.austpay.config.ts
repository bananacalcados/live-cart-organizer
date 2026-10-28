import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["supabase/functions/_shared/refund-gateways/austpay.test.ts"] },
});