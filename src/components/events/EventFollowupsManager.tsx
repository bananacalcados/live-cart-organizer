import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, MessageSquare, Instagram, Save } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Config = {
  id?: string;
  event_id: string;
  channel: "whatsapp" | "instagram";
  order_index: number;
  enabled: boolean;
  template_name: string | null;
  template_language: string;
  template_variables: Record<string, string>;
  whatsapp_number_id: string | null;
  message_text: string | null;
  buttons: { label: string; url?: string }[];
  delay_minutes: number;
  trigger_source: string;
  stop_on_reply: boolean;
  stop_on_paid: boolean;
};

const emptyWa = (event_id: string, order: number): Config => ({
  event_id, channel: "whatsapp", order_index: order, enabled: true,
  template_name: null, template_language: "pt_BR", template_variables: {},
  whatsapp_number_id: null, message_text: null, buttons: [],
  delay_minutes: 60, trigger_source: "auto", stop_on_reply: true, stop_on_paid: true,
});
const emptyIg = (event_id: string, order: number): Config => ({
  ...emptyWa(event_id, order), channel: "instagram", template_name: null, message_text: "",
});

export function EventFollowupsManager({ eventId }: { eventId: string }) {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [numbers, setNumbers] = useState<{ id: string; label: string }[]>([]);
  const [templates, setTemplates] = useState<{ name: string; language: string; category?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: cfgs }, { data: nums }] = await Promise.all([
        supabase.from("event_followup_configs").select("*").eq("event_id", eventId).order("order_index"),
        supabase.from("whatsapp_numbers_safe").select("id, display_name, phone_number").eq("is_active", true),
      ]);
      setConfigs((cfgs || []) as any);
      setNumbers((nums || []).map((n: any) => ({ id: n.id, label: n.display_name || n.phone_number })));
      try {
        const { data: tpl } = await supabase.functions.invoke("meta-whatsapp-get-templates", { body: { status: "APPROVED" } });
        if (tpl?.templates) {
          setTemplates(tpl.templates.map((t: any) => ({ name: t.name, language: t.language || "pt_BR", category: t.category })));
        }
      } catch { /* opcional */ }
      setLoading(false);
    })();
  }, [eventId]);

  const update = (idx: number, patch: Partial<Config>) => {
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const addConfig = (channel: "whatsapp" | "instagram") => {
    setConfigs((prev) => [...prev, channel === "whatsapp" ? emptyWa(eventId, prev.length) : emptyIg(eventId, prev.length)]);
  };

  const removeConfig = async (idx: number) => {
    const c = configs[idx];
    if (c.id) await supabase.from("event_followup_configs").delete().eq("id", c.id);
    setConfigs((prev) => prev.filter((_, i) => i !== idx));
    toast.success("Follow-up removido");
  };

  const saveAll = async () => {
    const payload = configs.map((c, i) => ({ ...c, order_index: i }));
    const { error } = await supabase.from("event_followup_configs").upsert(payload).select();
    if (error) return toast.error(`Erro: ${error.message}`);
    const { data: refreshed } = await supabase.from("event_followup_configs").select("*").eq("event_id", eventId).order("order_index");
    setConfigs((refreshed || []) as any);
    toast.success("Follow-ups salvos");
  };

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>;

  const wa = configs.filter((c) => c.channel === "whatsapp");
  const ig = configs.filter((c) => c.channel === "instagram");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Follow-ups do evento</h3>
          <p className="text-sm text-muted-foreground">
            Cadastre quantos follow-ups quiser. O sistema envia respeitando o atraso, para em resposta e para em pagamento.
          </p>
        </div>
        <Button onClick={saveAll}><Save className="w-4 h-4 mr-2" />Salvar tudo</Button>
      </div>

      <Tabs defaultValue="whatsapp">
        <TabsList>
          <TabsTrigger value="whatsapp"><MessageSquare className="w-4 h-4 mr-1" />WhatsApp ({wa.length})</TabsTrigger>
          <TabsTrigger value="instagram"><Instagram className="w-4 h-4 mr-1" />Instagram ({ig.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="space-y-3">
          {configs.map((c, i) => c.channel === "whatsapp" && (
            <ConfigCard key={c.id ?? `new-${i}`} config={c} idx={i} numbers={numbers} templates={templates}
                        onChange={(patch) => update(i, patch)} onRemove={() => removeConfig(i)} />
          ))}
          <Button variant="outline" onClick={() => addConfig("whatsapp")}><Plus className="w-4 h-4 mr-1" />Adicionar follow-up WhatsApp</Button>
        </TabsContent>

        <TabsContent value="instagram" className="space-y-3">
          {configs.map((c, i) => c.channel === "instagram" && (
            <ConfigCard key={c.id ?? `new-${i}`} config={c} idx={i} numbers={numbers} templates={templates}
                        onChange={(patch) => update(i, patch)} onRemove={() => removeConfig(i)} />
          ))}
          <Button variant="outline" onClick={() => addConfig("instagram")}><Plus className="w-4 h-4 mr-1" />Adicionar follow-up Instagram</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const c = category.toUpperCase();
  const map: Record<string, { label: string; cls: string }> = {
    UTILITY: { label: "UTILIDADE", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    MARKETING: { label: "MARKETING", cls: "bg-orange-100 text-orange-700 border-orange-200" },
    AUTHENTICATION: { label: "SERVIÇO", cls: "bg-green-100 text-green-700 border-green-200" },
    SERVICE: { label: "SERVIÇO", cls: "bg-green-100 text-green-700 border-green-200" },
  };
  const m = map[c] || { label: c, cls: "bg-muted text-muted-foreground border-border" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${m.cls}`}>{m.label}</span>;
}

function ConfigCard({
  config, idx, numbers, templates, onChange, onRemove,
}: {
  config: Config; idx: number;
  numbers: { id: string; label: string }[];
  templates: { name: string; language: string; category?: string }[];
  onChange: (patch: Partial<Config>) => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          #{idx + 1} — {config.channel === "whatsapp" ? "WhatsApp" : "Instagram DM"}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Ativo</Label>
          <Switch checked={config.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
          <Button variant="ghost" size="icon" onClick={onRemove}><Trash2 className="w-4 h-4 text-destructive" /></Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {config.channel === "whatsapp" ? (
          <>
            <div>
              <Label>Template Meta</Label>
              {templates.length ? (
                <Select value={config.template_name ?? ""} onValueChange={(v) => {
                  const t = templates.find((x) => x.name === v);
                  onChange({ template_name: v, template_language: t?.language || "pt_BR" });
                }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar template" /></SelectTrigger>
                  <SelectContent>{templates.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      <span className="flex items-center gap-2">
                        <span>{t.name}</span>
                        {t.category && <CategoryBadge category={t.category} />}
                      </span>
                    </SelectItem>
                  ))}</SelectContent>
                </Select>
              ) : (
                <Input value={config.template_name ?? ""} onChange={(e) => onChange({ template_name: e.target.value })} placeholder="nome_do_template" />
              )}
            </div>
            <div>
              <Label>Instância WhatsApp</Label>
              <Select value={config.whatsapp_number_id ?? "auto"} onValueChange={(v) => onChange({ whatsapp_number_id: v === "auto" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automática (mesma da 1ª mensagem da live)</SelectItem>
                  {numbers.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Variáveis do template (uma por linha, formato <code>1=Valor</code>)</Label>
              <Textarea
                rows={3}
                value={Object.entries(config.template_variables || {}).map(([k, v]) => `${k}=${v}`).join("\n")}
                onChange={(e) => {
                  const obj: Record<string, string> = {};
                  e.target.value.split("\n").forEach((l) => {
                    const [k, ...rest] = l.split("=");
                    if (k?.trim()) obj[k.trim()] = rest.join("=").trim();
                  });
                  onChange({ template_variables: obj });
                }}
                placeholder={"1=Oi tudo bem?\n2=Banana Calçados"}
              />
            </div>
          </>
        ) : (
          <>
            <div className="md:col-span-2">
              <Label>Mensagem DM</Label>
              <Textarea rows={3} value={config.message_text ?? ""} onChange={(e) => onChange({ message_text: e.target.value })}
                        placeholder="Ex.: Oi! Vi que você comentou na nossa live. Me passa seu WhatsApp?" />
            </div>
            <div className="md:col-span-2">
              <Label>Botões (opcional, um por linha: <code>Texto|https://url</code>)</Label>
              <Textarea rows={2}
                value={(config.buttons || []).map((b) => `${b.label}|${b.url || ""}`).join("\n")}
                onChange={(e) => {
                  const arr = e.target.value.split("\n").map((l) => {
                    const [label, url] = l.split("|");
                    return { label: (label || "").trim(), url: (url || "").trim() };
                  }).filter((b) => b.label);
                  onChange({ buttons: arr });
                }}
                placeholder={"Falar no WhatsApp|https://wa.me/5533..."}
              />
            </div>
          </>
        )}

        <div>
          <Label>Atraso (minutos)</Label>
          <Input type="number" min={1} value={config.delay_minutes}
                 onChange={(e) => onChange({ delay_minutes: parseInt(e.target.value || "0") || 0 })} />
        </div>
        <div>
          <Label>Contar a partir de</Label>
          <Select value={config.trigger_source} onValueChange={(v) => onChange({ trigger_source: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automático (resposta ou envio inicial)</SelectItem>
              <SelectItem value="initial_template">Envio do template inicial</SelectItem>
              <SelectItem value="last_customer_reply">Última resposta da cliente</SelectItem>
              <SelectItem value="incomplete_order_created">Criação do pedido incompleto</SelectItem>
              <SelectItem value="order_created">Criação do pedido</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={config.stop_on_reply} onCheckedChange={(v) => onChange({ stop_on_reply: v })} />
          <Label>Parar se cliente responder</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={config.stop_on_paid} onCheckedChange={(v) => onChange({ stop_on_paid: v })} />
          <Label>Parar se pedido for pago</Label>
        </div>
      </CardContent>
    </Card>
  );
}
