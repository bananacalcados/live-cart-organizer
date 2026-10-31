export const PUBLIC_BASE = "https://checkout.bananacalcados.com.br";

export const INVITE_VARIATIONS = [
  "{nome} nós estamos com algumas ofertas pra quem já comprou hoje 😊\n\nClica no link pra ver o catálogo: {link}\n\nSe quiser um deles é só clicar em adicionar ao carrinho 😁",
  "Oii {nome}! Separei umas ofertas só pra quem já comprou hoje 😊\n\nDá uma olhada no catálogo: {link}\n\nGostou de algum? É só clicar em adicionar ao carrinho 😁",
  "{nome}, tem oferta pra quem já comprou hoje 😁\n\nSeu catálogo tá aqui: {link}\n\nQuer um deles? Clica em adicionar ao carrinho que eu já monto pra você 😊",
];

export const catalogUrl = (slug: string, token: string) => `${PUBLIC_BASE}/pedido/${slug}/catalogo/${token}`;

/** {nome} = @instagram sem "@" ou primeiro nome. */
export function inviteName(handle?: string | null, fullName?: string | null): string {
  const h = String(handle || "").trim().replace(/^@+/, "");
  if (h) return h;
  const f = String(fullName || "").trim().split(/\s+/)[0] || "";
  return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : "";
}

export function buildInviteText(nome: string, link: string, rand: number = Math.random()): string {
  const i = Math.min(INVITE_VARIATIONS.length - 1, Math.max(0, Math.floor(rand * INVITE_VARIATIONS.length)));
  let t = INVITE_VARIATIONS[i].replace("{nome}", nome).replace("{link}", link);
  if (!nome) {
    t = t.replace(/^\s*[,!]?\s*/, "").replace("Oii !", "Oii!");
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

/** Espelho do sorteio do banco: segundos entre min e max minutos (inclusive). */
export function inviteDelaySeconds(minMin: number, maxMin: number, rand: number = Math.random()): number {
  const lo = Math.max(0, Math.min(minMin, maxMin));
  const hi = Math.max(lo, maxMin);
  return lo * 60 + Math.floor(rand * ((hi - lo) * 60 + 1));
}
