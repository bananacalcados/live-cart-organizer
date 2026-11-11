import { describe, it, expect } from "vitest";
import { receiptPath } from "@/lib/storage/signedReceiptUrl";

describe("receiptPath", () => {
  it("extrai o caminho de URL antiga pública do bucket de comprovantes", () => {
    expect(receiptPath("https://x.supabase.co/storage/v1/object/public/payment-receipts/loja/caixa/1.jpg"))
      .toBe("loja/caixa/1.jpg");
  });
  it("ignora URL de outro bucket", () => {
    expect(receiptPath("https://x.supabase.co/storage/v1/object/public/whatsapp-media/a.jpg")).toBeNull();
  });
});
