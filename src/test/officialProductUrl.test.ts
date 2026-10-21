import { describe, expect, it } from "vitest";
import { getOfficialProductUrl } from "@/lib/marketing/officialProductUrl";
import { decorateOutboundUrl } from "@/lib/marketing/linkPageUtm";

describe("links de produtos exclusivamente no site oficial", () => {
  it("resolve o identificador Shopify para a página oficial do produto", () => {
    expect(getOfficialProductUrl("10070-1-tenis-feminino-ultraconforto-joana")).toBe(
      "https://bananacalcados.com.br/produto/10070-1-tenis-feminino-ultraconforto-joana",
    );
  });

  it.each([
    "https://www.bananabrasil.com.br/", "//www.bananabrasil.com.br",
    "../outro-site", "produto?redirect=https://www.bananabrasil.com.br",
    "produto#https://www.bananabrasil.com.br", "a/b", "%2f%2fevil.test",
    "javascript:alert(1)", "", null, undefined,
  ])("não gera destino para identificador inválido %s", (handle) => {
    expect(getOfficialProductUrl(handle)).toBe("");
  });

  it("ignora domínio externo recebido e preserva rastreamento no produto oficial", () => {
    const result = new URL(decorateOutboundUrl({
      url: "https://www.bananabrasil.com.br/products/joana",
      productHandle: "joana", productId: "shopify-1", pageSlug: "banana-IG", clickId: "click-123",
    }));
    expect(result.origin).toBe("https://bananacalcados.com.br");
    expect(result.pathname).toBe("/produto/joana");
    expect(result.searchParams.get("lp_click")).toBe("click-123");
    expect(result.searchParams.get("utm_source")).toBe("banana-ig");
    expect(result.searchParams.get("utm_medium")).toBe("catalog_product");
  });

  it("bloqueia produto sem identificador em vez de usar URL externa alternativa", () => {
    expect(decorateOutboundUrl({
      url: "https://www.bananabrasil.com.br/products/joana", productId: "shopify-1", clickId: "123",
    })).toBe("");
  });

  it("não altera destino de botões que não sejam produtos", () => {
    const result = new URL(decorateOutboundUrl({ url: "https://wa.me/5533999999999", clickId: "123" }));
    expect(result.origin).toBe("https://wa.me");
    expect(result.pathname).toBe("/5533999999999");
  });
});