import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Bot, RefreshCw, Send, Plus, Copy, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AuthorizedUser {
  chat_id: string;
  display_name: string | null;
  role: string;
  active: boolean;
  created_at: string;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
}

export function FinancialAgentSettings() {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ webhook?: WebhookInfo; bot?: { username?: string; first_name?: string } } | null>(null);
  const [users, setUsers] = useState<AuthorizedUser[]>([]);
  const [invite, setInvite] = useState<{ token: string; deep_link: string | null; expires_at: string } | null>(null);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-financial-admin", {
        body: { action: "webhook_info" },
      });
      if (error) throw error;
      setInfo(data);
    } catch (e: any) {
      toast.error("Falha ao carregar status: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    const { data } = await (supabase as any).from("financial_agent_authorized_users").select("*").order("created_at", { ascending: false });
    setUsers((data as any) || []);
  };

  useEffect(() => { loadInfo(); loadUsers(); }, []);

  const registerWebhook = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-financial-admin", { body: { action: "register_webhook" } });
      if (error) throw error;
      if (data.ok) toast.success("Webhook registrado com sucesso");
      else toast.error("Telegram retornou erro: " + JSON.stringify(data.telegram));
      await loadInfo();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  };

  const createInvite = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-financial-admin", { body: { action: "create_invite" } });
      if (error) throw error;
      setInvite(data);
      toast.success("Convite gerado (válido 10 min)");
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  };

  const toggleUser = async (u: AuthorizedUser) => {
    await (supabase as any).from("financial_agent_authorized_users").update({ active: !u.active }).eq("chat_id", u.chat_id);
    await loadUsers();
  };

  const removeUser = async (u: AuthorizedUser) => {
    if (!confirm(`Remover ${u.display_name || u.chat_id}?`)) return;
    await (supabase as any).from("financial_agent_authorized_users").delete().eq("chat_id", u.chat_id);
    await loadUsers();
  };

  const webhookOk = info?.webhook?.url && !info.webhook.last_error_message;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> Agente Financeiro (Telegram)
            {info?.bot?.username && <Badge variant="outline" className="ml-2">@{info.bot.username}</Badge>}
            <Button variant="ghost" size="icon" className="ml-auto" onClick={() => { loadInfo(); loadUsers(); }} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {webhookOk ? (
              <><CheckCircle2 className="h-4 w-4 text-green-600" /> Webhook ativo</>
            ) : (
              <><AlertCircle className="h-4 w-4 text-amber-600" /> Webhook não registrado ou com erro</>
            )}
          </div>
          {info?.webhook?.url && (
            <div className="text-xs text-muted-foreground break-all rounded-md border bg-muted/30 p-2">
              {info.webhook.url}
              {info.webhook.last_error_message && (
                <div className="mt-1 text-destructive">Último erro: {info.webhook.last_error_message}</div>
              )}
            </div>
          )}
          <Button onClick={registerWebhook} disabled={loading} size="sm">
            <Send className="h-3.5 w-3.5 mr-1" /> Registrar / Atualizar Webhook
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Usuários autorizados
            <Button size="sm" variant="outline" className="ml-auto" onClick={createInvite} disabled={loading}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Gerar convite
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {invite && (
            <div className="rounded-md border bg-primary/5 p-3 text-sm space-y-2">
              <div className="font-medium">Convite (expira em 10 min)</div>
              <div className="flex gap-2 items-center">
                <Input readOnly value={invite.deep_link || `/start ${invite.token}`} className="text-xs" />
                <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(invite.deep_link || invite.token); toast.success("Copiado"); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Abra o link no Telegram (ou envie <code>/start {invite.token}</code> ao bot).</p>
            </div>
          )}
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário autorizado. Gere um convite e abra no Telegram.</p>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.chat_id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{u.display_name || "(sem nome)"}</div>
                    <div className="text-xs text-muted-foreground">chat_id: {u.chat_id} · {u.role}</div>
                  </div>
                  <Badge variant={u.active ? "default" : "outline"}>{u.active ? "Ativo" : "Pausado"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => toggleUser(u)}>{u.active ? "Pausar" : "Ativar"}</Button>
                  <Button size="icon" variant="ghost" onClick={() => removeUser(u)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Próximos passos</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Parser de comprovantes (foto/PDF) com OCR + categorização IA</p>
          <p>• Importadores XLSX (collection MP, account_statement), OFX e CSV</p>
          <p>• Motor de conciliação automática (PDV ↔ cartão ↔ extrato)</p>
          <p>• Painel de "Recebíveis órfãos" e auditoria de mensagens</p>
        </CardContent>
      </Card>
    </div>
  );
}
