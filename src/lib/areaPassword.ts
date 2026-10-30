import { supabase } from "@/integrations/supabase/client";

export type ProtectedArea = "fiscal" | "folha";

const key = (area: ProtectedArea) => `area-unlocked:${area}`;

export function isAreaUnlocked(area: ProtectedArea): boolean {
  try { return sessionStorage.getItem(key(area)) === "1"; } catch { return false; }
}

/** Server-side check (hash + 5 tries / 5 min lock). Unlock lasts for this browser tab session only. */
export async function unlockArea(area: ProtectedArea, password: string): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await (supabase.rpc as any)("verify_area_password", { p_area: area, p_password: password });
  if (error) return { ok: false, message: "Não foi possível conferir a senha." };
  if (data?.ok) {
    try { sessionStorage.setItem(key(area), "1"); } catch { /* sessão só em memória */ }
    return { ok: true };
  }
  if (data?.locked_until) {
    const t = new Date(data.locked_until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return { ok: false, message: `Muitas tentativas erradas. Tente de novo após ${t}.` };
  }
  return { ok: false, message: data?.remaining ? `Senha incorreta (${data.remaining} tentativa(s) restante(s))` : "Senha incorreta" };
}

export async function changeAreaPassword(area: ProtectedArea, current: string, next: string) {
  const { error } = await (supabase.rpc as any)("change_area_password", { p_area: area, p_current: current, p_new: next });
  if (error) throw new Error(error.message);
}
