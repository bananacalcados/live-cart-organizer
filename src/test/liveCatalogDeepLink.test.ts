import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/live/SelfServicePrivacy", () => ({ SelfServicePrivacy: () => null }));
vi.mock("@/lib/metaAttribution", () => ({ captureAttribution: vi.fn() }));
vi.mock("@/lib/selfServiceAdvertising", () => ({ trackSelfservice: vi.fn() }));

import { normalizeCatalogColor } from "@/pages/LiveCatalogPublicPage";

describe("Cor no link da vitrine", () => {
  it("aceita branco-off como Branco Off, ignorando maiúsculas e espaços", () => {
    expect(normalizeCatalogColor("Branco Off")).toBe(normalizeCatalogColor("branco-off"));
  });
  it("ignora acentos e espaços nas cores", () => {
    expect(normalizeCatalogColor("  PÉROLA  ")).toBe("perola");
    expect(normalizeCatalogColor("ROSA")).toBe(normalizeCatalogColor("rosa"));
  });
  it("não confunde uma cor ausente com outra cor", () => {
    expect(normalizeCatalogColor("vinho")).not.toBe(normalizeCatalogColor("dourado"));
  });
});