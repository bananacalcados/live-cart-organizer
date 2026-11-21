import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { orderInstagram, selfservicePhoneKey } from "../../supabase/functions/_shared/selfservice-identity";
import { resolveOrderChoice, choiceIdentity } from "../../supabase/functions/_shared/selfservice-order-choice";
import { registrationCustomerIds } from "../../supabase/functions/_shared/registration-customer";

// Execute the actual edge handler with every database/provider replaced in memory.
const source = readFileSync("supabase/functions/live-selfservice/index.ts", "utf8").replace(/^import .*;\s*$/gm, "");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const phone = "5533999994550";
const eventId = "11111111-1111-4111-8111-111111111111";
const accessId = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, any>;
function fixture(ids = ["x", "y"]) {
  const tables: Record<string, Row[]> = {
    events: [{ id: eventId, self_service_slug: "teste", name: "Live teste", operation_mode: "whatsapp_autoatendimento" }],
    orders: ids.map((id) => ({ id, event_id: eventId, customer_id: id, phone_last4: "4550", stage: "incomplete_order", is_paid: false,
      paid_externally: false, merged_into_order_id: null, created_at: new Date().toISOString(),
      products: [{ title: `Produto ${id}`, price: 159.99, quantity: 1, image: null }] })),
    customers: ids.map((id) => ({ id, instagram_handle: `pessoa_${id}`, whatsapp: "" })),
    live_selfservice_accesses: [], customer_registrations: [], customers_unified: [], event_leads: [], app_settings: [], live_whatsapp_clicks: [],
  };
  const writes: { table: string; payload: Row; ids: string[] }[] = [];
  const queries: { table: string; filters: [string, string, any][] }[] = [];
  let failCandidates = false;
  class Query {
    filters: [string, string, any][] = [];
    mode = "read"; payload: Row = {}; cap = Infinity; single = false;
    constructor(public table: string) {}
    select() { return this; }
    eq(k: string, v: any) { this.filters.push(["eq", k, v]); return this; }
    neq(k: string, v: any) { this.filters.push(["neq", k, v]); return this; }
    is(k: string, v: any) { this.filters.push(["is", k, v]); return this; }
    not(k: string, _op: string, v: any) { this.filters.push(["not", k, v]); return this; }
    in(k: string, v: any) { this.filters.push(["in", k, v]); return this; }
    overlaps(k: string, v: any) { this.filters.push(["overlaps", k, v]); return this; }
    ilike(k: string, v: string) { this.filters.push(["ilike", k, v]); return this; }
    or() { this.filters.push(["blank_phone", "whatsapp", null]); return this; }
    order() { return this; }
    limit(n: number) { this.cap = n; return this; }
    maybeSingle() { this.single = true; return this; }
    update(v: Row) { this.mode = "update"; this.payload = v; return this; }
    insert(v: Row) { this.mode = "insert"; this.payload = v; return this; }
    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      const matches = (r: Row) => this.filters.every(([op, k, v]) => {
        if (op === "eq") return r[k] === v;
        if (op === "neq") return r[k] !== v;
        if (op === "is") return (r[k] ?? null) === v;
        if (op === "not") return (r[k] ?? null) !== v;
        if (op === "in") return v.includes(r[k]);
        if (op === "overlaps") return (r[k] || []).some((id: string) => v.includes(id));
        if (op === "ilike") return String(r[k] || "").endsWith(v.replace(/^%/, ""));
        if (op === "blank_phone") return !r[k];
        return true;
      });
      if (this.mode === "read") queries.push({ table: this.table, filters: [...this.filters] });
      if (failCandidates && this.table === "orders" && this.filters.some((f) => f[1] === "phone_last4")) {
        return Promise.resolve({ data: null, error: { message: "simulated" } }).then(resolve, reject);
      }
      let rows = (tables[this.table] || []).filter(matches).slice(0, this.cap);
      if (this.mode === "update") {
        writes.push({ table: this.table, payload: this.payload, ids: rows.map((r) => r.id) });
        rows.forEach((r) => Object.assign(r, this.payload));
      } else if (this.mode === "insert") {
        const r = { id: `insert-${writes.length}`, ...this.payload };
        (tables[this.table] ||= []).push(r); rows = [r];
        writes.push({ table: this.table, payload: this.payload, ids: [r.id] });
      }
      const data = rows.map((r) => this.table === "orders" ? { ...r,
        customer: tables.customers.find((c) => c.id === r.customer_id),
        registration: tables.customer_registrations.find((c) => c.order_id === r.id) || null,
      } : { ...r });
      return Promise.resolve({ data: this.single ? data[0] || null : data, error: null, count: data.length }).then(resolve, reject);
    }
  }
  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === "live_member_rate_limit") return { data: true, error: null };
    if (name === "selfservice_capture_initial") {
      if (!tables.live_selfservice_accesses.some((a) => a.id === accessId)) tables.live_selfservice_accesses.push({
        id: accessId, event_id: eventId, entered_phone: args.p_phone, phone_key: selfservicePhoneKey(args.p_phone),
        instagram: args.p_instagram, order_ids: [], metadata: {}, whatsapp_confirmed_at: null, registered_at: null,
      });
      return { data: { access_id: accessId, order_ids: [] }, error: null };
    }
    return { data: [], error: null };
  });
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const forbiddenFetch = vi.fn(() => { throw new Error("No provider may be called in this test"); });
  runInNewContext(compiled, {
    Deno: { env: { get: () => "mock-only" }, serve: (h: typeof handler) => { handler = h; } },
    createClient: () => ({ from: (t: string) => new Query(t), rpc }),
    withAccessLog: (_: string, h: typeof handler) => h,
    normalizeBrPhone: (p: string) => { let n = String(p || "").replace(/\D/g, ""); if (n.length <= 11) n = "55" + n; return n.length === 13 ? n : null; },
    resolveEventNumber: async () => ({ id: null, targetPhone: "5533999991111" }),
    resolveSelfserviceAdvertising: async () => ({ mode: "refused" }), cleanSelfserviceSignals: () => ({}),
    orderInstagram, selfservicePhoneKey, resolveOrderChoice, choiceIdentity, registrationCustomerIds,
    registrationAddressFieldError: () => null,
    Request, Response, Headers, URL, TextEncoder, crypto: webcrypto, fetch: forbiddenFetch,
    console: { error: () => {}, warn: () => {} },
  });
  const request = async (body: Row) => {
    if (!handler) throw new Error("Missing handler");
    const response = await handler(new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "teste", phone, instagram: "@errado", ...body }) }));
    return { status: response.status, data: await response.json() };
  };
  return { tables, writes, queries, rpc, request, forbiddenFetch, fail: () => { failCandidates = true; } };
}
const details = { full_name: "Pessoa Teste", cpf: "52998224725", email: "pessoa@exemplo.com.br", cep: "35000000", address: "Rua Teste", address_number: "10", city: "Governador Valadares", state: "MG" };

describe("cadastro real da live com serviços simulados", () => {
  it("empate retorna somente @, produtos e total, sem expor ficha ou telefone", async () => {
    const f = fixture(); const { data } = await f.request({ action: "identify" });
    expect(data.needs_order_choice).toBe(true);
    expect(data.orders).toEqual([]);
    expect(data.candidates.map((c: Row) => c.instagram)).toEqual(["pessoa_x", "pessoa_y"]);
    expect(Object.keys(data.candidates[0]).sort()).toEqual(["id", "instagram", "products", "total"]);
    expect(data.details).toBeUndefined();
    expect(f.writes.every((w) => w.table === "live_selfservice_accesses")).toBe(true);
    expect(f.forbiddenFetch).not.toHaveBeenCalled();
  });
  it("escolher Y e cadastrar grava somente Y e usa o @ da equipe na mensagem pronta", async () => {
    const f = fixture(); await f.request({ action: "identify", selected_order_id: "y" });
    const { data, status } = await f.request({ action: "register", access_id: accessId, selected_order_id: "y", order_ids: ["y"], details });
    expect(status).toBe(200); expect(data.has_order).toBe(true);
    expect(data.text).toContain("@pessoa_y"); expect(data.text).not.toContain("@errado");
    expect(f.tables.customers.find((c) => c.id === "x")?.whatsapp).toBe("");
    expect(f.tables.customer_registrations.map((r) => r.order_id)).toEqual(["y"]);
    expect(f.tables.live_selfservice_accesses[0].whatsapp_confirmed_at).toBeNull();
    expect(f.forbiddenFetch).not.toHaveBeenCalled();
  });
  it("pedido completo de X não compete nem é alterado ao cadastrar Y", async () => {
    const f = fixture(); f.tables.customers[0].whatsapp = phone;
    const { data } = await f.request({ action: "identify" });
    expect(data.needs_order_choice).toBeUndefined(); expect(data.orders.map((o: Row) => o.id)).toEqual(["y"]);
    await f.request({ action: "register", access_id: accessId, selected_order_id: "y", order_ids: ["y"], details });
    expect(f.tables.customer_registrations.map((r) => r.order_id)).toEqual(["y"]);
  });
  it("não aceita trocar o ID escolhido escondido no envio do cadastro", async () => {
    const f = fixture(); await f.request({ action: "identify", selected_order_id: "y" }); f.writes.length = 0;
    const { status } = await f.request({ action: "register", access_id: accessId, selected_order_id: "x", order_ids: ["x"], details });
    expect(status).toBe(409); expect(f.writes).toEqual([]); expect(f.forbiddenFetch).not.toHaveBeenCalled();
  });
  it("pedido pago entre escolha e cadastro exige reidentificar, sem gravar ficha", async () => {
    const f = fixture(); await f.request({ action: "identify", selected_order_id: "y" }); f.tables.orders[1].is_paid = true; f.writes.length = 0;
    const { status } = await f.request({ action: "register", access_id: accessId, selected_order_id: "y", order_ids: ["y"], details });
    expect(status).toBe(409); expect(f.writes).toEqual([]);
  });
  it("telefone parcial de quatro dígitos é preenchido sem mexer no @", async () => {
    const f = fixture(["x"]); f.tables.customers[0].whatsapp = "4550";
    await f.request({ action: "identify" });
    await f.request({ action: "register", access_id: accessId, selected_order_id: "x", order_ids: ["x"], details });
    expect(f.tables.customers[0]).toMatchObject({ whatsapp: phone, instagram_handle: "pessoa_x" });
  });
  it("falha na leitura não associa pedido nem grava dados", async () => {
    const f = fixture(); f.fail(); const { status } = await f.request({ action: "identify" });
    expect(status).toBe(500); expect(f.writes).toEqual([]); expect(f.rpc).not.toHaveBeenCalledWith("selfservice_capture_initial", expect.anything());
  });
  it("consulta candidatos por evento/final em lote, sem consulta por pedido", async () => {
    const f = fixture(); await f.request({ action: "identify" });
    const reads = f.queries.filter((q) => q.table === "orders");
    expect(reads).toHaveLength(1);
    expect(reads[0].filters).toContainEqual(["eq", "event_id", eventId]);
    expect(reads[0].filters).toContainEqual(["eq", "phone_last4", "4550"]);
    expect(f.queries.filter((q) => q.filters.some((r) => r[0] === "overlaps"))).toHaveLength(1);
  });
});