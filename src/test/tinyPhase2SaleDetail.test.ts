import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/pos/POSSaleDetailDialog.tsx", "utf8");

describe("detalhe da venda sem ações do Tiny", () => {
  it("não chama o Tiny nem oferece envio, reenvio ou exclusão externa", () => {
    expect(source).not.toContain("api.tiny.com.br");
    expect(source).not.toContain("cancel_tiny_only");
    for (const label of [
      "Enviar ao Tiny",
      "Reenviar ao Tiny",
      "Cancelar no Tiny e Reenviar",
      "Excluir do Tiny",
    ]) {
      expect(source).not.toContain(label);
    }
  });

  it("mantém somente a chamada normal de excluir venda", () => {
    expect(source.match(/functions\/v1\/pos-tiny-delete-sale/g)).toHaveLength(1);
    expect(source).toContain('"Excluir Venda"');
    expect(source).toContain('"Confirmar exclusão"');
    expect(source).not.toContain("cancela NFC-e e pedido Tiny");
  });
});
