import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Play, GripVertical, Upload, Radio, Users, Volume2, Video as VideoIcon, FileText, Image as ImageIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { InlineAudioRecorder } from "./InlineAudioRecorder";

type Campaign = {
  id: string;
  name: string;
  slug: string;
  trigger_phrase: string;
  is_active: boolean;
  default_delay_seconds: number;
  ask_shoe_size: boolean;
  jess_enabled: boolean;
  jess_prompt: string | null;
  total_leads: number;
  whatsapp_number_id: string | null;
  channel_preference: "whatsapp" | "instagram" | "meta_whatsapp" | "auto";
};

type Message = {
  id?: string;
  campaign_id?: string;
  sort_order: number;
  message_type: "text" | "audio" | "video" | "image" | "document";
  content: string | null;
  media_url: string | null;
  caption: string | null;
  delay_seconds: number;
  is_active: boolean;
  meta_template_name?: string | null;
  meta_template_language?: string | null;
  meta_template_variables?: Record<string, string> | null;
};

type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  components?: Array<{ type: string; text?: string; format?: string }>;
};


const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  text: FileText,
  audio: Volume2,
  video: VideoIcon,
  image: ImageIcon,
  document: FileText,
};

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export default function LiveCampaignsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMessagesDialog, setShowMessagesDialog] = useState<Campaign | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [savingMessages, setSavingMessages] = useState(false);

  const [form, setForm] = useState<Partial<Campaign>>({
    name: "",
    trigger_phrase: "",
    is_active: true,
    default_delay_seconds: 8,
    ask_shoe_size: true,
    jess_enabled: true,
    jess_prompt: "",
  });

  useEffect(() => { loadCampaigns(); }, []);

  async function loadCampaigns() {
    setLoading(true);
    const { data, error } = await supabase
      .from("live_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar campanhas");
    setCampaigns((data as Campaign[]) || []);
    setLoading(false);
  }

  async function saveCampaign() {
    if (!form.name || !form.trigger_phrase) {
      toast.error("Preencha o nome e a frase-chave");
      return;
    }
    const slug = editing?.slug ?? slugify(form.name);
    const payload = {
      name: form.name,
      trigger_phrase: form.trigger_phrase,
      is_active: form.is_active ?? true,
      default_delay_seconds: form.default_delay_seconds ?? 8,
      ask_shoe_size: form.ask_shoe_size ?? true,
      jess_enabled: form.jess_enabled ?? true,
      jess_prompt: form.jess_prompt ?? null,
      slug,
    };
    if (editing) {
      const { error } = await supabase.from("live_campaigns").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Campanha atualizada");
    } else {
      const { error } = await supabase.from("live_campaigns").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Campanha criada");
    }
    setShowCreateDialog(false);
    setEditing(null);
    setForm({ name: "", trigger_phrase: "", is_active: true, default_delay_seconds: 8, ask_shoe_size: true, jess_enabled: true, jess_prompt: "" });
    loadCampaigns();
  }

  async function deleteCampaign(id: string) {
    if (!confirm("Excluir esta campanha? Os despachos pendentes serão cancelados.")) return;
    const { error } = await supabase.from("live_campaigns").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Campanha excluída");
    loadCampaigns();
  }

  async function toggleActive(c: Campaign) {
    await supabase.from("live_campaigns").update({ is_active: !c.is_active }).eq("id", c.id);
    loadCampaigns();
  }

  function openEdit(c: Campaign) {
    setEditing(c);
    setForm(c);
    setShowCreateDialog(true);
  }

  async function openMessagesDialog(c: Campaign) {
    setShowMessagesDialog(c);
    const { data } = await supabase
      .from("live_campaign_messages")
      .select("*")
      .eq("campaign_id", c.id)
      .order("sort_order", { ascending: true });
    setMessages((data as Message[]) || []);
  }

  function addMessage(type: Message["message_type"]) {
    const nextOrder = messages.length;
    setMessages([
      ...messages,
      {
        sort_order: nextOrder,
        message_type: type,
        content: type === "text" ? "" : null,
        media_url: type === "text" ? null : "",
        caption: null,
        delay_seconds: showMessagesDialog?.default_delay_seconds ?? 8,
        is_active: true,
      },
    ]);
  }

  function updateMessage(idx: number, patch: Partial<Message>) {
    setMessages(messages.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  function removeMessage(idx: number) {
    setMessages(messages.filter((_, i) => i !== idx).map((m, i) => ({ ...m, sort_order: i })));
  }

  function moveMessage(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= messages.length) return;
    const arr = [...messages];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setMessages(arr.map((m, i) => ({ ...m, sort_order: i })));
  }

  async function saveMessages() {
    if (!showMessagesDialog) return;
    setSavingMessages(true);
    try {
      // Apaga e regrava (estratégia simples e segura para reordenamento)
      await supabase.from("live_campaign_messages").delete().eq("campaign_id", showMessagesDialog.id);
      if (messages.length > 0) {
        const toInsert = messages.map((m, i) => ({
          campaign_id: showMessagesDialog.id,
          sort_order: i,
          message_type: m.message_type,
          content: m.content,
          media_url: m.media_url,
          caption: m.caption,
          delay_seconds: m.delay_seconds,
          is_active: m.is_active,
        }));
        const { error } = await supabase.from("live_campaign_messages").insert(toInsert);
        if (error) throw error;
      }
      toast.success("Sequência salva");
      setShowMessagesDialog(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      toast.error(msg);
    } finally {
      setSavingMessages(false);
    }
  }

  async function uploadMedia(idx: number, file: File) {
    const ext = file.name.split(".").pop() || "bin";
    const path = `live-campaigns/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("media").upload(path, file, { upsert: false });
    if (error) { toast.error("Falha no upload: " + error.message); return; }
    const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
    updateMessage(idx, { media_url: pub.publicUrl });
    toast.success("Mídia enviada");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              Campanhas de Live
            </CardTitle>
            <CardDescription>
              Frases-chave que disparam automaticamente uma sequência de mensagens (texto, áudio, vídeo) e cadastram a cliente como lead da campanha.
            </CardDescription>
          </div>
          <Button onClick={() => { setEditing(null); setForm({ name: "", trigger_phrase: "", is_active: true, default_delay_seconds: 8, ask_shoe_size: true, jess_enabled: true, jess_prompt: "" }); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Nova Campanha
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhuma campanha de Live ainda. Clique em <strong>Nova Campanha</strong> para começar.
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.id} className="border rounded-lg p-4 hover:bg-muted/30 transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">{c.name}</h4>
                      <Badge variant="outline" className="text-xs">live:{c.slug}</Badge>
                      {c.is_active ? (
                        <Badge variant="default" className="text-xs bg-green-500">Ativa</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Pausada</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div>📩 Frase-chave: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{c.trigger_phrase}</code></div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.total_leads} lead(s)</span>
                        <span>⏱ Delay padrão: {c.default_delay_seconds}s</span>
                        {c.ask_shoe_size && <span>👟 Pergunta numeração</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={c.is_active} onCheckedChange={() => toggleActive(c)} />
                    <Button size="sm" variant="ghost" onClick={() => openMessagesDialog(c)} title="Mensagens da sequência">
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteCampaign(c.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Dialog: Criar/Editar campanha */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar campanha" : "Nova campanha de Live"}</DialogTitle>
            <DialogDescription>
              Configure o gatilho. A cliente que enviar a frase-chave entra como lead automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome da campanha</Label>
              <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Live Setembro 2026" />
              {!editing && form.name && (
                <p className="text-xs text-muted-foreground mt-1">Tag do lead: <code>live:{slugify(form.name)}</code></p>
              )}
            </div>
            <div>
              <Label>Frase-chave</Label>
              <Input value={form.trigger_phrase || ""} onChange={(e) => setForm({ ...form, trigger_phrase: e.target.value })} placeholder="quero me cadastrar na live" />
              <p className="text-xs text-muted-foreground mt-1">Detecção é insensível a maiúsculas, acentos e pontuação. Basta a frase estar contida na mensagem.</p>
            </div>
            <div>
              <Label>Delay padrão entre mensagens (segundos)</Label>
              <Input type="number" min={3} max={120} value={form.default_delay_seconds || 8} onChange={(e) => setForm({ ...form, default_delay_seconds: Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="text-sm font-medium">Pedir numeração no fim</p>
                <p className="text-xs text-muted-foreground">A Jess vai perguntar a numeração da cliente após a sequência de mídias.</p>
              </div>
              <Switch checked={form.ask_shoe_size ?? true} onCheckedChange={(v) => setForm({ ...form, ask_shoe_size: v })} />
            </div>
            <div className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="text-sm font-medium">Modo Jess (IA)</p>
                <p className="text-xs text-muted-foreground">Após enviar todas as mídias, a Jess assume a conversa para capturar a numeração e responder dúvidas sobre a Live.</p>
              </div>
              <Switch checked={form.jess_enabled ?? true} onCheckedChange={(v) => setForm({ ...form, jess_enabled: v })} />
            </div>
            {form.jess_enabled && (
              <div>
                <Label>Contexto da Live para a Jess (opcional)</Label>
                <Textarea
                  rows={6}
                  value={form.jess_prompt || ""}
                  onChange={(e) => setForm({ ...form, jess_prompt: e.target.value })}
                  placeholder={"Ex: A Live acontece sábado dia 10/05 às 20h no Instagram @bananacalcados.\nTeremos descontos de até 60% em sandálias e tênis.\nFrete grátis para Governador Valadares e R$15 para o restante de MG."}
                />
                <p className="text-xs text-muted-foreground mt-1">Esse texto é injetado no prompt da Jess para que ela responda dúvidas reais sobre a Live (data, produtos, frete, descontos). Se em branco, ela só foca em capturar a numeração.</p>
              </div>
            )}
            <div className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="text-sm font-medium">Campanha ativa</p>
                <p className="text-xs text-muted-foreground">Se desativada, a frase-chave não dispara nada.</p>
              </div>
              <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button onClick={saveCampaign}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Sequência de mensagens */}
      <Dialog open={!!showMessagesDialog} onOpenChange={(o) => !o && setShowMessagesDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sequência de mensagens — {showMessagesDialog?.name}</DialogTitle>
            <DialogDescription>
              Defina a ordem das mensagens e o delay entre cada uma. Suporta texto, áudio, vídeo, imagem e documento.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => addMessage("text")}><FileText className="h-4 w-4 mr-1" /> Texto</Button>
            <Button size="sm" variant="outline" onClick={() => addMessage("audio")}><Volume2 className="h-4 w-4 mr-1" /> Áudio</Button>
            <Button size="sm" variant="outline" onClick={() => addMessage("video")}><VideoIcon className="h-4 w-4 mr-1" /> Vídeo</Button>
            <Button size="sm" variant="outline" onClick={() => addMessage("image")}><ImageIcon className="h-4 w-4 mr-1" /> Imagem</Button>
            <Button size="sm" variant="outline" onClick={() => addMessage("document")}><FileText className="h-4 w-4 mr-1" /> Documento</Button>
          </div>

          <div className="space-y-3 mt-2">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma mensagem ainda. Adicione acima.</p>
            ) : messages.map((m, idx) => {
              const Icon = TYPE_ICONS[m.message_type] || FileText;
              return (
                <div key={idx} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs">{idx + 1}º</Badge>
                      <Icon className="h-4 w-4" />
                      <span className="text-xs uppercase font-medium">{m.message_type}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => moveMessage(idx, -1)} disabled={idx === 0}>↑</Button>
                      <Button size="sm" variant="ghost" onClick={() => moveMessage(idx, 1)} disabled={idx === messages.length - 1}>↓</Button>
                      <Button size="sm" variant="ghost" onClick={() => removeMessage(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>

                  {m.message_type === "text" ? (
                    <Textarea
                      placeholder="Texto da mensagem..."
                      value={m.content || ""}
                      onChange={(e) => updateMessage(idx, { content: e.target.value })}
                      rows={3}
                    />
                  ) : (
                    <>
                      <div className="flex gap-2 flex-wrap">
                        <Input
                          placeholder="URL da mídia (ou faça upload →)"
                          value={m.media_url || ""}
                          onChange={(e) => updateMessage(idx, { media_url: e.target.value })}
                          className="flex-1 min-w-[200px]"
                        />
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            className="hidden"
                            accept={
                              m.message_type === "audio" ? "audio/*" :
                              m.message_type === "video" ? "video/*" :
                              m.message_type === "image" ? "image/*" :
                              "*/*"
                            }
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(idx, f); }}
                          />
                          <Button asChild size="sm" variant="outline">
                            <span><Upload className="h-4 w-4 mr-1" />Upload</span>
                          </Button>
                        </label>
                        {m.message_type === "audio" && (
                          <InlineAudioRecorder onUpload={(file) => uploadMedia(idx, file)} />
                        )}
                      </div>
                      {(m.message_type === "image" || m.message_type === "video" || m.message_type === "document") && (
                        <Input
                          placeholder="Legenda (opcional)"
                          value={m.caption || ""}
                          onChange={(e) => updateMessage(idx, { caption: e.target.value })}
                        />
                      )}
                    </>
                  )}

                  <div className="flex items-center gap-2 text-xs">
                    <Label className="text-xs">Delay antes desta mensagem:</Label>
                    <Input
                      type="number"
                      min={2}
                      max={120}
                      value={m.delay_seconds}
                      onChange={(e) => updateMessage(idx, { delay_seconds: Number(e.target.value) })}
                      className="w-20 h-7 text-xs"
                    />
                    <span className="text-muted-foreground">segundos</span>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMessagesDialog(null)}>Cancelar</Button>
            <Button onClick={saveMessages} disabled={savingMessages}>
              {savingMessages ? "Salvando..." : "Salvar sequência"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
