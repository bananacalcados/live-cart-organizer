// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { rpc, from, invoke, toast } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), invoke: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpc(...args), from: (...args: any[]) => from(...args),
    functions: { invoke: (...args: any[]) => invoke(...args) }, channel: () => channel,
    removeChannel: vi.fn(), auth: { getUser: async () => ({ data: { user: { id: "tester" } } }) },
  },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/pos/expedition/ExpShippingFields", () => ({ ExpShippingFields: () => null }));
vi.mock("@/components/pos/expedition/ExpFreightQuotePanel", () => ({ ExpFreightQuotePanel: () => null }));
vi.mock("@/components/pos/expedition/ExpCorreiosShipmentPanel", () => ({ ExpCorreiosShipmentPanel: () => null }));
vi.mock("@/components/pos/expedition/ExpOrderEditDialog", () => ({ ExpOrderEditDialog: () => null }));
vi.mock("@/components/pos/expedition/ExpTrackingTemplateEditor", () => ({ ExpTrackingTemplateEditor: () => null }));
vi.mock("@/components/expedition/ExpeditionBarcodeScanner", () => ({ ExpeditionBarcodeScanner: () => null }));
vi.mock("@/components/expedition/StockCheckRequestDialog", () => ({ StockCheckRequestDialog: () => null }));
vi.mock("@/components/fiscal/EmitNfeButton", () => ({ EmitNfeButton: () => null }));
vi.mock("@/lib/shipmentTracking", () => ({
  getPublicTrackingCode: async () => null, attachRealTracking: async () => undefined,
  publicTrackingUrl: (code: string) => `/rastreio/${code}`,
}));

import { ExpConferenceDialog } from "@/components/pos/expedition/ExpConferenceDialog";
import { ExpeditionPickingList } from "@/components/expedition/ExpeditionPickingList";
import { BetaPickingList } from "@/components/expedition-beta/BetaPickingList";
import { ExpeditionPackingStation } from "@/components/expedition/ExpeditionPackingStation";
import { BetaPackingStation } from "@/components/expedition-beta/BetaPackingStation";

const resolved = {
  variant_id: "v1", code: "T101-37", variant_sku: "VSKU37", variant_gtin: "7890000000017",
  color: "Preto", size: "37", master_name: "Tênis", pos_product_id: "p1", tiny_id: 10,
  product_name: "Tênis", product_variant: "Preto / 37", product_sku: "SKU37",
  product_barcode: "7891234567895", stock: 2,
};
let scanEntries: any[];
let scanInsert: (entry: any) => any;

function query(data: any = []) {
  const q: any = {};
  for (const method of ["select", "eq", "in", "not", "or", "order", "limit", "delete", "update", "gt", "gte", "lte", "ilike"]) q[method] = () => q;
  q.insert = () => q;
  q.maybeSingle = async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null });
  q.single = q.maybeSingle;
  q.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return q;
}

beforeEach(() => {
  vi.restoreAllMocks();
  channel.on.mockReturnThis();
  channel.subscribe.mockReturnThis();
  scanEntries = [];
  scanInsert = (entry) => { scanEntries.push(entry); return Promise.resolve({ error: null }); };
  rpc.mockReset(); from.mockReset(); invoke.mockReset();
  Object.values(toast).forEach(fn => fn.mockReset());
  from.mockImplementation((table: string) => {
    if (table === "expedition_scan_log") return { insert: scanInsert };
    if (table === "expedition_order_items" || table === "expedition_beta_order_items") {
      return query({ picked_quantity: 0, quantity: 1 });
    }
    return query([]);
  });
});
afterEach(cleanup);

const posItem = (quantity = 1) => ({
  id: "i1", sale_id: "sale1", product_name: "Tênis Teste", variant_name: "Preto / 37", size: "37",
  sku: "SKU37", barcode: "7891234567895", quantity, unit_price: 100,
});
const posOrder = (quantity = 1) => ({
  id: "sale1", store_id: "store1", customer_name: "Cliente Teste", items: [posItem(quantity)],
  shipping_address: {}, shipping_cost: 0, total: 100,
});
const renderPos = (quantity = 1) => render(<ExpConferenceDialog order={posOrder(quantity) as any} storeId="store1" open onOpenChange={vi.fn()} onFinished={vi.fn()} />);
async function scan(input: HTMLElement, code: string) {
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("PDV — conferência", () => {
  it("código antigo registra o texto original e a linha inteira com quantidade 2", async () => {
    renderPos(2);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), " 7891234567895 ");
    expect(await screen.findByText("BIPADO")).toBeInTheDocument();
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ flow: "pos", stage: "conferencia", method: "codigo_antigo", code_read: " 7891234567895 ", quantity: 2, sale_id: "sale1", sale_item_id: "i1", store_id: "store1" });
  });

  it("etiqueta nova registra variação resolvida", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    renderPos();
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "T101-37");
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ method: "etiqueta_nova", code_read: "T101-37", variant_code: "T101-37", variant_id: "v1", quantity: 1 });
  });

  it("marcar manual registra manual e código nulo", async () => {
    renderPos(2);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar manual" }));
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ method: "manual", code_read: null, quantity: 2 });
  });

  it("vincular e bipar registra somente depois do vínculo", async () => {
    renderPos();
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "9999");
    expect(await screen.findByText(/Vincular código 9999/)).toBeInTheDocument();
    expect(scanEntries).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "VINCULAR E BIPAR" }));
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ method: "vincular", code_read: "9999", barcode: "9999", quantity: 1 });
  });

  it("rejeição do insert mantém o item bipado e não mostra erro", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    scanInsert = (entry) => { scanEntries.push(entry); return Promise.reject(new Error("offline")); };
    renderPos();
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "7891234567895");
    expect(await screen.findByText("BIPADO")).toBeInTheDocument();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});

const order = (beta = false) => ({
  id: "order1", shopify_order_name: "#1001", customer_name: "Cliente Teste", shipping_method: "SEDEX",
  expedition_status: "picked",
  [beta ? "expedition_beta_order_items" : "expedition_order_items"]: [{
    id: "line1", product_name: "Tênis Teste", variant_name: "Preto / 37", sku: "SKU37",
    barcode: "7891234567895", quantity: 1, picked_quantity: 0, pick_verified: false,
  }],
});

async function confirmQuality(name: RegExp) {
  const checks = await screen.findAllByRole("checkbox");
  fireEvent.click(checks[0]); fireEvent.click(checks[1]);
  const button = screen.getByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(scanEntries).toHaveLength(1));
}

describe("separação clássica e Beta", () => {
  it.each([
    { name: "clássica", Component: ExpeditionPickingList, beta: false, placeholder: "Bipe o código de barras ou SKU...", confirm: /Confirmar Produto/, flow: "classica" },
    { name: "Beta", Component: BetaPickingList, beta: true, placeholder: "Bipe ou digite o código...", confirm: /^Confirmar$/, flow: "beta" },
  ])("$name registra código antigo e etiqueta nova", async ({ Component, beta, placeholder, confirm, flow }) => {
    const { unmount } = render(<Component orders={[order(beta)]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText(placeholder), "7891234567895");
    await confirmQuality(confirm);
    expect(scanEntries[0]).toMatchObject({ flow, stage: "separacao", method: "codigo_antigo", code_read: "7891234567895", quantity: 1, expedition_order_id: "order1", expedition_order_item_id: "line1" });
    unmount(); scanEntries = []; rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<Component orders={[order(beta)]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText(placeholder), "T101-37");
    await confirmQuality(confirm);
    expect(scanEntries[0]).toMatchObject({ flow, stage: "separacao", method: "etiqueta_nova", code_read: "T101-37", variant_code: "T101-37", variant_id: "v1" });
  });

  it("separação clássica registra confirmação manual", async () => {
    render(<ExpeditionPickingList orders={[order()]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByTitle("Conferir manualmente (sem bipar)"));
    await confirmQuality(/Confirmar Produto/);
    expect(scanEntries[0]).toMatchObject({ flow: "classica", stage: "separacao", method: "manual", code_read: null, quantity: 1 });
  });

  it("separação Beta registra confirmação manual", async () => {
    render(<BetaPickingList orders={[order(true)]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    const handButton = Array.from(document.querySelectorAll("button")).find(b => b.querySelector("svg.lucide-hand"));
    expect(handButton).toBeDefined();
    fireEvent.click(handButton!);
    fireEvent.change(await screen.findByPlaceholderText("Buscar produto..."), { target: { value: "Tênis" } });
    fireEvent.click(screen.getByRole("button", { name: /Tênis Teste/ }));
    await confirmQuality(/^Confirmar$/);
    expect(scanEntries[0]).toMatchObject({ flow: "beta", stage: "separacao", method: "manual", code_read: null, quantity: 1 });
  });
});

describe("embalagem clássica e Beta", () => {
  it.each([
    { name: "clássica", Component: ExpeditionPackingStation, beta: false, placeholder: "Bipe ou digite o código de barras...", flow: "classica" },
    { name: "Beta", Component: BetaPackingStation, beta: true, placeholder: "Bipe o código de barras...", flow: "beta" },
  ])("$name registra código antigo e etiqueta nova", async ({ Component, beta, placeholder, flow }) => {
    const { unmount } = render(<Component orders={[order(beta)]} searchTerm="" onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByText(beta ? "Cliente Teste" : "#1001"));
    await scan(await screen.findByPlaceholderText(placeholder), "7891234567895");
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ flow, stage: "embalagem", method: "codigo_antigo", code_read: "7891234567895", quantity: 1, expedition_order_id: "order1", expedition_order_item_id: "line1" });
    unmount(); scanEntries = []; rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<Component orders={[order(beta)]} searchTerm="" onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByText(beta ? "Cliente Teste" : "#1001"));
    await scan(await screen.findByPlaceholderText(placeholder), "T101-37");
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ flow, stage: "embalagem", method: "etiqueta_nova", code_read: "T101-37", variant_code: "T101-37", variant_id: "v1" });
  });

  it("embalagem clássica registra confirmação manual", async () => {
    render(<ExpeditionPackingStation orders={[order()]} searchTerm="" onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByText("#1001"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(scanEntries).toHaveLength(1));
    expect(scanEntries[0]).toMatchObject({ flow: "classica", stage: "embalagem", method: "manual", code_read: null, quantity: 1 });
  });
});

describe("código sem correspondência", () => {
  it("não registra na separação nem na embalagem", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { unmount } = render(<ExpeditionPickingList orders={[order()]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras ou SKU..."), "T101-37");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Produto não encontrado: T101-37"));
    expect(scanEntries).toHaveLength(0);
    unmount();
    render(<BetaPackingStation orders={[order(true)]} searchTerm="" onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByText("Cliente Teste"));
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "T101-37");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Código não encontrado: T101-37"));
    expect(scanEntries).toHaveLength(0);
  });
});
