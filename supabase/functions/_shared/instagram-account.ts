// deno-lint-ignore-file no-explicit-any
/**
 * Resolução de conta de Instagram (multi-conta).
 *
 * O sistema passou a suportar MAIS DE UMA conta de Instagram. Cada conta é
 * armazenada em `whatsapp_numbers` com provider='instagram', guardando:
 *   - instagram_account_id : o ID profissional do IG (== entry.id do webhook)
 *   - instagram_username    : o @handle da conta
 *   - access_token          : o token de longa duração daquela conta
 *
 * Regras de fallback: se a conta não for encontrada (ou nenhuma cadastrada),
 * usamos o token global `META_PAGE_ACCESS_TOKEN` — assim a conta original
 * continua funcionando mesmo antes de ser migrada para o novo modelo.
 */

export interface ResolvedIgAccount {
  /** id da linha em whatsapp_numbers (para gravar em whatsapp_messages.whatsapp_number_id) */
  numberId: string | null;
  /** token de acesso a ser usado nas chamadas Graph/Instagram */
  accessToken: string;
  /** @handle da conta (sem @), se conhecido */
  username: string | null;
  /** ID profissional do IG (entry.id) */
  accountId: string | null;
}

export function globalIgToken(): string {
  return Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";
}

/** Resolve a conta a partir do ID profissional do IG (entry.id do webhook). */
export async function resolveIgAccountByAccountId(
  supabase: any,
  accountId: string | null | undefined,
): Promise<ResolvedIgAccount> {
  const fallback: ResolvedIgAccount = {
    numberId: null,
    accessToken: globalIgToken(),
    username: null,
    accountId: accountId ?? null,
  };
  if (!accountId) return fallback;

  const { data } = await supabase
    .from("whatsapp_numbers")
    .select("id, access_token, instagram_username, instagram_account_id")
    .eq("provider", "instagram")
    .eq("instagram_account_id", String(accountId))
    .eq("is_active", true)
    .maybeSingle();

  if (data?.access_token) {
    return {
      numberId: data.id,
      accessToken: data.access_token,
      username: data.instagram_username ?? null,
      accountId: data.instagram_account_id ?? String(accountId),
    };
  }
  return fallback;
}

/** Resolve a conta a partir do id da linha (whatsapp_numbers.id). */
export async function resolveIgAccountByNumberId(
  supabase: any,
  numberId: string | null | undefined,
): Promise<ResolvedIgAccount> {
  const fallback: ResolvedIgAccount = {
    numberId: numberId ?? null,
    accessToken: globalIgToken(),
    username: null,
    accountId: null,
  };
  if (!numberId) return fallback;

  const { data } = await supabase
    .from("whatsapp_numbers")
    .select("id, access_token, instagram_username, instagram_account_id")
    .eq("id", numberId)
    .maybeSingle();

  if (data?.access_token) {
    return {
      numberId: data.id,
      accessToken: data.access_token,
      username: data.instagram_username ?? null,
      accountId: data.instagram_account_id ?? null,
    };
  }
  return fallback;
}
