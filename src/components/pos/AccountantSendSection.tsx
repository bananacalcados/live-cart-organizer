import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Mail, Plus, Trash2, Send, Loader2, Download, History, ChevronDown, ChevronUp, Save } from "lucide-react";
import { format, subMonths } from "date-fns";

interface Company { id: string; trade_name: string | null; legal_name: string; cnpj: string }
interface Recipient { id: string; company_id: string; email: string; nome: string | null; ativo: boolean }
interface Config { company_id: string; auto_send_enabled: boolean; cc_emails: string[] }
interface HistoryRow {
  id: string; created_at: string; reference_month: string; trigger_type: string; status: string;
  recipients: string[]; cc: string[]; notes_count: number; storage_path: string | null; error: string | null; attempt: number;
}

const DEFAULT_CC = ["administrativo@bananacalcados.com"];
const PAGE = 10;
const STATUS_LABEL: Record<string, string> = { sent: "Enviado", failed: "Falhou", sem_notas: "Sem notas", processing: "Enviando…" };
const STATUS_CLS: Record<string, string> = {
  sent: "text-emerald-400", failed: "text-red-400", sem_notas: "text-zinc-400", processing: "text-amber-400",
};

async function fnError(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try { const b = await error.context.json(); return b?.error ? String(typeof b.error === "string" ? b.error : JSON.stringify(b.error)) : "Erro"; } catch { /* */ }
  }
  return error instanceof Error ? error.message : "Erro";
}

export function AccountantSendSection() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [configs, setConfigs] = useState<Record<string, Config>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, r, cfg] = await Promise.all([
      supabase.from("companies").select("id, trade_name, legal_name, cnpj").order("legal_name"),
      supabase.from("accountant_recipients").select("id, company_id, email, nome, ativo").order("created_at"),
      supabase.from("accountant_send_config").select("company_id, auto_send_enabled, cc_emails"),
    ]);
    if (r.error || cfg.error) toast.error("Sem permissão para ver os contadores (somente administradores).");
    setCompanies((c.data as Company[]) || []);
    setRecipients((r.data as Recipient[]) || []);
    const m: Record<string, Config> = {};
    for (const x of (cfg.data as Config[]) || []) m[x.company_id] = x;
    setConfigs(m);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="flex items-center gap-2 p-3 border-b border-zinc-800">
        <Mail className="h-4 w-4 text-orange-400" />
        <h3 className="font-bold text-sm">Contador / envio automático</h3>
        <span className="text-[11px] text-zinc-500 ml-2">Envio automático no 2º dia útil de cada mês, 08:00, com o pacote do mês anterior.</span>
      </header>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {companies.map((co) => (
            <CompanyBlock key={co.id} company={co}
              recipients={recipients.filter((r) => r.company_id === co.id)}
              config={configs[co.id]} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}

function CompanyBlock({ company, recipients, config, onChanged }: {
  company: Company; recipients: Recipient[]; config?: Config; onChanged: () => void;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [cc, setCc] = useState((config?.cc_emails ?? DEFAULT_CC).join(", "));
  const [month, setMonth] = useState(format(subMonths(new Date(), 1), "yyyy-MM"));
  const [sending, setSending] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [hist, setHist] = useState<HistoryRow[]>([]);
  const [histMore, setHistMore] = useState(false);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => { setCc((config?.cc_emails ?? DEFAULT_CC).join(", ")); }, [config?.cc_emails]);

  const loadHist = useCallback(async (offset: number) => {
    setHistLoading(true);
    const { data } = await supabase.from("accountant_send_history")
      .select("id, created_at, reference_month, trigger_type, status, recipients, cc, notes_count, storage_path, error, attempt")
      .eq("company_id", company.id).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
    const rows = (data as HistoryRow[]) || [];
    setHist((prev) => (offset === 0 ? rows : [...prev, ...rows]));
    setHistMore(rows.length === PAGE);
    setHistLoading(false);
  }, [company.id]);

  useEffect(() => { if (showHist) loadHist(0); }, [showHist, loadHist]);

  const saveConfig = async (patch: Partial<Config>) => {
    const ccList = cc.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from("accountant_send_config").upsert({
      company_id: company.id,
      auto_send_enabled: patch.auto_send_enabled ?? config?.auto_send_enabled ?? false,
      cc_emails: patch.cc_emails ?? ccList,
      updated_at: new Date().toISOString(),
    });
    if (error) toast.error(error.message); else { toast.success("Salvo"); onChanged(); }
  };

  const addRecipient = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("E-mail inválido"); return; }
    const { error } = await supabase.from("accountant_recipients").insert({ company_id: company.id, email, nome: newName.trim() || null });
    if (error) toast.error(error.message.includes("duplicate") ? "E-mail já cadastrado" : error.message);
    else { setNewEmail(""); setNewName(""); onChanged(); }
  };

  const updateRecipient = async (id: string, patch: Partial<Recipient>) => {
    const { error } = await supabase.from("accountant_recipients").update(patch).eq("id", id);
    if (error) toast.error(error.message); else onChanged();
  };
  const removeRecipient = async (id: string) => {
    if (!confirm("Remover este e-mail?")) return;
    const { error } = await supabase.from("accountant_recipients").delete().eq("id", id);
    if (error) toast.error(error.message); else onChanged();
  };

  const sendNow = async (force = false) => {
    if (!/^\d{4}-\d{2}$/.test(month)) { toast.error("Escolha o mês"); return; }
    setSending(true);
    const t = toast.loading("Gerando pacote e enviando…");
    try {
      const { data, error } = await supabase.functions.invoke("accountant-monthly-package", {
        body: { mode: "manual", company_id: company.id, reference_month: month, force },
      });
      if (error) { toast.error(await fnError(error), { id: t }); return; }
      if (data?.needs_confirmation) {
        toast.dismiss(t);
        if (confirm(`O mês ${month} já foi enviado para esta empresa. Enviar de novo?`)) await sendNow(true);
        return;
      }
      if (data?.status === "sent") toast.success("Enviado ao contador.", { id: t });
      else if (data?.status === "sem_notas") toast.info("Sem notas no mês — nada enviado.", { id: t });
      else toast.error(`Falhou: ${data?.error || "erro"}`, { id: t });
      if (showHist) loadHist(0);
    } finally {
      setSending(false);
    }
  };

  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from("accountant-packages").createSignedUrl(path, 300);
    if (error || !data) { toast.error("Não foi possível gerar o link"); return; }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-medium">{company.trade_name || company.legal_name}</div>
          <div className="text-xs text-zinc-500 font-mono">{company.cnpj}</div>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-300">
          Envio automático
          <Switch checked={!!config?.auto_send_enabled} onCheckedChange={(v) => saveConfig({ auto_send_enabled: v })} />
        </label>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-zinc-400">E-mails do contador</p>
        {recipients.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <Input defaultValue={r.email} className="h-8 w-64 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
              onBlur={(e) => { const v = e.target.value.trim().toLowerCase(); if (v && v !== r.email) updateRecipient(r.id, { email: v }); }} />
            <Input defaultValue={r.nome || ""} placeholder="Nome (opcional)" className="h-8 w-44 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.nome || "")) updateRecipient(r.id, { nome: v || null }); }} />
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <Switch checked={r.ativo} onCheckedChange={(v) => updateRecipient(r.id, { ativo: v })} /> ativo
            </label>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-400 hover:text-red-400" onClick={() => removeRecipient(r.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@contador.com.br"
            className="h-8 w-64 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" />
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome (opcional)"
            className="h-8 w-44 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" />
          <Button size="sm" variant="outline" onClick={addRecipient} className="h-8 gap-1 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">Cópia:</span>
        <Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-8 flex-1 min-w-[16rem] bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" />
        <Button size="sm" variant="outline" onClick={() => saveConfig({})} className="h-8 gap-1 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
          <Save className="h-3.5 w-3.5" /> Salvar cópia
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">Mês de referência:</span>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 w-40 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" />
        <Button size="sm" onClick={() => sendNow(false)} disabled={sending || !recipients.some((r) => r.ativo)}
          className="h-8 gap-1 bg-orange-500 hover:bg-orange-600 text-white">
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar agora
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowHist((v) => !v)} className="h-8 gap-1 text-zinc-300 ml-auto">
          <History className="h-3.5 w-3.5" /> Histórico {showHist ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      {showHist && (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="text-zinc-400">
              <tr className="border-b border-zinc-800">
                <th className="text-left p-2">Data</th><th className="text-left p-2">Mês ref.</th><th className="text-left p-2">Tipo</th>
                <th className="text-left p-2">Destinatários</th><th className="text-left p-2">Status</th>
                <th className="text-right p-2">Notas</th><th className="p-2">ZIP</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.id} className="border-b border-zinc-800/60 align-top">
                  <td className="p-2 whitespace-nowrap">{new Date(h.created_at).toLocaleString("pt-BR")}</td>
                  <td className="p-2">{h.reference_month}</td>
                  <td className="p-2">{h.trigger_type === "auto" ? `Automático (${h.attempt}ª)` : "Manual"}</td>
                  <td className="p-2">{[...h.recipients, ...h.cc.map((c) => `cc: ${c}`)].join(", ") || "—"}</td>
                  <td className={`p-2 ${STATUS_CLS[h.status] || ""}`}>
                    {STATUS_LABEL[h.status] || h.status}
                    {h.error && <div className="text-[10px] text-zinc-500 max-w-xs break-words">{h.error}</div>}
                  </td>
                  <td className="p-2 text-right">{h.notes_count}</td>
                  <td className="p-2 text-center">
                    {h.storage_path ? (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => download(h.storage_path!)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {!hist.length && !histLoading && <tr><td colSpan={7} className="text-center text-zinc-500 py-4">Nenhum envio ainda.</td></tr>}
            </tbody>
          </table>
          {histMore && (
            <div className="p-2 text-center">
              <Button size="sm" variant="ghost" disabled={histLoading} onClick={() => loadHist(hist.length)}>Carregar mais</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
