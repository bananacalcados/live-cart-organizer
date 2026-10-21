import { describe, expect, it, vi } from "vitest";
// Load the server module at test runtime, not through the browser TS graph.
const serverModule = "../../supabase/functions/_shared/austpay.ts";
const { resolveAustpayCustomer } = await import(/* @vite-ignore */ serverModule);

function database(rows: Record<string, any>) {
  const calls: { table: string; columns: string; field?: string; id?: string }[] = [];
  return {
    calls,
    from: vi.fn((table: string) => ({
      select: (columns: string) => {
        const call = { table, columns, field: "", id: "" };
        calls.push(call);
        return { eq: (field: string, id: string) => {
          call.field = field; call.id = id;
          return { maybeSingle: async () => {
            if (table === "orders" && /customers\(name|whatsapp, email/.test(columns)) {
              return { data: null, error: { message: "column does not exist" } };
            }
            return { data: rows[table] ?? null };
          } };
        } };
      },
    })),
  };
}

describe("AustPay failure customer identity", () => {
  it("resolves Maria Brígida by exact registration without nonexistent customer columns", async () => {
    const db = database({ orders: { customer: { full_name: null, whatsapp: "5532991511450" } },
      customer_registrations: { full_name: "Maria Brígida de Almeida", email: "payer@example.com" } });
    expect(await resolveAustpayCustomer(db, "order-maria")).toEqual({
      name: "Maria Brígida de Almeida", phone: "5532991511450", email: "payer@example.com",
    });
    expect(db.calls[1]).toMatchObject({ table: "customer_registrations", field: "order_id", id: "order-maria" });
  });
  it("uses customer full_name when no registration exists", async () => {
    const db = database({ orders: { customer: { full_name: "Cliente da Live", whatsapp: "5511999990000" } } });
    expect((await resolveAustpayCustomer(db, "live-id")).name).toBe("Cliente da Live");
  });
  it("resolves a direct sale by its ID", async () => {
    const db = database({ pos_sales: { customer_name: "Cliente PDV", customer_phone: "5511999990000", payment_details: { customer_email: "pdv@example.com" } } });
    expect(await resolveAustpayCustomer(db, "sale-id")).toEqual({ name: "Cliente PDV", phone: "5511999990000", email: "pdv@example.com" });
    expect(db.calls.at(-1)?.id).toBe("sale-id");
  });
  it("resolves a converted order through its linked sale, not the amount", async () => {
    const db = database({ orders: { pos_sale_id: "linked-sale", customer: null }, pos_sales: { customer_name: "Cliente Convertida" } });
    expect((await resolveAustpayCustomer(db, "order-id")).name).toBe("Cliente Convertida");
    expect(db.calls.at(-1)?.id).toBe("linked-sale");
  });
  it("does not guess another customer when the source is missing", async () => {
    expect(await resolveAustpayCustomer(database({}), "missing-id")).toEqual({ name: null, phone: null, email: null });
  });
});