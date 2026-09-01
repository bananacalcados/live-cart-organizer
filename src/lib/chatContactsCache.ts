import { supabase } from "@/integrations/supabase/client";

/**
 * Cache compartilhado dos contatos do WhatsApp (chat_contacts).
 *
 * Antes, cada tela (GlobalWhatsAppChat, DashboardChatPanel, Chat, POSWhatsApp)
 * lia a tabela `chat_contacts` INTEIRA (dezenas de milhares de linhas, várias
 * páginas de 1000) toda vez que abria — gerando centenas de milhares de leituras
 * repetidas e alto consumo de CPU/egress.
 *
 * Agora resolvemos SOMENTE os telefones visíveis na tela (`resolveChatContacts`),
 * em lotes, com cache em memória por telefone (TTL) e de-dupe de chamadas
 * simultâneas.
 */

export interface ChatContactRow {
  phone: string;
  custom_name: string | null;
  display_name: string | null;
  profile_pic_url: string | null;
  tags: string[] | null;
}

export interface ChatContactMaps {
  /** phone -> nome resolvido (custom_name ou display_name) */
  names: Record<string, string>;
  /** phone -> url da foto de perfil */
  pics: Record<string, string>;
  /** phone -> tags */
  tags: Record<string, string[]>;
  /** linhas resolvidas (apenas as encontradas) */
  rows: ChatContactRow[];
}

const TTL_MS = 5 * 60 * 1000; // 5 minutos
const CHUNK = 200;

/** phone -> { row (ou null quando não existe), at } */
const entries = new Map<string, { row: ChatContactRow | null; at: number }>();
/** de-dupe de buscas em andamento por telefone */
const inflight = new Map<string, Promise<void>>();

function isFresh(at: number) {
  return Date.now() - at < TTL_MS;
}

function buildMaps(phones: string[]): ChatContactMaps {
  const names: Record<string, string> = {};
  const pics: Record<string, string> = {};
  const tags: Record<string, string[]> = {};
  const rows: ChatContactRow[] = [];

  for (const phone of phones) {
    const entry = entries.get(phone);
    const row = entry?.row;
    if (!row) continue;
    rows.push(row);
    if (row.custom_name) names[row.phone] = row.custom_name;
    else if (row.display_name) names[row.phone] = row.display_name;
    if (row.profile_pic_url) pics[row.phone] = row.profile_pic_url;
    if (Array.isArray(row.tags) && row.tags.length > 0) tags[row.phone] = row.tags;
  }

  return { names, pics, tags, rows };
}

async function fetchChunk(phones: string[]): Promise<void> {
  const { data } = await supabase
    .from("chat_contacts")
    .select("phone, custom_name, display_name, profile_pic_url, tags")
    .in("phone", phones);

  const found = new Set<string>();
  for (const c of (data || []) as ChatContactRow[]) {
    if (!c.phone) continue;
    found.add(c.phone);
    entries.set(c.phone, { row: c, at: Date.now() });
  }
  // Marca ausentes como "não existe" para não reconsultar a cada render.
  for (const p of phones) {
    if (!found.has(p)) entries.set(p, { row: null, at: Date.now() });
  }
}

/**
 * Resolve nomes/fotos/tags apenas para os telefones informados.
 * Consulta somente o que não estiver em cache fresco.
 */
export async function resolveChatContacts(
  phoneList: string[],
  force = false,
): Promise<ChatContactMaps> {
  const phones = Array.from(new Set(phoneList.filter(Boolean)));
  if (phones.length === 0) return { names: {}, pics: {}, tags: {}, rows: [] };

  const missing: string[] = [];
  const waits: Promise<void>[] = [];

  for (const phone of phones) {
    const entry = entries.get(phone);
    if (!force && entry && isFresh(entry.at)) continue;
    const pending = inflight.get(phone);
    if (pending) {
      waits.push(pending);
      continue;
    }
    missing.push(phone);
  }

  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const promise = fetchChunk(chunk)
      .catch((err) => {
        console.error("Erro ao resolver contatos:", err);
      })
      .finally(() => {
        for (const p of chunk) inflight.delete(p);
      });
    for (const p of chunk) inflight.set(p, promise);
    waits.push(promise);
  }

  await Promise.all(waits);
  return buildMaps(phones);
}

/** Leitura síncrona do que já está em cache (sem disparar requisição). */
export function peekChatContacts(phoneList: string[]): ChatContactMaps {
  return buildMaps(Array.from(new Set(phoneList.filter(Boolean))));
}

/** Invalida o cache (ex.: após editar/criar um contato). */
export function invalidateChatContactsCache(phone?: string) {
  if (phone) entries.delete(phone);
  else entries.clear();
}
