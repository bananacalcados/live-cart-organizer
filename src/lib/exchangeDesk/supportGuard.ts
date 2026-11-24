export type SupportGuardStatus = {
  mode: string; shadow_auto: boolean; shadow_reason: string | null; shadow_at: string | null;
  paused: { id: string; name: string; until: string; reason: string }[];
  triage_total: number; triage_failed: number; alert_configured: boolean;
  budget_used?: number; budget_limit?: number;
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** Linhas do aviso fixo. Sombra manual não gera aviso (foi decisão da equipe). */
export function supportGuardLines(s: SupportGuardStatus | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.mode === "shadow" && s.shadow_auto) {
    out.push(`Respostas automáticas PAUSADAS desde ${s.shadow_at ? hhmm(s.shadow_at) : "agora"}: ${s.shadow_reason || "motivo não informado"}.`
      + (s.alert_configured ? " Volta sozinho em 30 min se estiver tudo certo." : " Volta só manualmente (número de alerta não configurado)."));
  }
  for (const p of s.paused || []) out.push(`Canal ${p.name} pausado até ${hhmm(p.until)}: ${p.reason}`);
  if (s.triage_total >= 4 && s.triage_failed * 2 > s.triage_total) out.push(`Triagem da IA falhando: ${s.triage_failed} de ${s.triage_total} nos últimos 15 min.`);
  const used = Number(s.budget_used ?? 0), lim = Number(s.budget_limit ?? 0);
  if (lim > 0 && used >= lim) out.push(`Teto diário da IA atingido (${used.toLocaleString("pt-BR")} de ${lim.toLocaleString("pt-BR")}): mensagens novas vão para Em suporte até a meia-noite.`);
  else if (lim > 0 && used >= lim * 0.8) out.push(`IA já usou ${Math.round((used / lim) * 100)}% do teto diário (${used.toLocaleString("pt-BR")} de ${lim.toLocaleString("pt-BR")}).`);
  return out;
}
