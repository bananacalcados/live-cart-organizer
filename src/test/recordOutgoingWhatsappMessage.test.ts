import { describe, expect, it, vi } from "vitest";
import { outgoingWhatsappMessageRow, recordOutgoingWhatsappMessage } from "@/lib/pos/recordOutgoingWhatsappMessage";

describe("histórico dos avisos de WhatsApp", () => {
  it("grava o telefone normalizado, a instância e o ID do provedor", () => {
    expect(outgoingWhatsappMessageRow({ phone: "33 8765-4321", message: "Troca concluída", messageId: "provider-1", numberId: "instance-1" })).toEqual({
      phone: "5533987654321",
      message: "Troca concluída",
      direction: "outgoing",
      status: "sent",
      media_type: "text",
      message_id: "provider-1",
      whatsapp_number_id: "instance-1",
    });
  });

  it("não derruba o fluxo quando a gravação falha", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordOutgoingWhatsappMessage(
      { phone: "5533998765432", message: "Aviso", messageId: "id", numberId: "instance" },
      async () => { throw new Error("simulated"); },
    )).resolves.toBe(false);
    warn.mockRestore();
  });
});
