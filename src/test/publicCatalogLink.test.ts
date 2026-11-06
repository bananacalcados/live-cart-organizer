import { describe, expect, it } from "vitest";
import { buildPublicCatalogUrl, publicCatalogUntil } from "@/lib/publicCatalogLink";

describe("link público do catálogo", () => {
  it("marca origem grupo, campanha e grupo", () => {
    const u = buildPublicCatalogUrl("https://checkout.bananacalcados.com.br", "live-x", { groupId: "g1", campaign: "domingo", productId: "p1" });
    expect(u).toBe("https://checkout.bananacalcados.com.br/pedido/live-x/vitrine?p=p1&utm_source=grupo&utm_campaign=domingo&g=g1");
  });
  it("validade de 48h após o momento escolhido", () => {
    expect(publicCatalogUntil(new Date("2026-11-08T20:00:00Z"), 48)).toBe("2026-11-10T20:00:00.000Z");
  });
});
