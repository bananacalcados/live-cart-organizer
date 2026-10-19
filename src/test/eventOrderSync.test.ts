import { describe, expect, it } from "vitest";
import { changedOrderIds } from "@/stores/dbOrderRealtime";
import type { DbOrder } from "@/types/database";
const cart = { id: "cart", event_id: "live", stage: "awaiting_confirmation",
  updated_at: "2026-10-19T19:00:00Z", customer: { whatsapp: "5573988735752" } } as DbOrder;
describe("event cart reconciliation", () => {
  it("loads a newly assembled cart so its owner leaves new contacts", () => {
    expect(changedOrderIds([], [cart])).toEqual(["cart"]);
  });
  it("reloads when the phone changes without an order timestamp change", () => {
    const previous = { ...cart, customer: { ...cart.customer, whatsapp: undefined } } as DbOrder;
    expect(changedOrderIds([previous], [cart])).toEqual(["cart"]);
  });
  it("reloads changed carts but leaves unchanged carts alone", () => {
    expect(changedOrderIds([cart], [cart])).toEqual([]);
    expect(changedOrderIds([cart], [{ ...cart, updated_at: "2026-10-19T19:01:00Z" }])).toEqual(["cart"]);
  });
});
