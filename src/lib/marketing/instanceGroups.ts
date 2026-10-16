import { supabase } from "@/integrations/supabase/client";
import { authHeaders } from "@/lib/authHeaders";

export interface InstanceInfo {
  id: string;
  provider: string | null;
  zapi_instance_id: string | null;
  uazapi_instance_name: string | null;
}

/** Valores possíveis de whatsapp_groups.instance_id para uma instância (uuid, Z-API id, nome uazapi). */
export function instanceKeys(n: InstanceInfo | null | undefined): string[] {
  if (!n) return [];
  return [n.id, n.zapi_instance_id, n.uazapi_instance_name].filter((v): v is string => !!v);
}

export async function fetchInstanceInfo(numberId: string): Promise<InstanceInfo | null> {
  const { data } = await supabase
    .from("whatsapp_numbers_safe" as any)
    .select("id, provider, zapi_instance_id, uazapi_instance_name")
    .eq("id", numberId)
    .maybeSingle();
  return (data as any) || null;
}

/** Chama a listagem do provedor da instância (com gravação no banco). Lança erro se falhar. */
export async function syncInstanceGroups(info: InstanceInfo): Promise<{ total: number }> {
  const provider = info.provider || "zapi";
  if (provider === "uazapi" || provider === "wasender") {
    const fn = provider === "uazapi" ? "uazapi-groups" : "wasender-groups";
    const { data, error } = await supabase.functions.invoke(fn, {
      body: { action: "list", syncToDb: true, whatsapp_number_id: info.id },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || "Erro ao listar grupos");
    return { total: data.total ?? 0 };
  }
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ syncToDb: true, whatsapp_number_id: info.id }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || "Erro ao listar grupos");
  return { total: data.total ?? 0 };
}
