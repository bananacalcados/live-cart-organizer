/**
 * Mensagens de rastreio da Expedição: variáveis disponíveis + renderização.
 * As variáveis são puxadas do próprio pedido (pos_sales) no momento do envio.
 */

export interface TrackingVarDef {
  key: string;
  label: string;
}

export const TRACKING_VARS: TrackingVarDef[] = [
  { key: "primeiro_nome", label: "Primeiro nome" },
  { key: "nome", label: "Nome completo" },
  { key: "transportadora", label: "Transportadora" },
  { key: "prazo_entrega", label: "Prazo de entrega" },
  { key: "codigo_rastreio", label: "Código de rastreio" },
  { key: "link_rastreio", label: "Link de rastreio" },
  { key: "valor_pedido", label: "Valor do pedido" },
  { key: "endereco", label: "Endereço do cliente" },
  { key: "cidade", label: "Cidade" },
  { key: "estado", label: "Estado (UF)" },
  { key: "cep", label: "CEP" },
  { key: "pedido_numero", label: "Nº do pedido" },
  { key: "itens", label: "Lista de itens" },
];

export type TrackingVarValues = Partial<Record<string, string>>;

/** Substitui {{variavel}} pelos valores informados (vazio quando não houver dado). */
export function renderTrackingMessage(body: string, values: TrackingVarValues): string {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, k: string) => {
    const v = values[k.toLowerCase()];
    return v == null ? "" : String(v);
  });
}

/** Monta o endereço em uma linha a partir do JSON de shipping_address. */
export function formatShippingAddress(addr: any): string {
  if (!addr || typeof addr !== "object") return "";
  const street = addr.street || addr.address1 || addr.logradouro || "";
  const number = addr.number || addr.numero || "";
  const comp = addr.complement || addr.complemento || "";
  const hood = addr.neighborhood || addr.bairro || addr.district || "";
  const city = addr.city || addr.cidade || "";
  const state = addr.state || addr.uf || addr.province || "";
  const zip = addr.zip_code || addr.zipcode || addr.cep || addr.zip || "";
  const l1 = [street, number].filter(Boolean).join(", ");
  return [l1, comp, hood, [city, state].filter(Boolean).join("/"), zip].filter(Boolean).join(" - ");
}
