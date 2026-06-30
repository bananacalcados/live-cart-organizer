import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Instagram, Plus, Trash2, MessageSquare, Send, Zap, Save,
  Edit, ChevronDown, ChevronUp, Image as ImageIcon, Loader2, Target, RefreshCw
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

interface DmButton {
  label: string;
  type: "link" | "reply";
  url?: string;
  tags?: string[];
  reply_message?: string;
  flow_id?: string;
}

interface Rule {
  id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  trigger_keywords: string[];
  media_types: string[];
  action_reply_comment: boolean;
  reply_comment_text: string | null;
  reply_comment_variations: string[] | null;
  action_send_dm: boolean;
  dm_message_text: string | null;
  dm_buttons: DmButton[] | null;
  action_trigger_automation: boolean;
  automation_flow_id: string | null;
  cooldown_minutes: number;
  ai_generate_reply: boolean;
  ai_prompt: string | null;
  target_media_id: string | null;
  target_media_caption: string | null;
  action_capture_lead: boolean;
  capture_event_id: string | null;
  capture_mode: string | null;
  capture_fallback_dm_text: string | null;
  created_at: string;
}

interface Flow {
  id: string;
  name: string;
}

interface EventOpt {
  id: string;
  name: string;
  event_date: string | null;
}

interface MediaItem {
  id: string;
  caption: string | null;
  media_type: string | null;
  media_product_type: string | null;
  thumbnail: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export default function InstagramCommentAutomation() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Media picker state (for per-post targeting)
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<
    "all" | "post" | "reels" | "story" | "carousel"
  >("all");

  // Form state
  const [form, setForm] = useState({
    name: "",
    trigger_type: "keyword",
    trigger_keywords: "",
    media_types: ["post", "REELS"],
    action_reply_comment: false,
    reply_comment_text: "",
    reply_comment_variations: [] as string[],
    action_send_dm: false,
    dm_message_text: "",
    dm_buttons: [] as DmButton[],
    action_trigger_automation: false,
    automation_flow_id: "",
    cooldown_minutes: 60,
    target_media_id: "",
    target_media_caption: "",
    action_capture_lead: false,
    capture_event_id: "",
    capture_mode: "phone",
    capture_fallback_dm_text: "",
  });

  useEffect(() => {
    loadRules();
    loadFlows();
    loadEvents();
  }, []);

  async function loadRules() {
    const { data } = await supabase
      .from("instagram_comment_rules")
      .select("*")
      .order("created_at", { ascending: false });
    setRules((data as unknown as Rule[]) || []);
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

  async function loadEvents() {
    const { data } = await supabase
      .from("events")
      .select("id, name, event_date")
      .order("created_at", { ascending: false })
      .limit(100);
    setEvents((data as unknown as EventOpt[]) || []);
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
      reply_comment_variations: [],
      action_send_dm: false,
      dm_message_text: "",
      dm_buttons: [],
      action_trigger_automation: false,
      automation_flow_id: "",
      cooldown_minutes: 60,
      target_media_id: "",
      target_media_caption: "",
      action_capture_lead: false,
      capture_event_id: "",
      capture_mode: "phone",
      capture_fallback_dm_text: "",
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
      reply_comment_variations: rule.reply_comment_variations || [],
      action_send_dm: rule.action_send_dm,
      dm_message_text: rule.dm_message_text || "",
      dm_buttons: rule.dm_buttons || [],
      action_trigger_automation: rule.action_trigger_automation,
      automation_flow_id: rule.automation_flow_id || "",
      cooldown_minutes: rule.cooldown_minutes,
      target_media_id: rule.target_media_id || "",
      target_media_caption: rule.target_media_caption || "",
      action_capture_lead: rule.action_capture_lead || false,
      capture_event_id: rule.capture_event_id || "",
      capture_mode: rule.capture_mode || "phone",
      capture_fallback_dm_text: rule.capture_fallback_dm_text || "",
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
      reply_comment_variations: (form.reply_comment_variations || [])
        .map((v) => v.trim())
        .filter(Boolean),
      action_send_dm: form.action_send_dm,
      dm_message_text: form.dm_message_text || null,
      dm_buttons: (form.dm_buttons || [])
        .filter((b) => b.label && b.label.trim())
        .slice(0, 3)
        .map((b) => ({
          label: b.label.trim(),
          type: b.type,
          url: b.type === "link" ? (b.url || "").trim() || null : null,
          tags: b.type === "reply"
            ? (b.tags || []).map((t) => t.trim()).filter(Boolean)
            : [],
          reply_message: b.type === "reply" ? (b.reply_message || "").trim() || null : null,
          flow_id: b.type === "reply" ? (b.flow_id || null) : null,
        })) as any,
      action_trigger_automation: form.action_trigger_automation,
      automation_flow_id: form.automation_flow_id || null,
      cooldown_minutes: form.cooldown_minutes,
      target_media_id: form.target_media_id || null,
      target_media_caption: form.target_media_id ? (form.target_media_caption || null) : null,
      action_capture_lead: form.action_capture_lead,
      capture_event_id: form.action_capture_lead ? (form.capture_event_id || null) : null,
      capture_mode: form.capture_mode || "phone",
      capture_fallback_dm_text: form.action_capture_lead ? (form.capture_fallback_dm_text || null) : null,
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

  async function loadMedia(force = false) {
    if (mediaLoaded && !force) return;
    setMediaLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-list-media");
      if (error) throw error;
      setMediaList((data?.media as MediaItem[]) || []);
      setMediaLoaded(true);
    } catch (e) {
      console.error(e);
      toast.error("Não consegui carregar suas publicações do Instagram");
    } finally {
      setMediaLoading(false);
    }
  }

  function mediaKind(m: MediaItem): "post" | "reels" | "story" | "carousel" {
    if (m.media_product_type === "STORY") return "story";
    if (m.media_product_type === "REELS") return "reels";
    if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
    return "post";
  }

  function mediaLabel(m: MediaItem) {
    const kind = {
      story: "Story",
      reels: "Reel",
      carousel: "Carrossel",
      post: "Post",
    }[mediaKind(m)];
    const cap = (m.caption || "").replace(/\s+/g, " ").trim();
    return `${kind} · ${cap ? cap.slice(0, 40) : "sem legenda"}`;
  }

  const mediaTs = (m: MediaItem) => {
    const t = m.timestamp ? Date.parse(m.timestamp) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };

  const filteredMedia = mediaList
    .filter((m) => mediaFilter === "all" || mediaKind(m) === mediaFilter)
    .sort((a, b) => mediaTs(b) - mediaTs(a));

  const MEDIA_FILTERS: { key: typeof mediaFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "post", label: "Posts" },
    { key: "reels", label: "Reels" },
    { key: "carousel", label: "Carrossel" },
    { key: "story", label: "Stories" },
  ];



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
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="font-medium">Mídias:</span>
                      {rule.media_types.map((mt) => (
                        <Badge key={mt} variant="secondary" className="text-[10px]">
                          {mt === "REELS" ? "Reels" : mt === "story" ? "Stories" : mt}
                        </Badge>
                      ))}
                    </div>
                    {rule.target_media_id && (
                      <div className="flex items-center gap-1.5">
                        <Target className="h-3 w-3 text-purple-500" />
                        <span className="font-medium">Publicação alvo:</span>{" "}
                        {rule.target_media_caption || rule.target_media_id}
                      </div>
                    )}
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
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "post", label: "Posts" },
                  { value: "REELS", label: "Reels" },
                  { value: "IGTV", label: "IGTV" },
                  { value: "story", label: "Stories" },
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
              <p className="text-[11px] text-muted-foreground mt-1">
                Stories não têm comentário público — a regra responde por DM/fluxo quando alguém
                responde ao seu story.
              </p>
            </div>

            {/* Per-post / per-story targeting */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-purple-500" />
                  Aplicar a uma publicação específica
                </Label>
                <Switch
                  checked={!!form.target_media_id || form.target_media_caption === "__pick__"}
                  onCheckedChange={(v) => {
                    if (v) {
                      setForm({ ...form, target_media_caption: "__pick__" });
                      loadMedia();
                    } else {
                      setForm({ ...form, target_media_id: "", target_media_caption: "" });
                    }
                  }}
                />
              </div>

              {(!!form.target_media_id || form.target_media_caption === "__pick__") && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {MEDIA_FILTERS.map((f) => {
                      const count =
                        f.key === "all"
                          ? mediaList.length
                          : mediaList.filter((m) => mediaKind(m) === f.key).length;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setMediaFilter(f.key)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                            mediaFilter === f.key
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {f.label} {count > 0 && `(${count})`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={form.target_media_id || undefined}
                      onValueChange={(v) => {
                        const m = mediaList.find((x) => x.id === v);
                        setForm({
                          ...form,
                          target_media_id: v,
                          target_media_caption: m ? mediaLabel(m) : v,
                        });
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue
                          placeholder={
                            mediaLoading ? "Carregando publicações..." : "Selecione a publicação..."
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {filteredMedia.length === 0 && !mediaLoading && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            Nenhuma publicação encontrada
                          </div>
                        )}
                        {filteredMedia.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              {m.thumbnail ? (
                                <img
                                  src={m.thumbnail}
                                  alt=""
                                  className="h-6 w-6 rounded object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-4 w-4 opacity-50" />
                              )}
                              <span className="truncate max-w-[260px]">{mediaLabel(m)}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 shrink-0"
                      onClick={() => loadMedia(true)}
                      disabled={mediaLoading}
                      title="Recarregar publicações"
                    >
                      {mediaLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Deixe desligado para aplicar a regra a todas as publicações dos tipos
                    selecionados.
                  </p>
                </div>
              )}
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
                <div className="space-y-2">
                  <Textarea
                    value={form.reply_comment_text}
                    onChange={(e) => setForm({ ...form, reply_comment_text: e.target.value })}
                    placeholder="Oi {username}! Que bom que gostou! 💕 Vou te chamar no direct!"
                    className="text-sm"
                    rows={2}
                  />
                  <div className="rounded-md border border-dashed p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" />
                        Variações (anti-spam) — sorteadas aleatoriamente
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() =>
                          setForm({ ...form, reply_comment_variations: [...form.reply_comment_variations, ""] })
                        }
                      >
                        <Plus className="h-3 w-3 mr-1" /> Variação
                      </Button>
                    </div>
                    {form.reply_comment_variations.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Sem variações: usa apenas o texto acima. Adicione 2-3 versões diferentes para reduzir risco de spam.
                      </p>
                    )}
                    {form.reply_comment_variations.map((v, i) => (
                      <div key={i} className="flex items-start gap-1">
                        <Textarea
                          value={v}
                          onChange={(e) => {
                            const next = [...form.reply_comment_variations];
                            next[i] = e.target.value;
                            setForm({ ...form, reply_comment_variations: next });
                          }}
                          placeholder={`Variação ${i + 1}`}
                          className="text-sm"
                          rows={2}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-destructive"
                          onClick={() =>
                            setForm({
                              ...form,
                              reply_comment_variations: form.reply_comment_variations.filter((_, idx) => idx !== i),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
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
                <div className="space-y-2">
                  <Textarea
                    value={form.dm_message_text}
                    onChange={(e) => setForm({ ...form, dm_message_text: e.target.value })}
                    placeholder="Oi {username}! Vi que você comentou no nosso post 💕 Posso te ajudar com alguma coisa?"
                    className="text-sm"
                    rows={3}
                  />
                  <div className="rounded-md border border-dashed p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Target className="h-3 w-3" />
                        Botões da DM (máx. 3)
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        disabled={form.dm_buttons.length >= 3}
                        onClick={() =>
                          setForm({
                            ...form,
                            dm_buttons: [...form.dm_buttons, { label: "", type: "link", url: "", tags: [], reply_message: "", flow_id: "" }],
                          })
                        }
                      >
                        <Plus className="h-3 w-3 mr-1" /> Botão
                      </Button>
                    </div>
                    {form.dm_buttons.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Sem botões: envia só o texto. Botões podem abrir um link (grupo VIP) ou ser uma resposta que aplica tag e dispara um fluxo.
                      </p>
                    )}
                    {form.dm_buttons.map((b, i) => {
                      const update = (patch: Partial<DmButton>) => {
                        const next = [...form.dm_buttons];
                        next[i] = { ...next[i], ...patch };
                        setForm({ ...form, dm_buttons: next });
                      };
                      return (
                        <div key={i} className="rounded border p-2 space-y-2 bg-muted/30">
                          <div className="flex items-center gap-1">
                            <Input
                              value={b.label}
                              onChange={(e) => update({ label: e.target.value })}
                              placeholder="Texto do botão (máx 20)"
                              maxLength={20}
                              className="h-8 text-sm"
                            />
                            <Select value={b.type} onValueChange={(v) => update({ type: v as "link" | "reply" })}>
                              <SelectTrigger className="h-8 w-[110px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="link">🔗 Link</SelectItem>
                                <SelectItem value="reply">💬 Resposta</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0 text-destructive"
                              onClick={() => setForm({ ...form, dm_buttons: form.dm_buttons.filter((_, idx) => idx !== i) })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {b.type === "link" ? (
                            <Input
                              value={b.url || ""}
                              onChange={(e) => update({ url: e.target.value })}
                              placeholder="https://link-do-grupo-vip..."
                              className="h-8 text-sm"
                            />
                          ) : (
                            <div className="space-y-2">
                              <Input
                                value={(b.tags || []).join(", ")}
                                onChange={(e) => update({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                                placeholder="Tags ao clicar (ex: quer_live, vip)"
                                className="h-8 text-sm"
                              />
                              <Textarea
                                value={b.reply_message || ""}
                                onChange={(e) => update({ reply_message: e.target.value })}
                                placeholder="Mensagem de retorno ao clicar (opcional)"
                                className="text-sm"
                                rows={2}
                              />
                              <Select
                                value={b.flow_id || "none"}
                                onValueChange={(v) => update({ flow_id: v === "none" ? "" : v })}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Disparar fluxo (opcional)..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Nenhum fluxo</SelectItem>
                                  {flows.map((flow) => (
                                    <SelectItem key={flow.id} value={flow.id}>{flow.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
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
