// blocked-guard.ts
// Guard COMPARTILHADO de contatos bloqueados.
//
// Regra do sistema: quando um contato é bloqueado (via botão de bloqueio no chat,
// que registra em `blocked_contacts`), ele NUNCA deve receber disparo em massa nem
// automação — NEM MESMO de outras instâncias nossas. Por isso o match é
// CROSS-INSTÂNCIA: comparamos pelos últimos 8 dígitos do telefone, ignorando DDI,
// 9º dígito e qual instância originou o bloqueio.
//
// Importante: o bloqueio NATIVO no WhatsApp (Meta/Z-API/WaSender/uazapi) é por
// instância — isso é feito pela função `whatsapp-block-contact`. Este guard cobre
// a outra metade: impedir QUALQUER envio proativo nosso para o contato bloqueado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

/** Últimos 8 dígitos do telefone (chave de match cross-instância). */
export function phoneSuffix(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "").slice(-8);
}

/**
 * Carrega TODOS os sufixos (8 dígitos) de contatos bloqueados em qualquer instância.
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
        const sfx = phoneSuffix((r as { phone?: string }).phone);
        if (sfx.length >= 8) set.add(sfx);
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

/** True se o telefone está bloqueado (match cross-instância pelos 8 dígitos). */
export function isBlocked(set: Set<string>, phone: string | null | undefined): boolean {
  const sfx = phoneSuffix(phone);
  return sfx.length >= 8 && set.has(sfx);
}
