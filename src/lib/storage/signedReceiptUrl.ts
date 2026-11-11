import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "payment-receipts";
const MARKER = `/${BUCKET}/`;
const cache = new Map<string, { url: string; exp: number }>();

/** Caminho do arquivo dentro do bucket privado de comprovantes (ou null se não for desse bucket). */
export function receiptPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(MARKER);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + MARKER.length).split("?")[0]);
}

/** Converte a URL salva do comprovante em link assinado (1 h). URLs de fora do bucket passam iguais. */
export async function signReceiptUrl(url: string | null | undefined): Promise<string | null> {
  const path = receiptPath(url);
  if (!path) return url ?? null;
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export function useSignedReceiptUrl(url: string | null | undefined): string | null {
  const [signed, setSigned] = useState<string | null>(() => (receiptPath(url) ? null : url ?? null));
  useEffect(() => {
    let alive = true;
    signReceiptUrl(url).then((u) => { if (alive) setSigned(u); });
    return () => { alive = false; };
  }, [url]);
  return signed;
}
