import { describe, expect, it, vi } from "vitest";
import { sendPixMessages, type PixSendChannel } from "@/lib/pix/sendPixMessages";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const code = "00020101021226800014br.gov.bcb.pix2560pix.exemplo.test/cobranca5204000053039865406341.995802BR6304ABCD";
function channel(provider: string): PixSendChannel {
  return {
    provider,
    sendText: vi.fn().mockResolvedValue("text-id"),
    sendImage: vi.fn().mockResolvedValue("image-id"),
    sendCopyButton: vi.fn().mockResolvedValue("button-id"),
    persist: vi.fn().mockResolvedValue(undefined),
  };
}
describe("envio do código PIX com ou sem botão de copiar", () => {
  it("uazapi envia com o botão Copiar por padrão, sem duplicar o código no chat", async () => {
    const ch = channel("uazapi");
    const result = await sendPixMessages({ channel: ch, code: ` ${code} `, amount: 341.99, includeQr: false });
    expect(result).toEqual({ sentQr: false, usedCopyButton: true });
    expect(ch.sendCopyButton).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ch.sendCopyButton!).mock.calls[0][2]).toBe(code);
    expect(ch.sendText).not.toHaveBeenCalled();
    expect(ch.persist).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(ch.persist).mock.calls[0][0];
    expect(persisted.message).toContain("[Botão: Copiar código PIX]");
    expect(persisted.message).toContain(`[PIX_CODE:${code}]`);
    expect(persisted.message_id).toBe("button-id");
  });
  it("uazapi com withCopyButton:false envia o código inteiro isolado sem botão", async () => {
    const ch = channel("uazapi");
    const result = await sendPixMessages({ channel: ch, code, amount: 341.99, includeQr: false, withCopyButton: false });
    expect(result).toEqual({ sentQr: false, usedCopyButton: false });
    expect(ch.sendCopyButton).not.toHaveBeenCalled();
    expect(ch.sendText).toHaveBeenCalledTimes(2);
    expect(ch.sendText).toHaveBeenLastCalledWith(code);
    expect(ch.persist).toHaveBeenLastCalledWith({ message: code, message_id: "text-id" });
  });
  it("se o botão falhar no envio, cai para o código isolado automaticamente", async () => {
    const ch = channel("uazapi");
    vi.mocked(ch.sendCopyButton!).mockRejectedValueOnce(new Error("provedor recusou"));
    const result = await sendPixMessages({ channel: ch, code, amount: 341.99, includeQr: false });
    expect(result.usedCopyButton).toBe(false);
    expect(ch.sendText).toHaveBeenCalledTimes(2);
    expect(ch.sendText).toHaveBeenLastCalledWith(code);
  });
  it.each(["meta", "wasender", "zapi", "instagram"])("%s não tem botão: envia o código isolado", async (provider) => {
    const ch = channel(provider);
    const result = await sendPixMessages({ channel: ch, code, amount: 341.99, includeQr: false });
    expect(result).toEqual({ sentQr: false, usedCopyButton: false });
    expect(ch.sendCopyButton).not.toHaveBeenCalled();
    expect(ch.sendText).toHaveBeenLastCalledWith(code);
  });
  it("não envia nada se não houver código", async () => {
    const ch = channel("uazapi");
    await expect(sendPixMessages({ channel: ch, code: " ", amount: 341.99, includeQr: false })).rejects.toThrow();
    expect(ch.sendText).not.toHaveBeenCalled();
    expect(ch.sendCopyButton).not.toHaveBeenCalled();
    expect(ch.persist).not.toHaveBeenCalled();
  });
  it("não relata sucesso se o envio do código falhar", async () => {
    const ch = channel("uazapi");
    vi.mocked(ch.sendText).mockResolvedValueOnce("intro-id").mockRejectedValueOnce(new Error("falha no código"));
    await expect(
      sendPixMessages({ channel: ch, code, amount: 341.99, includeQr: false, withCopyButton: false }),
    ).rejects.toThrow("falha no código");
    expect(ch.persist).toHaveBeenCalledTimes(1);
  });
});
