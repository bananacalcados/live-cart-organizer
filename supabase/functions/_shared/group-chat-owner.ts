// Fase B (2.4): só a instância RESPONSÁVEL do grupo cria/atualiza o chat no PDV.
// As outras instâncias continuam alimentando membros/atividade, mas não gravam a
// mensagem (o mesmo id de mensagem já entra pela responsável).
// Sem linha de responsável ou sem instância definida → comportamento antigo (grava).

// deno-lint-ignore no-explicit-any
type Sb = any;

export function groupJidBase(raw: string | null | undefined): string {
  const s = String(raw || "");
  return s.split("@")[0].split("-")[0].replace(/\D/g, "");
}

export async function isGroupChatOwner(
  supabase: Sb,
  rawGroupId: string | null | undefined,
  numberId: string | null | undefined,
): Promise<boolean> {
  const base = groupJidBase(rawGroupId);
  if (!base || !numberId) return true;
  try {
    const { data, error } = await supabase
      .from("whatsapp_group_responsible")
      .select("instance_id")
      .eq("group_jid_base", base)
      .maybeSingle();
    if (error || !data?.instance_id) return true;
    return String(data.instance_id) === String(numberId);
  } catch {
    return true; // falha de leitura nunca derruba o chat
  }
}
