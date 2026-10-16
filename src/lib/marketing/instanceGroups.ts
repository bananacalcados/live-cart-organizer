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

/** Resolve a instância (whatsapp_numbers) a partir de whatsapp_groups.instance_id, casando por qualquer chave de instanceKeys. */
export async function resolveInstanceByKey(key: string | null | undefined): Promise<InstanceInfo | null> {
  if (!key) return null;
  const { data } = await supabase
    .from("whatsapp_numbers_safe" as any)
    .select("id, provider, zapi_instance_id, uazapi_instance_name");
  const list = ((data as any[]) || []) as InstanceInfo[];
  return list.find((n) => instanceKeys(n).includes(key)) || null;
}

export type GroupAction =
  | "update-name" | "update-description" | "update-photo"
  | "set-messages-admins-only" | "set-add-admins-only"
  | "add-participant" | "remove-participant" | "promote-admin" | "demote-admin"
  | "get-participants";

/**
 * Executa uma ação de grupo roteando pelo provedor real da instância
 * (uazapi → uazapi-groups; Z-API → zapi-group-settings com whatsapp_number_id).
 * Retorna { success, data, error }; para get-participants, data = [{ phone, name, isAdmin }].
 */
export async function runGroupAction(
  inst: InstanceInfo, groupJid: string, action: GroupAction, value?: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const wid = inst.id;
  const provider = inst.provider || "zapi";
  if (provider === "uazapi") {
    const map: Record<GroupAction, Record<string, unknown>> = {
      "update-name": { action: "updateName", name: value },
      "update-description": { action: "updateDescription", description: value ?? "" },
      "update-photo": { action: "updateImage", image: value },
      "set-messages-admins-only": { action: "updateAnnounce", announce: value === "true" },
      "set-add-admins-only": { action: "updateMemberAddMode", adminsOnly: value === "true" },
      "add-participant": { action: "updateParticipants", participantAction: "add", participants: [value] },
      "remove-participant": { action: "updateParticipants", participantAction: "remove", participants: [value] },
      "promote-admin": { action: "updateParticipants", participantAction: "promote", participants: [value] },
      "demote-admin": { action: "updateParticipants", participantAction: "demote", participants: [value] },
      "get-participants": { action: "info" },
    };
    const { data, error } = await supabase.functions.invoke("uazapi-groups", {
      body: { ...map[action], groupJid, whatsapp_number_id: wid },
    });
    if (error || !data?.success) return { success: false, error: data?.error || error?.message || "Erro" };
    if (action === "get-participants") {
      const raw = data.data || {};
      const parts: any[] = raw.Participants || raw.participants || raw.group?.participants || raw.data?.participants || [];
      return {
        success: true,
        data: parts.map((p: any) => ({
          phone: String(p.PhoneNumber || p.phone || p.JID || p.jid || "").replace(/@.*/, "").replace(/\D/g, ""),
          name: p.DisplayName || p.name || "",
          isAdmin: !!(p.IsAdmin || p.IsSuperAdmin || p.isAdmin),
        })).filter((p) => p.phone),
      };
    }
    return { success: true, data: data.data };
  }
  if (provider !== "zapi") return { success: false, error: `Provedor ${provider} não suportado nesta tela` };
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      action, groupId: groupJid, whatsapp_number_id: wid,
      ...(["add-participant", "remove-participant", "promote-admin", "demote-admin"].includes(action) ? { phone: value } : { value }),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) return { success: false, error: data?.error || "Erro" };
  if (action === "get-participants") {
    const list = Array.isArray(data.data) ? data.data : (data.data?.participants || []);
    return {
      success: true,
      data: list.map((p: any) => ({
        phone: p.phone || p.id?.replace("@c.us", "") || "",
        name: p.name || p.pushName || "",
        isAdmin: p.admin === "admin" || p.admin === "superadmin" || p.isAdmin,
      })),
    };
  }
  return { success: true, data: data.data };
}
