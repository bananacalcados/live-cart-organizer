import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveScannedCode } from "./mobileCycleApi";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

beforeEach(() => vi.clearAllMocks());

describe("reconhecimento de código no balanço mobile", () => {
  it("usa a mesma consulta da busca inicial e preserva a variação", async () => {
    rpc.mockResolvedValue({ data: [{
      master_id: "master-1", variant_id: "variant-1", code: "T176-37", color: "Bege", size: "37",
      master_name: "New Balance 9060", sku_root: "100248", matched_by: "etiqueta_interna",
    }], error: null });
    await expect(resolveScannedCode(" t176-37 ", "store-1")).resolves.toEqual({
      variant_id: "variant-1", master_id: "master-1", name: "New Balance 9060", color: "Bege", size: "37", code: "T176-37",
    });
    expect(rpc).toHaveBeenCalledWith("mobile_resolve_product_code", { p_code: "t176-37" });
  });

  it("não permite contar o pai inteiro quando o código não identifica uma variação", async () => {
    rpc.mockResolvedValue({ data: [{
      master_id: "master-1", variant_id: null, code: "100248", color: null, size: null,
      master_name: "New Balance 9060", sku_root: "100248", matched_by: "sku_pai",
    }], error: null });
    await expect(resolveScannedCode("100248", "store-1")).resolves.toBeNull();
  });
});
