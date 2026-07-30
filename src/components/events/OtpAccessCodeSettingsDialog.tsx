import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { KeyRound, Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";

interface WaNumber { id: string; label: string; phone_display: string; provider: string | null }
interface MetaTemplate { name: string; language: string; status: string }

/**
 * Configuração global do código de acesso (OTP eterno) enviado por WhatsApp.
 * O código é permanente por telefone — o template só precisa de 1 variável.
 */
export function OtpAccessCodeSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [waId, setWaId] = useState<string>("default");
  const [templateName, setTemplateName] = useState<string>("none");
  const [language, setLanguage] = useState("pt_BR");
  const [varIndex, setVarIndex] = useState("1");
  const [copyButton, setCopyButton] = useState(false);
  const [fallback, setFallback] = useState(true);

  // Consulta de código por telefone
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupCode, setLookupCode] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [{ data: nums }, { data: cfg }] = await Promise.all([
        supabase.from("whatsapp_numbers").select("id, label, phone_display, provider").eq("is_active", true),
        supabase.from("otp_template_settings" as any).select("*").eq("id", true).maybeSingle(),
      ]);
      setNumbers(((nums as any[]) || []).filter((n) => (n.provider || "meta") === "meta") as WaNumber[]);
      const c = cfg as any;
      if (c) {
        setWaId(c.whatsapp_number_id || "default");
        setTemplateName(c.template_name || "none");
        setLanguage(c.template_language || "pt_BR");
        setVarIndex(String(c.code_variable_index ?? 1));
        setCopyButton(Boolean(c.copy_code_button));
        setFallback(c.fallback_to_text !== false);
      }
      setLoading(false);
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId: waId === "default" ? undefined : waId, status: "APPROVED" },
      });
      setTemplates(((data as any)?.data || (data as any)?.templates || []) as MetaTemplate[]);
    })();
  }, [open, waId]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("otp_template_settings" as any).upsert({
      id: true,
      whatsapp_number_id: waId === "default" ? null : waId,
      template_name: templateName === "none" ? null : templateName,
      template_language: language,
      code_variable_index: Math.max(1, parseInt(varIndex, 10) || 1),
      copy_code_button: copyButton,
      fallback_to_text: fallback,
      updated_at: new Date().toISOString(),
    } as any);
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error.message);
    else toast.success("Configuração do código de acesso salva!");
  };

  const lookup = async () => {
    const { data, error } = await supabase.rpc("get_or_create_customer_access_code" as any, {
      _phone: lookupPhone,
    } as any);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Telefone inválido");
    setLookupCode(String(data));
  };

  const changeCode = async () => {
    const { data, error } = await supabase.rpc("set_customer_access_code" as any, {
      _phone: lookupPhone, _code: newCode,
    } as any);
    if (error) return toast.error(error.message);
    setLookupCode(String(data));
    setNewCode("");
    toast.success("Código alterado!");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline" className="gap-2 font-bold">
          <KeyRound className="h-4 w-4" /> CÓDIGO DE ACESSO (OTP)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Código de acesso do cliente (OTP fixo)
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              O código é <strong>permanente</strong>: uma vez gerado para um telefone, ele nunca muda —
              só se você alterar manualmente aqui. Configure abaixo o template da Meta API usado no envio;
              a variável escolhida recebe o código.
            </p>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Instância de WhatsApp (Meta API)</Label>
              <Select value={waId} onValueChange={setWaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Instância padrão</SelectItem>
                  {numbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.label} <span className="text-muted-foreground ml-1">({n.phone_display})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Template aprovado</Label>
                <Select
                  value={templateName}
                  onValueChange={(v) => {
                    setTemplateName(v);
                    const t = templates.find((x) => x.name === v);
                    if (t?.language) setLanguage(t.language);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione o template..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (mensagem de texto simples)</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                        {t.name} ({t.language})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Posição da variável do código</Label>
                <Input
                  type="number" min={1} value={varIndex}
                  onChange={(e) => setVarIndex(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Ex.: se o corpo é "Seu código é {"{{1}}"}", use 1.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-semibold">Template de autenticação com botão "Copiar código"</p>
                <p className="text-xs text-muted-foreground">Ative só se o template tiver esse botão.</p>
              </div>
              <Switch checked={copyButton} onCheckedChange={setCopyButton} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-semibold">Fallback por mensagem de texto</p>
                <p className="text-xs text-muted-foreground">
                  Se o template falhar, envia o código como texto (só dentro da janela de 24h).
                </p>
              </div>
              <Switch checked={fallback} onCheckedChange={setFallback} />
            </div>

            <Button onClick={save} disabled={saving} className="w-full gap-2 font-bold">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              SALVAR CONFIGURAÇÃO
            </Button>

            <div className="rounded-xl border p-4 space-y-3">
              <p className="text-sm font-bold">Consultar / alterar código de um cliente</p>
              <div className="flex gap-2">
                <Input
                  placeholder="(33) 90000-1111"
                  value={lookupPhone}
                  onChange={(e) => setLookupPhone(e.target.value)}
                />
                <Button onClick={lookup} variant="secondary" className="gap-2">
                  <Search className="h-4 w-4" /> Buscar
                </Button>
              </div>
              {lookupCode && (
                <div className="space-y-2">
                  <p className="text-sm">
                    Código atual: <span className="font-mono text-lg font-black">{lookupCode}</span>
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Novo código (4 a 8 dígitos)"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    />
                    <Button onClick={changeCode} disabled={newCode.length < 4} variant="outline">
                      Alterar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
