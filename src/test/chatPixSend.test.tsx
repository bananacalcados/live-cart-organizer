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

describe("envio do Pix pelo diálogo", () => {
  it("o clique em enviar entrega e registra o mesmo código sem botão nativo", async () => {
    invoke.mockResolvedValue({ data: { qrCode: code, amount: 341.99 }, error: null });
    const sendText = vi.fn().mockResolvedValue("message-id");
    const sendCopyButton = vi.fn();
    const persist = vi.fn().mockResolvedValue(undefined);
    const onSent = vi.fn();
    render(<ChatPixButton orderId="teste-isolado" variant="button" onSent={onSent} channel={{
      provider: "uazapi", sendText, sendCopyButton, persist, sendImage: vi.fn(),
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "PIX", exact: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar PIX na conversa" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenLastCalledWith(code);
    expect(persist).toHaveBeenLastCalledWith({ message: code, message_id: "message-id" });
    expect(sendCopyButton).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});