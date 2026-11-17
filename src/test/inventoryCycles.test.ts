import { describe, expect, it, vi } from "vitest";
import {
  buildInventoryCsv,
  fetchAllInventoryReport,
  runInventoryZero,
  type InventoryReportRow,
  type ZeroUnprintedParams,
  type ZeroUnprintedResult,
} from "@/components/inventory/inventoryCycleUtils";

const zeroResponse = (changed: number, remaining: number) => ({
  data: { changed, remaining } satisfies ZeroUnprintedResult,
  error: null,
});

const reportRow = (id: number, total = 1001): InventoryReportRow => ({
  pos_product_id: String(id), variant_id: null, master_id: null,
  product_name: `Produto ${id}`, code: `C-${id}`, color: "Preto", size: "38",
  sku: `SKU-${id}`, barcode: `789${id}`, stock: 2, status: "nao_impresso",
  labels: 0, last_batch_numero: null, last_batch_at: null, last_mode: null, total_count: total,
});

describe("zeramento do inventário", () => {
  it("faz uma chamada por vez, no máximo 100 itens, com pausa de 1,5 segundo", async () => {
    const replies = [zeroResponse(100, 150), zeroResponse(100, 50), zeroResponse(50, 0)];
    let active = 0;
    let maxActive = 0;
    const rpc = vi.fn(async (_params: ZeroUnprintedParams) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return replies.shift()!;
    });
    const pause = vi.fn(async () => {});
    const progress = vi.fn();

    const result = await runInventoryZero({
      cycleId: "cycle-1", userName: "Matthews", total: 250, rpc, pause,
      shouldStop: () => false, onProgress: progress,
    });

    expect(result).toMatchObject({ done: 250, remaining: 0, calls: 3, error: null });
    expect(maxActive).toBe(1);
    expect(rpc.mock.calls.every(([params]) => params.p_max === 100 && params.p_confirm === "ZERAR")).toBe(true);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(1500);
    expect(progress).toHaveBeenLastCalledWith({ done: 250, total: 250, remaining: 0 });
  });

  it("para quando changed é zero para não entrar em laço infinito", async () => {
    const rpc = vi.fn(async () => zeroResponse(0, 40));
    const result = await runInventoryZero({
      cycleId: "cycle-1", total: 40, rpc, shouldStop: () => false, pause: async () => {},
    });
    expect(result).toMatchObject({ calls: 1, noProgress: true, done: 0, remaining: 40 });
  });

  it("o botão Parar impede a chamada seguinte", async () => {
    let stop = false;
    const rpc = vi.fn(async () => {
      stop = true;
      return zeroResponse(100, 100);
    });
    const pause = vi.fn(async () => {});
    const result = await runInventoryZero({
      cycleId: "cycle-1", total: 200, rpc, shouldStop: () => stop, pause,
    });
    expect(result).toMatchObject({ calls: 1, done: 100, remaining: 100, stopped: true });
    expect(pause).not.toHaveBeenCalled();
  });

  it("para no primeiro erro e conserva o quanto já foi feito", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(zeroResponse(100, 80))
      .mockResolvedValueOnce({ data: null, error: { message: "Zeramento ainda bloqueado" } });
    const result = await runInventoryZero({
      cycleId: "cycle-1", total: 180, rpc, shouldStop: () => false, pause: async () => {},
    });
    expect(result).toMatchObject({ calls: 2, done: 100, remaining: 80, error: "Zeramento ainda bloqueado" });
  });
});

describe("relatório do inventário", () => {
  it("exporta em páginas de 500 até o total informado pelo banco", async () => {
    const pages = [
      Array.from({ length: 500 }, (_, index) => reportRow(index)),
      Array.from({ length: 500 }, (_, index) => reportRow(index + 500)),
      [reportRow(1000)],
    ];
    const fetchPage = vi.fn(async (_limit: number, _offset: number) => pages.shift() || []);
    const rows = await fetchAllInventoryReport(fetchPage);
    expect(rows).toHaveLength(1001);
    expect(fetchPage.mock.calls.map(([limit, offset]) => [limit, offset])).toEqual([[500, 0], [500, 500], [500, 1000]]);
  });

  it("gera CSV com BOM, ponto e vírgula e campos escapados", () => {
    const row = { ...reportRow(1, 1), product_name: 'Tênis "Azul"; Couro', last_batch_numero: 9, last_batch_at: "2026-11-17T12:00:00Z" };
    const csv = buildInventoryCsv([row], () => "17/11/2026 09:00");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Tênis ""Azul""; Couro"');
    expect(csv).toContain('"Não contado";"0";"#9";"17/11/2026 09:00"');
  });
});
