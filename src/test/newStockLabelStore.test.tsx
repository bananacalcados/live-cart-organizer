// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { rpc, from, invoke, toast } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), invoke: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpc(...args),
    from: (...args: any[]) => from(...args),
    functions: { invoke: (...args: any[]) => invoke(...args) },
  },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/pos/POSBarcodeScanner", () => ({ POSBarcodeScanner: () => null }));

import POSStockTransfer from "@/components/pos/transfer/POSStockTransfer";
import { POSTinyProductPicker } from "@/components/pos/POSTinyProductPicker";
import { GradeStockEntryDialog } from "@/components/inventory/GradeStockEntryDialog";

const resolved = {
  variant_id: "v1", code: "T101-37", variant_sku: "VSKU37", variant_gtin: "7890000000017",
  color: "Preto", size: "37", master_name: "Tênis Teste", pos_product_id: "p1", tiny_id: 10,
  product_name: "Tênis Teste", product_variant: "Preto / 37", product_sku: "SKU37",
  product_barcode: "7891234567895", stock: 2,
};
const product = {
  id: "p1", tiny_id: 10, name: "Tênis Teste", sku: "SKU37", barcode: "7891234567895",
  size: "37", color: "Preto", variant: "Preto / 37", category: null, price: 100,
  stock: 2, dest_stock: 0, image_url: null, parent_sku: "T101",
};

function query(data: any = []) {
  const q: any = {};
  for (const method of ["select", "eq", "in", "not", "or", "order", "limit", "delete", "insert", "update", "ilike"]) q[method] = () => q;
  q.maybeSingle = async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null });
  q.single = q.maybeSingle;
  q.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return q;
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset(); from.mockReset(); invoke.mockReset();
  from.mockImplementation(() => query([]));
  Object.values(toast).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("transferência entre lojas", () => {
  it("etiqueta nova refaz a busca atual pelo EAN e adiciona o produto", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    invoke.mockImplementation(async (_name, { body }: any) => ({
      data: body.code === "T101-37"
        ? { ok: true, products: [] }
        : { ok: true, mode: "code", products: [product] },
      error: null,
    }));
    render(<POSStockTransfer storeId="4ade7b44-5043-4ab1-a124-7a6ab5468e29" />);
    const input = await screen.findByLabelText("Bipe o código de barras");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "T101-37" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByTestId("transfer-line")).toHaveTextContent("Tênis Teste");
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29" });
    expect(invoke.mock.calls.map((c) => c[1].body.code)).toEqual(["T101-37", "7891234567895"]);
  });

  it("erro na consulta mantém o aviso atual e não trava", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    invoke.mockResolvedValue({ data: { ok: true, products: [] }, error: null });
    render(<POSStockTransfer storeId="4ade7b44-5043-4ab1-a124-7a6ab5468e29" />);
    const input = await screen.findByLabelText("Bipe o código de barras");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "T101-37" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Produto não encontrado no estoque da Loja Centro"));
    expect(input).toBeEnabled();
  });

  it("sem cadastro na loja de origem mostra o aviso e não adiciona", async () => {
    rpc.mockResolvedValue({ data: [{ ...resolved, pos_product_id: null, product_barcode: null, product_sku: null }], error: null });
    invoke.mockResolvedValue({ data: { ok: true, products: [] }, error: null });
    render(<POSStockTransfer storeId="4ade7b44-5043-4ab1-a124-7a6ab5468e29" />);
    const input = await screen.findByLabelText("Bipe o código de barras");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "T101-37" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("T101-37 existe, mas não tem cadastro de estoque nesta loja"));
    expect(screen.queryByTestId("transfer-line")).not.toBeInTheDocument();
  });
});

describe("seletor de produto das trocas", () => {
  it("POSTinyProductPicker encontra pela etiqueta nova e devolve o produto para POSExchanges", async () => {
    rpc.mockImplementation(async (name: string) => name === "resolve_stock_code"
      ? { data: [resolved], error: null }
      : { data: [], error: null });
    from.mockImplementation((table: string) => query(table === "pos_products" ? [product] : []));
    const onSelect = vi.fn();
    render(<POSTinyProductPicker storeId="store1" label="Novo" value="" onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText("Buscar produto..."), { target: { value: "T101-37" } });
    const option = await screen.findByRole("button", { name: /Tênis Teste/ }, { timeout: 2500 });
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sku: "SKU37", barcode: "7891234567895", product_name: "Tênis Teste - Preto / 37" }));
  });

  it("sem cadastro na loja mostra o mesmo aviso e não seleciona", async () => {
    rpc.mockImplementation(async (name: string) => name === "resolve_stock_code"
      ? { data: [{ ...resolved, pos_product_id: null, product_barcode: null, product_sku: null }], error: null }
      : { data: [], error: null });
    const onSelect = vi.fn();
    render(<POSTinyProductPicker storeId="store1" value="" onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText("Buscar produto..."), { target: { value: "T101-37" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("T101-37 existe, mas não tem cadastro de estoque nesta loja"), { timeout: 2500 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("EAN comum não chama a consulta da etiqueta nova", async () => {
    from.mockImplementation(() => query([product]));
    render(<POSTinyProductPicker storeId="store1" value="" onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Buscar produto..."), { target: { value: "7891234567895" } });
    expect(await screen.findByRole("button", { name: /Tênis Teste/ }, { timeout: 2500 })).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith("resolve_stock_code", expect.anything());
  });

  it("erro na consulta mantém o resultado vazio sem travar", async () => {
    rpc.mockImplementation(async (name: string) => name === "resolve_stock_code"
      ? { data: null, error: { message: "offline" } }
      : { data: [], error: null });
    render(<POSTinyProductPicker storeId="store1" value="" onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText("Buscar produto...");
    fireEvent.change(input, { target: { value: "T101-37" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "store1" }), { timeout: 2500 });
    await waitFor(() => expect(document.querySelector(".animate-spin")).not.toBeInTheDocument());
    expect(input).toBeEnabled();
  });
});

describe("entrada por grade", () => {
  it("etiqueta nova localiza a grade pelo caminho atual do EAN", async () => {
    rpc.mockResolvedValue({ data: [resolved], error: null });
    let productSearch = 0;
    from.mockImplementation((table: string) => {
      if (table === "pos_stores") return query([{ id: "store1", name: "Loja Teste" }]);
      if (table === "pos_products") {
        productSearch++;
        return query(productSearch === 1 ? [] : [{ parent_sku: "T101", name: "Tênis Teste - Preto / 37" }]);
      }
      return query([]);
    });
    render(<GradeStockEntryDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText("Nome, código ou código de barras"), { target: { value: "T101-37" } });
    expect(await screen.findByRole("button", { name: /Tênis Teste T101/ }, { timeout: 2500 })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "store1" });
    expect(productSearch).toBe(2);
  });

  it("erro na consulta não trava a busca de grade", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    let productSearch = 0;
    from.mockImplementation((table: string) => {
      if (table === "pos_stores") return query([{ id: "store1", name: "Loja Teste" }]);
      if (table === "pos_products") { productSearch++; return query([]); }
      return query([]);
    });
    render(<GradeStockEntryDialog open onOpenChange={vi.fn()} />);
    const input = await screen.findByPlaceholderText("Nome, código ou código de barras");
    fireEvent.change(input, { target: { value: "T101-37" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "store1" }), { timeout: 2500 });
    await waitFor(() => expect(document.querySelector(".animate-spin")).not.toBeInTheDocument());
    expect(input).toBeEnabled();
    expect(productSearch).toBe(1);
  });
});
