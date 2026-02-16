import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, RefreshCw, Send, Plus, Search, Star, Trash2, Loader2,
  Settings, Image, MessageSquare, Sparkles, Play, CheckCircle, XCircle, Crown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface WhatsAppGroup {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  participant_count: number;
  is_admin: boolean;
  is_active: boolean;
  is_vip: boolean;
  tags: string[];
  instance_id: string | null;
  last_synced_at: string | null;
}

interface GroupCampaign {
  id: string;
  name: string;
  status: string;
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  ai_prompt: string | null;
  ai_generated_content: string | null;
  target_groups: string[];
  total_groups: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
};

export function GroupsVipManager() {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [campaigns, setCampaigns] = useState<GroupCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    messageType: "text",
    messageContent: "",
    mediaUrl: "",
    aiPrompt: "",
  });
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiGeneratedContent, setAiGeneratedContent] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const fetchGroups = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_groups')
        .select('*')
        .order('is_vip', { ascending: false })
        .order('name');
      if (error) throw error;
      setGroups((data || []) as WhatsAppGroup[]);
    } catch (err) { console.error(err); toast.error("Erro ao carregar grupos"); }
    finally { setIsLoading(false); }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('group_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setCampaigns((data || []) as GroupCampaign[]);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchGroups(); fetchCampaigns(); }, [fetchGroups, fetchCampaigns]);

  const syncGroups = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncToDb: true }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.total} grupos sincronizados!`);
        fetchGroups();
      } else {
        toast.error(data.error || "Erro ao sincronizar");
      }
    } catch { toast.error("Erro ao sincronizar grupos"); }
    finally { setIsSyncing(false); }
  };

  const toggleVip = async (group: WhatsAppGroup) => {
    const { error } = await supabase
      .from('whatsapp_groups')
      .update({ is_vip: !group.is_vip })
      .eq('id', group.id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_vip: !g.is_vip } : g));
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedGroups(filteredGroups.map(g => g.id));
    } else {
      setSelectedGroups([]);
    }
  };

  const generateAIContent = async () => {
    if (!campaignForm.aiPrompt.trim()) {
      toast.error("Insira um prompt para a IA");
      return;
    }
    setIsGeneratingAI(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-marketing-strategy`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Gere uma mensagem para WhatsApp Group com base nesse briefing. A mensagem deve ser engajante, usar emojis e ser concisa (máximo 500 caracteres). NÃO use formatação markdown, apenas texto simples com emojis.\n\nBriefing: ${campaignForm.aiPrompt}`,
          mode: 'quick_copy',
        }),
      });
      const data = await res.json();
      if (data.strategy || data.copy) {
        const content = typeof data.strategy === 'string' ? data.strategy : (data.copy || JSON.stringify(data.strategy));
        setAiGeneratedContent(content);
        setCampaignForm(prev => ({ ...prev, messageContent: content }));
        toast.success("Conteúdo gerado pela IA!");
      } else {
        toast.error("IA não retornou conteúdo");
      }
    } catch { toast.error("Erro ao gerar conteúdo"); }
    finally { setIsGeneratingAI(false); }
  };

  const createAndExecuteCampaign = async () => {
    if (!campaignForm.name.trim()) { toast.error("Nome obrigatório"); return; }
    if (selectedGroups.length === 0) { toast.error("Selecione ao menos 1 grupo"); return; }
    if (!campaignForm.messageContent.trim() && campaignForm.messageType === 'text') {
      toast.error("Mensagem obrigatória"); return;
    }

    setIsExecuting(true);
    try {
      // Create campaign
      const { data: campaign, error: createErr } = await supabase
        .from('group_campaigns')
        .insert({
          name: campaignForm.name,
          message_type: campaignForm.messageType,
          message_content: campaignForm.messageContent,
          media_url: campaignForm.mediaUrl || null,
          ai_prompt: campaignForm.aiPrompt || null,
          ai_generated_content: aiGeneratedContent || null,
          target_groups: selectedGroups,
          total_groups: selectedGroups.length,
        })
        .select()
        .single();

      if (createErr || !campaign) throw createErr;

      // Execute campaign
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-campaign-execute`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success(`Campanha enviada! ${result.sentCount}/${result.total} grupos`);
      } else {
        toast.error(result.error || "Erro ao executar campanha");
      }

      setShowCampaignDialog(false);
      setCampaignForm({ name: "", messageType: "text", messageContent: "", mediaUrl: "", aiPrompt: "" });
      setAiGeneratedContent("");
      setSelectedGroups([]);
      fetchCampaigns();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao criar campanha");
    }
    finally { setIsExecuting(false); }
  };

  const filteredGroups = groups.filter(g => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return g.name.toLowerCase().includes(q) || g.group_id.includes(q);
  });

  const vipGroups = filteredGroups.filter(g => g.is_vip);
  const otherGroups = filteredGroups.filter(g => !g.is_vip);

  return (
    <div className="space-y-4">
      <Tabs defaultValue="groups">
        <TabsList>
          <TabsTrigger value="groups" className="gap-1"><Users className="h-3.5 w-3.5" />Grupos</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1"><Send className="h-3.5 w-3.5" />Campanhas</TabsTrigger>
        </TabsList>

        {/* GROUPS TAB */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar grupos..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="pl-9" />
            </div>
            <Button variant="outline" size="sm" onClick={syncGroups} disabled={isSyncing} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Sincronizar Grupos
            </Button>
            <Button size="sm" onClick={() => setShowCampaignDialog(true)} disabled={selectedGroups.length === 0} className="gap-1">
              <Send className="h-3.5 w-3.5" />
              Nova Campanha ({selectedGroups.length})
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedGroups.length === filteredGroups.length && filteredGroups.length > 0}
              onCheckedChange={handleSelectAll}
            />
            <span className="text-xs text-muted-foreground">Selecionar todos ({filteredGroups.length} grupos)</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">Nenhum grupo sincronizado ainda.</p>
                <Button variant="outline" className="mt-4 gap-1" onClick={syncGroups}>
                  <RefreshCw className="h-4 w-4" />Sincronizar agora
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-4">
                {/* VIP Groups */}
                {vipGroups.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <Crown className="h-3.5 w-3.5 text-amber-500" /> GRUPOS VIP ({vipGroups.length})
                    </p>
                    <div className="grid gap-2">
                      {vipGroups.map(g => (
                        <GroupCard key={g.id} group={g} isSelected={selectedGroups.includes(g.id)}
                          onToggleSelect={(id) => setSelectedGroups(prev =>
                            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                          )}
                          onToggleVip={() => toggleVip(g)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Other groups */}
                {otherGroups.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      OUTROS GRUPOS ({otherGroups.length})
                    </p>
                    <div className="grid gap-2">
                      {otherGroups.map(g => (
                        <GroupCard key={g.id} group={g} isSelected={selectedGroups.includes(g.id)}
                          onToggleSelect={(id) => setSelectedGroups(prev =>
                            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                          )}
                          onToggleVip={() => toggleVip(g)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* CAMPAIGNS TAB */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{campaigns.length} campanhas</p>
            <Button size="sm" onClick={() => setShowCampaignDialog(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" />Nova Campanha
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-340px)]">
            <div className="space-y-2">
              {campaigns.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Send className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
                  </CardContent>
                </Card>
              ) : campaigns.map(c => (
                <Card key={c.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString('pt-BR')} · {c.total_groups} grupos
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={STATUS_COLORS[c.status] || ''}>
                          {c.status === 'draft' ? 'Rascunho' : c.status === 'sending' ? 'Enviando...' :
                            c.status === 'completed' ? 'Concluída' : c.status === 'failed' ? 'Falha' : c.status}
                        </Badge>
                        {c.status === 'completed' && (
                          <span className="text-xs text-muted-foreground">
                            <CheckCircle className="h-3 w-3 inline text-emerald-500" /> {c.sent_count}
                            {c.failed_count > 0 && <> · <XCircle className="h-3 w-3 inline text-red-500" /> {c.failed_count}</>}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.message_content && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{c.message_content}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* CREATE CAMPAIGN DIALOG */}
      <Dialog open={showCampaignDialog} onOpenChange={setShowCampaignDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Campanha de Grupo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome da campanha" value={campaignForm.name}
              onChange={e => setCampaignForm(prev => ({ ...prev, name: e.target.value }))} />

            <Select value={campaignForm.messageType}
              onValueChange={v => setCampaignForm(prev => ({ ...prev, messageType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">📝 Texto</SelectItem>
                <SelectItem value="image">🖼️ Imagem</SelectItem>
                <SelectItem value="video">🎬 Vídeo</SelectItem>
                <SelectItem value="audio">🎵 Áudio</SelectItem>
                <SelectItem value="document">📄 Documento</SelectItem>
              </SelectContent>
            </Select>

            {campaignForm.messageType !== 'text' && (
              <Input placeholder="URL da mídia" value={campaignForm.mediaUrl}
                onChange={e => setCampaignForm(prev => ({ ...prev, mediaUrl: e.target.value }))} />
            )}

            {/* AI Generation */}
            <Card className="border-dashed">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Gerar com IA
                </p>
                <Textarea placeholder="Descreva o que quer que a IA escreva... Ex: Mensagem promocional de liquidação de verão com 50% off"
                  value={campaignForm.aiPrompt}
                  onChange={e => setCampaignForm(prev => ({ ...prev, aiPrompt: e.target.value }))}
                  rows={2} />
                <Button variant="outline" size="sm" onClick={generateAIContent} disabled={isGeneratingAI} className="gap-1">
                  {isGeneratingAI ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Gerar Texto
                </Button>
              </CardContent>
            </Card>

            <Textarea placeholder="Texto da mensagem..." value={campaignForm.messageContent}
              onChange={e => setCampaignForm(prev => ({ ...prev, messageContent: e.target.value }))}
              rows={4} />

            <p className="text-xs text-muted-foreground">
              {selectedGroups.length} grupo(s) selecionado(s) para envio
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCampaignDialog(false)}>Cancelar</Button>
            <Button onClick={createAndExecuteCampaign} disabled={isExecuting} className="gap-1">
              {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Criar e Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupCard({ group, isSelected, onToggleSelect, onToggleVip }: {
  group: WhatsAppGroup;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleVip: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
      <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(group.id)} />
      
      {group.photo_url ? (
        <img src={group.photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{group.name}</p>
        <p className="text-xs text-muted-foreground">
          {group.participant_count} membros
          {group.is_admin && <Badge variant="secondary" className="ml-2 text-[10px]">Admin</Badge>}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => { e.stopPropagation(); onToggleVip(); }}
        className={group.is_vip ? 'text-amber-500' : 'text-muted-foreground'}
      >
        <Star className={`h-4 w-4 ${group.is_vip ? 'fill-amber-500' : ''}`} />
      </Button>
    </div>
  );
}
