import { describe, expect, it } from "vitest";
import { buildInviteText, catalogUrl, inviteDelaySeconds, inviteName } from "../../supabase/functions/live-catalog-invite/invite";

describe("convite do catálogo", () => {
  it("sorteio do atraso fica entre 2 e 5 minutos", () => {
    expect(inviteDelaySeconds(2, 5, 0)).toBe(120);
    expect(inviteDelaySeconds(2, 5, 0.999999)).toBe(300);
    for (let i = 0; i < 200; i++) { const s = inviteDelaySeconds(2, 5); expect(s).toBeGreaterThanOrEqual(120); expect(s).toBeLessThanOrEqual(300); }
  });
  it("mínimo maior que máximo é corrigido", () => {
    expect(inviteDelaySeconds(5, 2, 0)).toBe(120);
  });
  it("nome usa o @ sem arroba, senão primeiro nome", () => {
    expect(inviteName("@maria.s", "Joana Lima")).toBe("maria.s");
    expect(inviteName(null, "JOANA lima")).toBe("Joana");
  });
  it("texto 1 com link e quebras reais", () => {
    const link = catalogUrl("livebanana", "a".repeat(32));
    expect(link).toBe("https://checkout.bananacalcados.com.br/pedido/livebanana/catalogo/" + "a".repeat(32));
    expect(buildInviteText("maria", link, 0)).toBe(`maria nós estamos com algumas ofertas pra quem já comprou hoje 😊\n\nClica no link pra ver o catálogo: ${link}\n\nSe quiser um deles é só clicar em adicionar ao carrinho 😁`);
    expect(buildInviteText("maria", link, 0.5)).toContain("Oii maria! Separei");
    expect(buildInviteText("maria", link, 0.99)).toContain("maria, tem oferta");
  });
});
