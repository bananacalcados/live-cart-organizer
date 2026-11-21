import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresenterAvailablePairs } from "@/hooks/usePresenterAvailablePairs";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
const data = [{ code: "X", sizes: [{ size: "36", total_stock: 5, pending_pairs: 4, available_pairs: 1 }] }];
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data, error: null });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("leitura visual de pares", () => {
  it("faz uma chamada por evento, não por numeração, e preserva referência sem mudança", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePresenterAvailablePairs("event", true));
    await act(async () => {});
    expect(result.current).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("live_presenter_available_pairs", { p_event_id: "event", p_limit: 200, p_offset: 0 });
    const previous = result.current;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(previous);
  });
  it("não repete antes de 30 segundos, pausa oculta e atualiza ao voltar", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePresenterAvailablePairs("event", true));
    await act(async () => {});
    expect(result.current).toEqual(data);
    await act(async () => { vi.advanceTimersByTime(29_999); });
    expect(rpc).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => { vi.advanceTimersByTime(30_001); });
    expect(rpc).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    rpc.mockResolvedValue({ data: [{ code: "X", sizes: [{ size: "36", total_stock: 4, pending_pairs: 4, available_pairs: 0 }] }], error: null });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(result.current[0].sizes[0].available_pairs).toBe(0);
  });
  it("outras telas não fazem nenhuma consulta nova", () => {
    renderHook(() => usePresenterAvailablePairs("event", false));
    expect(rpc).not.toHaveBeenCalled();
  });
  it("falha não inventa saldo zero nem bloqueia o painel", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    const { result } = renderHook(() => usePresenterAvailablePairs("event", true));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual([]);
  });
});