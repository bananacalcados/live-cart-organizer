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
describe("envio seguro do código PIX", () => {
  it.each(["uazapi", "meta", "wasender", "zapi", "instagram"])("%s envia o código inteiro isolado sem botão nativo", async (provider) => {
    const ch = channel(provider);
    const result = await sendPixMessages({ channel: ch, code: ` ${code} `, amount: 341.99, includeQr: false });
    expect(result).toEqual({ sentQr: false, usedCopyButton: false });
    expect(ch.sendCopyButton).not.toHaveBeenCalled();
    expect(ch.sendText).toHaveBeenCalledTimes(2);
    expect(ch.sendText).toHaveBeenLastCalledWith(code);
    expect(ch.persist).toHaveBeenLastCalledWith({ message: code, message_id: "text-id" });
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
    await expect(sendPixMessages({ channel: ch, code, amount: 341.99, includeQr: false })).rejects.toThrow("falha no código");
    expect(ch.persist).toHaveBeenCalledTimes(1);
  });
});