import { describe, expect, it } from "vitest";
import { isDuplicateLiveOrder, livePhoneKey } from "@/lib/liveDuplicateOrder";
import type { DbOrder } from "@/types/database";

const order = (handle: string, whatsapp: string, last4 = "") => ({
  id: "1", event_id: "e", customer_id: "c", stage: "awaiting_payment", products: [], has_unread_messages: false,
  is_paid: false, created_at: "", updated_at: "", phone_last4: last4,
  customer: { id: "c", instagram_handle: handle, whatsapp },
} as unknown as DbOrder);

describe("aviso de pedido duplicado na live", () => {
  it("compara DDD + últimos 8 dígitos mesmo com o nono dígito diferente", () => {
    expect(livePhoneKey("5519995351335")).toBe("1995351335");
    expect(isDuplicateLiveOrder(order("@cidinha_simas", "551195351335"), { whatsapp: "5519995351335", instagramHandle: "5519995351335" })).toBe(true);
  });
  it("compara final de quatro dígitos junto com o @", () => {
    expect(isDuplicateLiveOrder(order("@cidinha_simas", "", "1335"), { phoneLast4: "1335", instagramHandle: "@Cidinha_Simas" })).toBe(true);
    expect(isDuplicateLiveOrder(order("@outra", "", "1335"), { phoneLast4: "1335", instagramHandle: "@Cidinha_Simas" })).toBe(false);
  });
  it("ignora pedidos pagos, cancelados ou mesclados", () => {
    const paid = { ...order("@cida", "5519995351335"), is_paid: true };
    expect(isDuplicateLiveOrder(paid, { whatsapp: "5519995351335" })).toBe(false);
  });
});
