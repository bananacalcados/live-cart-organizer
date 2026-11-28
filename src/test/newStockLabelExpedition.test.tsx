// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as baseRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["product_color_photos_mode_raw"], "off");
  return baseRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const { rpc, from, invoke, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  invoke: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpc(...args),
    from: (...args: any[]) => from(...args),
    functions: { invoke: (...args: any[]) => invoke(...args) },
    channel: () => channel,
    removeChannel: vi.fn(),
    auth: { getUser: async () => ({ data: { user: { id: "tester" } } }) },
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
  getPublicTrackingCode: async () => null,
  attachRealTracking: async () => undefined,
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

function query(data: any = []) {
  const q: any = {};
  for (const method of ["select", "eq", "in", "not", "or", "order", "limit", "delete", "insert", "update", "gt", "gte", "lte", "ilike"]) {
    q[method] = () => q;
  }
  q.maybeSingle = async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null });
  q.single = q.maybeSingle;
  q.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return q;
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => query([]));
  invoke.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

const item = (id = "i1", barcode = "7891234567895") => ({
  id, sale_id: "sale1", product_name: "Tênis Teste", variant_name: "Preto / 37", size: "37",
  sku: "SKU37", barcode, quantity: 1, unit_price: 100,
});
const conferenceOrder = (items: any[]) => ({
  id: "sale1", store_id: "store1", customer_name: "Cliente Teste", items,
  shipping_address: {}, shipping_cost: 0, total: 100,
});

async function scan(input: HTMLElement, code: string) {
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("conferência da Expedição do PDV", () => {
  it("etiqueta nova confere o item certo e EAN comum não chama a RPC", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    const { unmount } = render(<ExpConferenceDialog order={conferenceOrder([item()]) as any} storeId="store1" open onOpenChange={vi.fn()} onFinished={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "T101-37");
    expect(await screen.findByText("BIPADO")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "store1" });
    unmount();
    rpc.mockClear();

    render(<ExpConferenceDialog order={conferenceOrder([item()]) as any} storeId="store1" open onOpenChange={vi.fn()} onFinished={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "7891234567895");
    expect(await screen.findByText("BIPADO")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("duas unidades em duas linhas contam duas bipagens", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<ExpConferenceDialog order={conferenceOrder([item("i1"), item("i2")]) as any} storeId="store1" open onOpenChange={vi.fn()} onFinished={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Bipe o código de barras...");
    await scan(input, "T101-37");
    await waitFor(() => expect(screen.getAllByText("BIPADO")).toHaveLength(1));
    await scan(input, "T101-37");
    await waitFor(() => expect(screen.getAllByText("BIPADO")).toHaveLength(2));
  });

  it("item fora do pedido segue o aviso atual", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<ExpConferenceDialog order={conferenceOrder([{ ...item("i1", "OUTRO"), sku: "OUTRO" }]) as any} storeId="store1" open onOpenChange={vi.fn()} onFinished={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras..."), "T101-37");
    expect(await screen.findByText(/Vincular código T101-37/)).toBeInTheDocument();
  });

  it("código inexistente e erro na RPC não travam a conferência", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    render(<ExpConferenceDialog order={conferenceOrder([item()]) as any} storeId="store1" open onOpenChange={vi.fn()} onFinished={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Bipe o código de barras...");
    await scan(input, "T101-37");
    expect(await screen.findByText(/Vincular código T101-37/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await scan(input, "T101-37");
    expect(await screen.findByText(/Vincular código T101-37/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining("offline"));
  });
});

const pickingOrder = (beta = false) => ({
  id: "order1", shopify_order_name: "#1001", customer_name: "Cliente Teste", shipping_method: "SEDEX",
  expedition_status: "picked",
  [beta ? "expedition_beta_order_items" : "expedition_order_items"]: [{
    id: "line1", product_name: "Tênis Teste", variant_name: "Preto / 37", sku: "SKU37",
    barcode: "7891234567895", quantity: 1, picked_quantity: 0, pick_verified: false,
  }],
});

describe("separação", () => {
  it("ExpeditionPickingList aceita a etiqueta nova", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<ExpeditionPickingList orders={[pickingOrder()] } searchTerm="" showChecking onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras ou SKU..."), "T101-37");
    expect(await screen.findByText("Verificação de Qualidade")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: null });
  });

  it("BetaPickingList aceita a etiqueta nova", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<BetaPickingList orders={[pickingOrder(true)]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe ou digite o código..."), "T101-37");
    expect(await screen.findByRole("button", { name: "Confirmar" })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: null });
  });
});

describe("falha da consulta na separação", () => {
  it("ExpeditionPickingList mantém o aviso atual e não trava", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    render(<ExpeditionPickingList orders={[pickingOrder()]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Bipe o código de barras ou SKU...");
    await scan(input, "T101-37");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Produto não encontrado: T101-37"));
    expect(input).toBeEnabled();
  });

  it("BetaPickingList mantém o aviso atual e não trava", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    render(<BetaPickingList orders={[pickingOrder(true)]} searchTerm="" showChecking onRefresh={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Bipe ou digite o código...");
    await scan(input, "T101-37");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Produto não encontrado: T101-37"));
    expect(input).toBeEnabled();
  });
});

describe("embalagem", () => {
  it("ExpeditionPackingStation localiza o pedido e bipa o item pela etiqueta nova", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<ExpeditionPackingStation orders={[pickingOrder()]} searchTerm="" onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe ou digite o código de barras do produto..."), "T101-37");
    expect(await screen.findByText("Conferência: #1001")).toBeInTheDocument();
    await scan(screen.getByPlaceholderText("Bipe ou digite o código de barras..."), "T101-37");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("✓ Tênis Teste (1/1)"));
  });

  it("BetaPackingStation localiza o pedido e bipa o item pela etiqueta nova", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    render(<BetaPackingStation orders={[pickingOrder(true)]} searchTerm="" onRefresh={vi.fn()} />);
    await scan(await screen.findByPlaceholderText("Bipe o código de barras do produto..."), "T101-37");
    expect(await screen.findByText("Bipar itens do pedido")).toBeInTheDocument();
    await scan(screen.getByPlaceholderText("Bipe o código de barras..."), "T101-37");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("✓ Tênis Teste (1/1)"));
  });

  it("ExpeditionPackingStation não trava quando a consulta falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    render(<ExpeditionPackingStation orders={[pickingOrder()]} searchTerm="" onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByText("#1001"));
    const input = await screen.findByPlaceholderText("Bipe ou digite o código de barras...");
    await scan(input, "T101-37");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Código não encontrado nestes pedidos: T101-37"));
    expect(input).toBeEnabled();
  });

  it("BetaPackingStation não trava quando a consulta falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    render(<BetaPackingStation orders={[pickingOrder(true)]} searchTerm="" onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByText("Cliente Teste"));
    const input = await screen.findByPlaceholderText("Bipe o código de barras...");
    await scan(input, "T101-37");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Código não encontrado: T101-37"));
    expect(input).toBeEnabled();
  });
});
