import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StatusQuote {
  message_id: string;
  type: string;
  media_url: string | null;
  caption: string | null;
  text_content: string | null;
}

/**
 * Resolve miniaturas de STATUS citados em respostas.
 * Um status não pertence a nenhuma conversa, então não está em `messages`.
 * Para cada `quoted_message_id` que não foi encontrado localmente, buscamos
 * em `whatsapp_status_posts` e devolvemos um mapa id -> status.
 */
export function useStatusQuotes(messages: { message_id?: string | null; quoted_message_id?: string | null }[]) {
  const [map, setMap] = useState<Record<string, StatusQuote>>({});

  useEffect(() => {
    const localIds = new Set(messages.map((m) => m.message_id).filter(Boolean) as string[]);
    const missing = Array.from(
      new Set(
        messages
          .map((m) => (m as any).quoted_message_id as string | null | undefined)
          .filter((id): id is string => !!id && !localIds.has(id)),
      ),
    );
    if (missing.length === 0) {
      setMap((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("whatsapp_status_posts")
        .select("message_id, type, media_url, caption, text_content")
        .in("message_id", missing);
      if (cancelled || error || !data) return;
      const next: Record<string, StatusQuote> = {};
      for (const row of data) next[row.message_id] = row as StatusQuote;
      setMap(next);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.map((m) => `${m.message_id}:${(m as any).quoted_message_id}`).join(",")]);

  return map;
}
