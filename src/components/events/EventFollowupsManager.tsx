import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, MessageSquare, Instagram, Save, Variable } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MetaTemplateConfigurator, AVAILABLE_TOKENS } from "./MetaTemplateConfigurator";

type Config = {
  id?: string;
  event_id: string;
  channel: "whatsapp" | "instagram";
  order_index: number;
  enabled: boolean;
  template_name: string | null;
  template_language: string;
  // Storage shape: { "1": token, "2": token, ..., "__header": token }
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
  const [eventWaId, setEventWaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: cfgs }, { data: nums }, { data: ev }] = await Promise.all([
        supabase.from("event_followup_configs").select("*").eq("event_id", eventId).order("order_index"),
        supabase.from("whatsapp_numbers_safe").select("id, display_name, phone_number").eq("is_active", true),
        supabase.from("events").select("whatsapp_number_id").eq("id", eventId).maybeSingle(),
      ]);
      setConfigs((cfgs || []) as any);
      setNumbers((nums || []).map((n: any) => ({ id: n.id, label: n.display_name || n.phone_number })));
      setEventWaId((ev as any)?.whatsapp_number_id ?? null);
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
            <ConfigCard key={c.id ?? `new-${i}`} config={c} idx={i} numbers={numbers} eventWaId={eventWaId}
                        onChange={(patch) => update(i, patch)} onRemove={() => removeConfig(i)} />
          ))}
          <Button variant="outline" onClick={() => addConfig("whatsapp")}><Plus className="w-4 h-4 mr-1" />Adicionar follow-up WhatsApp</Button>
        </TabsContent>

        <TabsContent value="instagram" className="space-y-3">
          {configs.map((c, i) => c.channel === "instagram" && (
            <ConfigCard key={c.id ?? `new-${i}`} config={c} idx={i} numbers={numbers} eventWaId={eventWaId}
                        onChange={(patch) => update(i, patch)} onRemove={() => removeConfig(i)} />
          ))}
          <Button variant="outline" onClick={() => addConfig("instagram")}><Plus className="w-4 h-4 mr-1" />Adicionar follow-up Instagram</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Convert legacy/new template_variables object to (bodyVariables[], headerVariable)
const varsToArrays = (vars: Record<string, string>) => {
  const header = vars?.__header ?? null;
  const numeric: [number, string][] = Object.entries(vars || {})
    .filter(([k]) => /^\d+$/.test(k))
    .map(([k, v]) => [parseInt(k, 10), v] as [number, string])
    .sort((a, b) => a[0] - b[0]);
  const max = numeric.length ? numeric[numeric.length - 1][0] : 0;
  const body: string[] = Array.from({ length: max }, () => "");
  numeric.forEach(([i, v]) => { body[i - 1] = v; });
  return { body, header };
};

const arraysToVars = (body: string[], header: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  body.forEach((v, i) => { if (v !== undefined && v !== null) out[String(i + 1)] = v; });
  if (header) out.__header = header;
  return out;
};

function ConfigCard({
  config, idx, numbers, eventWaId, onChange, onRemove,
}: {
  config: Config; idx: number;
  numbers: { id: string; label: string }[];
  eventWaId: string | null;
  onChange: (patch: Partial<Config>) => void;
  onRemove: () => void;
}) {
  const igTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { body: bodyVars, header: headerVar } = useMemo(
    () => varsToArrays(config.template_variables || {}),
    [config.template_variables],
  );

  const effectiveWaId = config.whatsapp_number_id || eventWaId;

  const insertIgToken = (token: string) => {
    const el = igTextareaRef.current;
    const current = config.message_text ?? "";
    if (!el) return onChange({ message_text: current + token });
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onChange({ message_text: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

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
            <div className="md:col-span-2">
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
              <MetaTemplateConfigurator
                whatsappNumberId={effectiveWaId}
                templateName={config.template_name}
                language={config.template_language || "pt_BR"}
                bodyVariables={bodyVars}
                headerVariable={headerVar}
                onChange={({ templateName, language, bodyVariables, headerVariable }) => {
                  onChange({
                    template_name: templateName,
                    template_language: language,
                    template_variables: arraysToVars(bodyVariables, headerVariable),
                  });
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Mensagem DM</Label>
                <Select value="" onValueChange={insertIgToken}>
                  <SelectTrigger className="w-[240px] h-8">
                    <SelectValue placeholder={<span className="flex items-center gap-1 text-xs"><Variable className="h-3 w-3" /> Inserir variável</span> as any} />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_TOKENS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <code className="text-xs">{t.value}</code> — {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                ref={igTextareaRef as any}
                rows={4}
                value={config.message_text ?? ""}
                onChange={(e) => onChange({ message_text: e.target.value })}
                placeholder={"Ex.: Oi {customer_first_name}! Vi que você comentou na nossa live. Segue o link: {checkout_link}"}
              />
              <p className="text-xs text-muted-foreground">
                Variáveis disponíveis: {AVAILABLE_TOKENS.map((t) => t.value).join(", ")}
              </p>
            </div>
            <div className="md:col-span-2">
              <Label>Botões (opcional, um por linha: <code>Texto|https://url</code>) — aceita variáveis na URL</Label>
              <Textarea rows={2}
                value={(config.buttons || []).map((b) => `${b.label}|${b.url || ""}`).join("\n")}
                onChange={(e) => {
                  const arr = e.target.value.split("\n").map((l) => {
                    const [label, url] = l.split("|");
                    return { label: (label || "").trim(), url: (url || "").trim() };
                  }).filter((b) => b.label);
                  onChange({ buttons: arr });
                }}
                placeholder={"Comprar agora|{checkout_link}"}
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
