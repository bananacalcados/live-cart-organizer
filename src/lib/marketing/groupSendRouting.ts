import { supabase } from "@/integrations/supabase/client";

export interface GroupRoute {
  base: string; target_id: string; name: string; instance_id: string | null;
  label: string | null; provider: string; online: boolean; present: boolean;
  is_admin: boolean; group_jid: string; responsible_id: string | null;
  responsible_label: string | null; source: string;
}
export async function fetchGroupSendRoutes(ids: string[], fallback: string | null, overrides: Record<string, string> = {}): Promise<GroupRoute[]> {
  const all: GroupRoute[] = [];
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.rpc("group_send_routes", { p_group_ids: ids.slice(start, start + 200), p_fallback: fallback, p_overrides: overrides });
    if (error) throw error;
    all.push(...(data as unknown as GroupRoute[] || []));
  }
  return [...new Map(all.map(r => [r.base, r])).values()];
}
export function groupRoutingSummary(routes: GroupRoute[], overrides: Record<string, string> = {}): string {
  const counts = new Map<string, number>();
  let fallback = 0;
  for (const route of routes) {
    const label = route.label || "Sem instância";
    counts.set(label, (counts.get(label) || 0) + 1);
    if (!route.responsible_id && !overrides[route.base]) fallback++;
  }
  const summary = [...counts].map(([label, count]) => `${label} (${count} grupos)`).join(", ");
  return `Vai sair por ${summary || "nenhum grupo"}${fallback ? `; ${fallback} grupos sem responsável → fallback instância da campanha` : ""}`;
}