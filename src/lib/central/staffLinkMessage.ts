export type CentralLinkType = "troca" | "devolucao";

/** Mensagem pronta enviada pela equipe junto com o link real da Central. */
export function centralLinkMessage(type: CentralLinkType, url: string, customerName?: string | null): string {
  const first = (customerName || "").trim().split(/\s+/)[0];
  const hello = first && !/^cliente$/i.test(first) ? `Oi, ${first}!` : "Oi!";
  const what = type === "troca" ? "sua troca" : "sua devolução";
  return `${hello} Para solicitar ${what}, é só abrir este link e seguir os passos 👇\n${url}\n\nQualquer dúvida, me chama aqui 😊`;
}

export function centralLinkUrl(type: CentralLinkType, token: string): string {
  return `https://checkout.bananacalcados.com.br/central/${type}/${token}`;
}
