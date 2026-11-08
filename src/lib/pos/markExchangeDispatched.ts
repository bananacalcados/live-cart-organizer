// Marca trocas como despachadas (status 'concluida'). Não gera NF nem mexe em estoque.
import { supabase } from "@/integrations/supabase/client";

export function buildDispatchPatch(opts: {
  userId: string | null;
  trackingCode?: string | null;
  trackingCarrier?: string | null;
  now?: Date;
}) {
  const patch: Record<string, unknown> = {
    status: "concluida",
    despachada_em: (opts.now ?? new Date()).toISOString(),
    despachada_por: opts.userId,
  };
  const code = opts.trackingCode?.trim();
  const carrier = opts.trackingCarrier?.trim();
  if (code) patch.tracking_code = code;
  if (carrier) patch.tracking_carrier = carrier;
  return patch;
}

/** Atualiza só trocas ainda em 'aguardando_envio'. Retorna quantas foram marcadas. */
export async function markExchangesDispatched(
  ids: string[],
  opts: { trackingCode?: string | null; trackingCarrier?: string | null } = {},
): Promise<number> {
  if (ids.length === 0) return 0;
  const { data: auth } = await supabase.auth.getUser();
  const patch = buildDispatchPatch({ userId: auth.user?.id ?? null, ...opts });
  const { data, error } = await supabase
    .from("trocas_devolucoes")
    .update(patch as any)
    .in("id", ids)
    .eq("status", "aguardando_envio")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
