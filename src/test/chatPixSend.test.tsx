import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPixButton } from "@/components/ChatPixButton";

const { invoke, code } = vi.hoisted(() => ({
  code: "00020101021226800014br.gov.bcb.pix2560pix.exemplo.test/cobranca5204000053039865406341.995802BR6304ABCD",
  invoke: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    functions: { invoke },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeChannel() {
  return {
    provider: "uazapi",
    sendText: vi.fn().mockResolvedValue("message-id"),
    sendCopyButton: vi.fn().mockResolvedValue("button-id"),
    persist: vi.fn().mockResolvedValue(undefined),
    sendImage: vi.fn(),
  };
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /^PIX$/ }));
  return screen.findByRole("button", { name: "Enviar PIX na conversa" });
}

describe("envio do Pix pelo diálogo", () => {
  it("por padrão envia com o botão Copiar, sem duplicar o código no chat", async () => {
    invoke.mockResolvedValue({ data: { qrCode: code, amount: 341.99 }, error: null });
    const channel = makeChannel();
    const onSent = vi.fn();
    render(<ChatPixButton orderId="teste-botao" variant="button" onSent={onSent} channel={channel} />);
    fireEvent.click(await openDialog());
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(channel.sendCopyButton).toHaveBeenCalledTimes(1);
    expect(channel.sendCopyButton.mock.calls[0][2]).toBe(code);
    expect(channel.sendText).not.toHaveBeenCalled();
    const persisted = channel.persist.mock.calls[0][0];
    expect(persisted.message).toContain("[Botão: Copiar código PIX]");
    expect(persisted.message).toContain(`[PIX_CODE:${code}]`);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("desligando a chave, envia o código isolado sem botão", async () => {
    invoke.mockResolvedValue({ data: { qrCode: code, amount: 341.99 }, error: null });
    const channel = makeChannel();
    const onSent = vi.fn();
    render(<ChatPixButton orderId="teste-sem-botao" variant="button" onSent={onSent} channel={channel} />);
    const sendBtn = await openDialog();
    fireEvent.click(screen.getByRole("switch", { name: /botão "Copiar código PIX"/i }));
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(channel.sendCopyButton).not.toHaveBeenCalled();
    expect(channel.sendText).toHaveBeenCalledTimes(2);
    expect(channel.sendText).toHaveBeenLastCalledWith(code);
    expect(channel.persist).toHaveBeenLastCalledWith({ message: code, message_id: "message-id" });
  });
});
