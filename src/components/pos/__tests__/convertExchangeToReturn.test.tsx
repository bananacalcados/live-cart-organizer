import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
const toastOk = vi.fn(); const toastErr = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastOk(m), error: (m: string) => toastErr(m) } }));

import { ConvertExchangeToReturnDialog } from "../ConvertExchangeToReturnDialog";
import { canConvertToReturn } from "@/lib/pos/exchangeInProgress";

describe("canConvertToReturn", () => {
  it("só troca aberta sem voucher/estorno", () => {
    expect(canConvertToReturn({ tipo: "troca", status: "aguardando_retorno" })).toBe(true);
    expect(canConvertToReturn({ tipo: "troca", status: "recebido_conferencia" })).toBe(true);
    expect(canConvertToReturn({ tipo: "devolucao", status: "aguardando_retorno" })).toBe(false);
    expect(canConvertToReturn({ tipo: "troca", status: "aguardando_envio" })).toBe(false);
    expect(canConvertToReturn({ tipo: "troca", status: "concluida" })).toBe(false);
    expect(canConvertToReturn({ tipo: "troca", status: "iniciada", voucher_id: "v" })).toBe(false);
    expect(canConvertToReturn({ tipo: "troca", status: "iniciada", gateway_refund_id: "g" })).toBe(false);
  });
});

describe("ConvertExchangeToReturnDialog", () => {
  beforeEach(() => { rpc.mockReset(); toastOk.mockReset(); toastErr.mockReset(); });
  const troca = { id: "t-1", codigo_devolucao: "TD-2026-000216" };

  it("confirma com id e observação, avisa e recarrega", async () => {
    rpc.mockResolvedValue({ data: { codigo: "TD-2026-000216" }, error: null });
    const onClose = vi.fn(); const onDone = vi.fn();
    render(<ConvertExchangeToReturnDialog troca={troca} onClose={onClose} onDone={onDone} />);
    expect(screen.getByText("Converter a troca TD-2026-000216 em devolução?")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Observação"), { target: { value: "quer o dinheiro" } });
    fireEvent.click(screen.getByRole("button", { name: /Converter em devolução/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("exchange_convert_to_return", { p_troca_id: "t-1", p_motivo: "quer o dinheiro" });
    expect(toastOk).toHaveBeenCalledWith("TD-2026-000216 agora é uma devolução.");
    expect(onClose).toHaveBeenCalled();
  });

  it("observação vazia vai como null", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ConvertExchangeToReturnDialog troca={troca} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Converter em devolução/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("exchange_convert_to_return", { p_troca_id: "t-1", p_motivo: null }));
  });

  it("erro mostra a mensagem do banco e não fecha nem recarrega", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "A diferença já foi paga" } });
    const onClose = vi.fn(); const onDone = vi.fn();
    render(<ConvertExchangeToReturnDialog troca={troca} onClose={onClose} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /Converter em devolução/ }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("A diferença já foi paga"));
    expect(onClose).not.toHaveBeenCalled(); expect(onDone).not.toHaveBeenCalled();
  });
});
