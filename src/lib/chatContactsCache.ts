import { supabase } from "@/integrations/supabase/client";

/**
 * Cache compartilhado dos contatos do WhatsApp (chat_contacts).
 *
 * Antes, cada tela (GlobalWhatsAppChat, DashboardChatPanel, etc.) lia a tabela
 * `chat_contacts` INTEIRA toda vez que abria — gerando centenas de milhares de
 * leituras repetidas (egress alto). Aqui carregamos UMA vez, guardamos em memória
 * por alguns minutos e reusamos entre as telas, com de-dupe de chamadas
 * simultâneas (inflight) para não disparar várias leituras ao mesmo tempo.
 */

export interface ChatContactMaps {
  /** phone -> nome resolvido (custom_name ou display_name) */
  names: Record<string, string>;
  /** phone -> url da foto de perfil */
  pics: Record<string, string>;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutos

let cache: ChatContactMaps | null = null;
let cachedAt = 0;
let inflight: Promise<ChatContactMaps> | null = null;

async function fetchContacts(): Promise<ChatContactMaps> {
  const names: Record<string, string> = {};
  const pics: Record<string, string> = {};

  // Mantém o mesmo escopo de antes (página padrão), apenas centralizado e cacheado.
  const { data } = await supabase
    .from("chat_contacts")
    .select("phone, custom_name, display_name, profile_pic_url")
    .order("updated_at", { ascending: false });

  for (const c of data || []) {
    if (!c.phone) continue;
    if (c.custom_name) names[c.phone] = c.custom_name;
    else if (c.display_name) names[c.phone] = c.display_name;
    if (c.profile_pic_url) pics[c.phone] = c.profile_pic_url;
  }

  return { names, pics };
}

/**
 * Retorna os mapas de nomes/fotos dos contatos.
 * Usa cache em memória (TTL) e de-dupe de chamadas concorrentes.
 */
export async function getChatContactMaps(force = false): Promise<ChatContactMaps> {
  const isFresh = cache && Date.now() - cachedAt < TTL_MS;
  if (!force && isFresh) return cache as ChatContactMaps;
  if (inflight) return inflight;

  inflight = fetchContacts()
    .then((res) => {
      cache = res;
      cachedAt = Date.now();
      inflight = null;
      return res;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });

  return inflight;
}

/** Invalida o cache (ex.: após editar/criar um contato). */
export function invalidateChatContactsCache() {
  cache = null;
  cachedAt = 0;
}
