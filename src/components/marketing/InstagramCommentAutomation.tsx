import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Instagram, Plus, Trash2, MessageSquare, Send, Zap, Save,
  ToggleLeft, ToggleRight, Edit, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface Rule {
  id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  trigger_keywords: string[];
  media_types: string[];
  action_reply_comment: boolean;
  reply_comment_text: string | null;
  action_send_dm: boolean;
  dm_message_text: string | null;
  action_trigger_automation: boolean;
  automation_flow_id: string | null;
  cooldown_minutes: number;
  ai_generate_reply: boolean;
  ai_prompt: string | null;
  created_at: string;
}

interface Flow {
  id: string;
  name: string;
}

export default function InstagramCommentAutomation() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: "",
    trigger_type: "keyword",
    trigger_keywords: "",
    media_types: ["post", "REELS"],
    action_reply_comment: false,
    reply_comment_text: "",
    action_send_dm: false,
    dm_message_text: "",
    action_trigger_automation: false,
    automation_flow_id: "",
    cooldown_minutes: 60,
  });

  useEffect(() => {
    loadRules();
    loadFlows();
  }, []);

  async function loadRules() {
    const { data } = await supabase
      .from("instagram_comment_rules")
      .select("*")
      .order("created_at", { ascending: false });
    setRules((data as Rule[]) || []);
    setLoading(false);
  }

  async function loadFlows() {
    const { data } = await supabase
      .from("automation_flows")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    setFlows((data as Flow[]) || []);
  }

  function openNew() {
    setEditingRule(null);
    setForm({
      name: "",
      trigger_type: "keyword",
      trigger_keywords: "",
      media_types: ["post", "REELS"],
      action_reply_comment: false,
      reply_comment_text: "",
      action_send_dm: false,
      dm_message_text: "",
      action_trigger_automation: false,
      automation_flow_id: "",
      cooldown_minutes: 60,
    });
    setShowDialog(true);
  }

  function openEdit(rule: Rule) {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      trigger_type: rule.trigger_type,
      trigger_keywords: rule.trigger_keywords.join(", "),
      media_types: rule.media_types,
      action_reply_comment: rule.action_reply_comment,
      reply_comment_text: rule.reply_comment_text || "",
      action_send_dm: rule.action_send_dm,
      dm_message_text: rule.dm_message_text || "",
      action_trigger_automation: rule.action_trigger_automation,
      automation_flow_id: rule.automation_flow_id || "",
      cooldown_minutes: rule.cooldown_minutes,
    });
    setShowDialog(true);
  }

  async function saveRule() {
    if (!form.name.trim()) {
      toast.error("Nome da regra é obrigatório");
      return;
    }

    const payload = {
      name: form.name.trim(),
      trigger_type: form.trigger_type,
      trigger_keywords: form.trigger_keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      media_types: form.media_types,
      action_reply_comment: form.action_reply_comment,
      reply_comment_text: form.reply_comment_text || null,
      action_send_dm: form.action_send_dm,
      dm_message_text: form.dm_message_text || null,
      action_trigger_automation: form.action_trigger_automation,
      automation_flow_id: form.automation_flow_id || null,
      cooldown_minutes: form.cooldown_minutes,
    };

    if (editingRule) {
      const { error } = await supabase
        .from("instagram_comment_rules")
        .update(payload)
        .eq("id", editingRule.id);
      if (error) {
        toast.error("Erro ao atualizar regra");
        return;
      }
      toast.success("Regra atualizada!");
    } else {
      const { error } = await supabase
        .from("instagram_comment_rules")
        .insert(payload);
      if (error) {
        toast.error("Erro ao criar regra");
        return;
      }
      toast.success("Regra criada!");
    }

    setShowDialog(false);
    loadRules();
  }

  async function toggleActive(rule: Rule) {
    await supabase
      .from("instagram_comment_rules")
      .update({ is_active: !rule.is_active })
      .eq("id", rule.id);
    loadRules();
  }

  async function deleteRule(id: string) {
    if (!confirm("Excluir esta regra?")) return;
    await supabase.from("instagram_comment_rules").delete().eq("id", id);
    toast.success("Regra excluída");
    loadRules();
  }

  function toggleMediaType(type: string) {
    setForm((prev) => ({
      ...prev,
      media_types: prev.media_types.includes(type)
        ? prev.media_types.filter((t) => t !== type)
        : [...prev.media_types, type],
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Instagram className="h-5 w-5 text-pink-500" />
            Automação de Comentários
          </h3>
          <p className="text-sm text-muted-foreground">
            Responda automaticamente comentários em Posts, Reels e Lives
          </p>
        </div>
        <Button onClick={openNew} size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> Nova Regra
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Carregando...</p>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Instagram className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Nenhuma regra de automação criada</p>
            <p className="text-xs mt-1">Crie regras para responder comentários automaticamente</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className={`transition-all ${!rule.is_active ? "opacity-60" : ""}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={() => toggleActive(rule)}
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{rule.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {rule.trigger_type === "keyword" && rule.trigger_keywords.length > 0 ? (
                          rule.trigger_keywords.slice(0, 3).map((kw) => (
                            <Badge key={kw} variant="outline" className="text-[10px] py-0">
                              {kw}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-[10px] py-0">
                            Todos comentários
                          </Badge>
                        )}
                        {rule.trigger_keywords.length > 3 && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            +{rule.trigger_keywords.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {rule.action_reply_comment && (
                      <Badge className="bg-blue-500/10 text-blue-500 text-[10px] py-0">
                        <MessageSquare className="h-2.5 w-2.5 mr-0.5" />
                        Resposta
                      </Badge>
                    )}
                    {rule.action_send_dm && (
                      <Badge className="bg-pink-500/10 text-pink-500 text-[10px] py-0">
                        <Send className="h-2.5 w-2.5 mr-0.5" />
                        DM
                      </Badge>
                    )}
                    {rule.action_trigger_automation && (
                      <Badge className="bg-amber-500/10 text-amber-500 text-[10px] py-0">
                        <Zap className="h-2.5 w-2.5 mr-0.5" />
                        Fluxo
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                    >
                      {expandedId === rule.id ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {expandedId === rule.id && (
                  <div className="mt-3 pt-3 border-t space-y-2 text-xs text-muted-foreground">
                    <div className="flex gap-1.5">
                      <span className="font-medium">Mídias:</span>
                      {rule.media_types.map((mt) => (
                        <Badge key={mt} variant="secondary" className="text-[10px]">
                          {mt === "REELS" ? "Reels" : mt}
                        </Badge>
                      ))}
                    </div>
                    {rule.action_reply_comment && rule.reply_comment_text && (
                      <div>
                        <span className="font-medium">Resposta pública:</span>{" "}
                        {rule.reply_comment_text}
                      </div>
                    )}
                    {rule.action_send_dm && rule.dm_message_text && (
                      <div>
                        <span className="font-medium">DM:</span>{" "}
                        {rule.dm_message_text}
                      </div>
                    )}
                    <div>
                      <span className="font-medium">Cooldown:</span>{" "}
                      {rule.cooldown_minutes} min por usuário
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(rule)}>
                        <Edit className="h-3 w-3 mr-1" /> Editar
                      </Button>
                      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => deleteRule(rule.id)}>
                        <Trash2 className="h-3 w-3 mr-1" /> Excluir
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Dialog: Create/Edit Rule ── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Instagram className="h-5 w-5 text-pink-500" />
              {editingRule ? "Editar Regra" : "Nova Regra de Automação"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Nome da Regra</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Responder pedidos nos Reels"
              />
            </div>

            <div>
              <Label>Tipo de Gatilho</Label>
              <Select
                value={form.trigger_type}
                onValueChange={(v) => setForm({ ...form, trigger_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword">Por Palavras-chave</SelectItem>
                  <SelectItem value="all">Todos os Comentários</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.trigger_type === "keyword" && (
              <div>
                <Label>Palavras-chave (separadas por vírgula)</Label>
                <Input
                  value={form.trigger_keywords}
                  onChange={(e) => setForm({ ...form, trigger_keywords: e.target.value })}
                  placeholder="quero, comprar, preço, tamanho, pix"
                />
              </div>
            )}

            <div>
              <Label className="mb-2 block">Tipos de Mídia</Label>
              <div className="flex gap-2">
                {[
                  { value: "post", label: "Posts" },
                  { value: "REELS", label: "Reels" },
                  { value: "IGTV", label: "IGTV" },
                ].map(({ value, label }) => (
                  <Badge
                    key={value}
                    variant={form.media_types.includes(value) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleMediaType(value)}
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <Label>Cooldown (minutos por usuário)</Label>
              <Input
                type="number"
                value={form.cooldown_minutes}
                onChange={(e) => setForm({ ...form, cooldown_minutes: parseInt(e.target.value) || 60 })}
              />
            </div>

            <hr />

            {/* Action: Reply Comment */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.action_reply_comment}
                  onCheckedChange={(v) => setForm({ ...form, action_reply_comment: v })}
                />
                <Label className="flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  Responder no Comentário (público)
                </Label>
              </div>
              {form.action_reply_comment && (
                <Textarea
                  value={form.reply_comment_text}
                  onChange={(e) => setForm({ ...form, reply_comment_text: e.target.value })}
                  placeholder="Oi {username}! Que bom que gostou! 💕 Vou te chamar no direct!"
                  className="text-sm"
                  rows={2}
                />
              )}
            </div>

            {/* Action: Send DM */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.action_send_dm}
                  onCheckedChange={(v) => setForm({ ...form, action_send_dm: v })}
                />
                <Label className="flex items-center gap-1.5">
                  <Send className="h-4 w-4 text-pink-500" />
                  Enviar DM Privada
                </Label>
              </div>
              {form.action_send_dm && (
                <Textarea
                  value={form.dm_message_text}
                  onChange={(e) => setForm({ ...form, dm_message_text: e.target.value })}
                  placeholder="Oi {username}! Vi que você comentou no nosso post 💕 Posso te ajudar com alguma coisa?"
                  className="text-sm"
                  rows={3}
                />
              )}
            </div>

            {/* Action: Trigger Automation */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.action_trigger_automation}
                  onCheckedChange={(v) => setForm({ ...form, action_trigger_automation: v })}
                />
                <Label className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Disparar Fluxo de Automação
                </Label>
              </div>
              {form.action_trigger_automation && (
                <Select
                  value={form.automation_flow_id}
                  onValueChange={(v) => setForm({ ...form, automation_flow_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o fluxo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {flows.map((flow) => (
                      <SelectItem key={flow.id} value={flow.id}>
                        {flow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Variáveis disponíveis: <code>{"{username}"}</code> (nome do usuário), <code>{"{comment}"}</code> (texto do comentário)
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveRule} className="gap-1">
              <Save className="h-4 w-4" />
              {editingRule ? "Salvar" : "Criar Regra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
