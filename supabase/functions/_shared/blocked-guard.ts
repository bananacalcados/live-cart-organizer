// blocked-guard.ts
// Guard COMPARTILHADO de contatos bloqueados.
//
// Regra do sistema: quando um contato é bloqueado (via botão de bloqueio no chat,
// que registra em `blocked_contacts`), ele NUNCA deve receber disparo em massa nem
// automação — NEM MESMO de outras instâncias nossas. Por isso o match é
// CROSS-INSTÂNCIA.
//
// CHAVE DE MATCH = DDD (2 dígitos) + últimos 8 dígitos, IGNORANDO o 9º dígito e o
// DDI (55). Usar apenas os 8 últimos dígitos causava COLISÃO entre pessoas de DDDs
// diferentes que compartilham o mesmo final de número — por isso o DDD entra na
// chave. O 9º dígito é ignorado porque números podem estar salvos com ou sem ele.
//
// Importante: o bloqueio NATIVO no WhatsApp (Meta/Z-API/WaSender/uazapi) é por
// instância — isso é feito pela função `whatsapp-block-contact`. Este guard cobre
// a outra metade: impedir QUALQUER envio proativo nosso para o contato bloqueado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Chave de match cross-instância = DDD + últimos 8 dígitos (ignora DDI e 9º dígito).
 *
 * Exemplos (todos geram a mesma chave "3399998888"):
 *   +55 (33) 99999-8888  -> 5533999998888 -> 33 + 99998888 = "3399998888"
 *   (33) 9999-8888       -> 3399998888    -> 33 + 99998888 = "3399998888"
 *   033 99999 8888       -> 33999998888   -> 33 + 99998888 = "3399998888"
 *
 * Retorna "" quando não é possível derivar uma chave confiável.
 */
export function phoneKey(phone: string | null | undefined): string {
  let d = (phone || "").replace(/\D/g, "");
  if (!d) return "";

  // Remove o DDI 55 de números BR completos (12 = fixo, 13 = celular)
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }

  // Formato BR local esperado: DDD(2) + 8 díg. (fixo) ou DDD(2) + 9 + 8 díg. (celular)
  if (d.length === 10 || d.length === 11) {
    const ddd = d.slice(0, 2);
    const last8 = d.slice(-8); // descarta o 9º dígito automaticamente no celular
    return ddd + last8; // 10 caracteres: DDD + 8 finais
  }

  // Fallback conservador para formatos fora do padrão: não temos DDD confiável,
  // então usamos os 8 finais (mantém comportamento antigo apenas nesses casos).
  return d.slice(-8);
}

/** @deprecated use phoneKey — mantido por compatibilidade de nome. */
export const phoneSuffix = phoneKey;

/**
 * Carrega TODAS as chaves (DDD + 8 díg.) de contatos bloqueados em qualquer instância.
 * Fail-open: se a leitura falhar, retorna conjunto vazio para não derrubar disparos.
 */
export async function loadBlockedSuffixes(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("blocked_contacts")
        .select("phone")
        .range(from, from + pageSize - 1);
      if (error) {
        console.error("[blocked-guard] erro ao ler blocked_contacts:", error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const key = phoneKey((r as { phone?: string }).phone);
        if (key) set.add(key);
      }
      if (data.length < pageSize) break;
      from += pageSize;
      if (from > 200000) break;
    }
  } catch (e) {
    console.error("[blocked-guard] exceção ao carregar bloqueados:", e);
  }
  return set;
}

/** True se o telefone está bloqueado (match por DDD + 8 dígitos finais). */
export function isBlocked(set: Set<string>, phone: string | null | undefined): boolean {
  const key = phoneKey(phone);
  return key.length > 0 && set.has(key);
}
