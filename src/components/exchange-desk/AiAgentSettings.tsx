// Fase 4b — configurações da IA de suporte, roteiro editável (com versões) e contador de acertos.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { deskCall } from "./api";

type Settings = { enabled: boolean; triage_model: string; agent_model: string; max_calls: number; is_admin: boolean; calls_7d: number; failures_7d: number };
type Script = { version: number; body: string; note: string | null; created_at: string };
type Acc = { tipo: string; acertos: number; erros: number; abertas: number };
const TIPO: Record<string, string> = { troca: "Troca", devolucao: "Devolução", troca_ou_devolucao_ambiguo: "Ambíguo", outro_suporte: "Outro suporte", indefinido: "Indefinido" };

export function AiAgentSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [script, setScript] = useState<{ current: Script | null; history: Script[] } | null>(null);
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [acc, setAcc] = useState<Acc[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [a, b, c] = await Promise.all([
      deskCall<Settings>("support_ai_settings_get", {}),
      deskCall<{ current: Script | null; history: Script[] }>("support_agent_script_get", {}),
      deskCall<Acc[]>("support_ai_accuracy", {}),
    ]);
    setS(a); setScript(b); setBody(b?.current?.body || ""); setAcc(c || []);
  };
  useEffect(() => { load().catch((e) => toast.error(e instanceof Error ? e.message : "Erro")); }, []);

  const saveSettings = async () => {
    if (!s) return; setBusy(true);
    try { await deskCall("support_ai_settings_update", { p_enabled: s.enabled, p_triage_model: s.triage_model, p_agent_model: s.agent_model, p_max_calls: s.max_calls }); toast.success("Salvo"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setBusy(false); }
  };
  const saveScript = async () => {
    setBusy(true);
    try { const v = await deskCall<number>("support_agent_script_save", { p_body: body, p_note: note || null }); toast.success(`Roteiro salvo (versão ${v})`); setNote(""); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setBusy(false); }
  };

  const tot = acc.reduce((t, a) => ({ ok: t.ok + a.acertos, er: t.er + a.erros }), { ok: 0, er: 0 });
  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">IA de suporte</span>
        <span className="text-sm">Acertos {tot.ok} · Erros {tot.er}{tot.ok + tot.er > 0 ? ` (${Math.round((tot.ok / (tot.ok + tot.er)) * 100)}%)` : ""}</span>
        {acc.map((a) => <span key={a.tipo} className="text-xs text-muted-foreground">{TIPO[a.tipo] || a.tipo}: {a.acertos}✓ {a.erros}✗</span>)}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Roteiro e IA"}</Button>
      </div>
      {open && s && (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4 items-end">
            <label className="flex items-center gap-2 text-sm"><Switch checked={s.enabled} disabled={!s.is_admin} onCheckedChange={(v) => setS({ ...s, enabled: v })} /> IA ligada</label>
            <label className="text-sm">Modelo da triagem<Input value={s.triage_model} disabled={!s.is_admin} onChange={(e) => setS({ ...s, triage_model: e.target.value })} /></label>
            <label className="text-sm">Modelo do agente<Input value={s.agent_model} disabled={!s.is_admin} onChange={(e) => setS({ ...s, agent_model: e.target.value })} /></label>
            <label className="text-sm">Máx. chamadas por conversa/dia<Input type="number" value={s.max_calls} disabled={!s.is_admin} onChange={(e) => setS({ ...s, max_calls: Number(e.target.value) })} /></label>
          </div>
          <p className="text-xs text-muted-foreground">Últimos 7 dias: {s.calls_7d} chamadas, {s.failures_7d} falhas. Se a IA falhar, entra a regra por palavras.</p>
          {s.is_admin && <Button size="sm" disabled={busy} onClick={saveSettings}>Salvar configurações</Button>}
          <div className="space-y-2">
            <p className="text-sm font-medium">Roteiro do agente {script?.current ? `(versão ${script.current.version})` : ""}</p>
            <Textarea rows={14} value={body} disabled={!s.is_admin} onChange={(e) => setBody(e.target.value)} />
            {s.is_admin && (
              <div className="flex gap-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que mudou? (opcional)" autoComplete="off" />
                <Button disabled={busy || body === script?.current?.body} onClick={saveScript}>Salvar nova versão</Button>
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer">Versões anteriores</summary>
              {script?.history.map((h) => (
                <div key={h.version} className="flex items-center gap-2 py-1">
                  <span>v{h.version} · {new Date(h.created_at).toLocaleString("pt-BR")} {h.note ? `· ${h.note}` : ""}</span>
                  {s.is_admin && <Button size="sm" variant="ghost" onClick={() => setBody(h.body)}>Usar este texto</Button>}
                </div>
              ))}
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
