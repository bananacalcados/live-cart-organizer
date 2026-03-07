import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft, Plus, Play, Clock, CheckCircle, XCircle, Loader2,
  Trash2, Users, Send, Link as LinkIcon, Copy, Edit, Calendar as CalendarIcon,
  Variable, Settings, ChevronLeft, ChevronRight, Search,
  UserPlus, UserMinus, Percent, BarChart3, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScheduledMessageForm, type ScheduledMessageData } from "./ScheduledMessageForm";
import { CampaignBulkSettings } from "./CampaignBulkSettings";
import { CampaignDashboard } from "./CampaignDashboard";
import { VipStrategyPanel } from "./VipStrategyPanel";

interface CampaignDetailPanelProps {
  campaignId: string;
  onBack: () => void;
}

interface ScheduledMessage {
  id: string;
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  poll_options: any;
  scheduled_at: string;
  status: string;
  sent_at: string | null;
  send_speed: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

interface RedirectLink {
  id: string;
  slug: string;
  is_deep_link: boolean;
  click_count: number;
  redirect_count: number;
  is_active: boolean;
}

interface CampaignVariable {
  id: string;
  variable_name: string;
  variable_value: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3.5 w-3.5 text-amber-500" />,
  sending: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  sent: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  cancelled: <XCircle className="h-3.5 w-3.5 text-muted-foreground" />,
};

const TYPE_LABELS: Record<string, string> = {
  text: "📝 Texto", image: "🖼️ Imagem", video: "🎬 Vídeo",
  audio: "🎵 Áudio", document: "📄 Doc", poll: "📊 Enquete",
};

export function CampaignDetailPanel({ campaignId, onBack }: CampaignDetailPanelProps) {
  const [campaign, setCampaign] = useState<any>(null);
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [links, setLinks] = useState<RedirectLink[]>([]);
  const [variables, setVariables] = useState<CampaignVariable[]>([]);
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [isSending, setIsSending] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [showBulkSettings, setShowBulkSettings] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [allGroups, setAllGroups] = useState<any[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const fetchCampaign = useCallback(async () => {
    const { data } = await supabase.from('group_campaigns').select('*').eq('id', campaignId).single();
    setCampaign(data);
  }, [campaignId]);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from('group_campaign_scheduled_messages')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('scheduled_at', { ascending: true });
    setMessages((data || []) as ScheduledMessage[]);
  }, [campaignId]);

  const fetchLinks = useCallback(async () => {
    const { data } = await supabase
      .from('group_redirect_links')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });
    setLinks((data || []) as RedirectLink[]);
  }, [campaignId]);

  const fetchVariables = useCallback(async () => {
    const { data } = await supabase
      .from('campaign_variables')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('variable_name');
    setVariables((data || []) as CampaignVariable[]);
  }, [campaignId]);

  const fetchAllGroups = useCallback(async () => {
    const { data } = await supabase.from('whatsapp_groups').select('id, group_id, name, photo_url, participant_count, max_participants').order('name');
    setAllGroups(data || []);
  }, []);

  useEffect(() => { fetchCampaign(); fetchMessages(); fetchLinks(); fetchVariables(); fetchAllGroups(); }, [fetchCampaign, fetchMessages, fetchLinks, fetchVariables, fetchAllGroups]);

  // Auto-refresh messages list to reflect server-side cron dispatches
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMessages();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const handleAddMessage = async (data: ScheduledMessageData) => {
    const [hours, minutes] = data.scheduledTime.split(':').map(Number);
    const scheduledAt = new Date(data.scheduledAt);
    scheduledAt.setHours(hours, minutes, 0, 0);

    const { error } = await supabase.from('group_campaign_scheduled_messages').insert({
      campaign_id: campaignId,
      message_type: data.messageType,
      message_content: data.messageContent,
      media_url: data.mediaUrl || null,
      poll_options: data.messageType === 'poll' ? data.pollOptions : null,
      poll_max_options: data.messageType === 'poll' ? data.pollMaxOptions : 1,
      scheduled_at: scheduledAt.toISOString(),
      send_speed: data.sendSpeed,
    });

    if (error) throw error;
    toast.success("Mensagem agendada!");
    fetchMessages();
  };

  const handleSendNow = async (data: ScheduledMessageData) => {
    // Create the message with current time and immediately send it
    const now = new Date();
    const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
      campaign_id: campaignId,
      message_type: data.messageType,
      message_content: data.messageContent,
      media_url: data.mediaUrl || null,
      poll_options: data.messageType === 'poll' ? data.pollOptions : null,
      poll_max_options: data.messageType === 'poll' ? data.pollMaxOptions : 1,
      scheduled_at: now.toISOString(),
      send_speed: data.sendSpeed,
    }).select().single();

    if (error) throw error;

    // Immediately trigger sending
    await sendMessage(inserted.id);
    fetchMessages();
  };

  const handleUpdateMessage = async (id: string, data: ScheduledMessageData) => {
    const [hours, minutes] = data.scheduledTime.split(':').map(Number);
    const scheduledAt = new Date(data.scheduledAt);
    scheduledAt.setHours(hours, minutes, 0, 0);

    const { error } = await supabase.from('group_campaign_scheduled_messages').update({
      message_type: data.messageType,
      message_content: data.messageContent,
      media_url: data.mediaUrl || null,
      poll_options: data.messageType === 'poll' ? data.pollOptions : null,
      poll_max_options: data.messageType === 'poll' ? data.pollMaxOptions : 1,
      scheduled_at: scheduledAt.toISOString(),
      send_speed: data.sendSpeed,
    }).eq('id', id);

    if (error) throw error;
    toast.success("Mensagem atualizada!");
    setEditingMessage(null);
    fetchMessages();
  };

  const sendMessage = async (messageId: string, auto = false) => {
    if (!auto) setIsSending(messageId);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-scheduled-send`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledMessageId: messageId }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(`Enviada! ${result.sentCount}/${result.total} grupos`);
      } else {
        toast.error(result.error || "Erro ao enviar");
      }
      fetchMessages();
    } catch { toast.error("Erro ao enviar"); }
    finally { if (!auto) setIsSending(null); }
  };

  const deleteMessage = async (id: string) => {
    await supabase.from('group_campaign_scheduled_messages').delete().eq('id', id);
    toast.success("Mensagem removida");
    fetchMessages();
  };

  const cancelMessage = async (id: string) => {
    await supabase.from('group_campaign_scheduled_messages')
      .update({ status: 'cancelled' }).eq('id', id);
    toast.success("Mensagem cancelada");
    fetchMessages();
  };

  const createLink = async () => {
    if (!newSlug.trim()) { toast.error("Slug obrigatório"); return; }
    setIsCreatingLink(true);
    const { error } = await supabase.from('group_redirect_links').insert({
      campaign_id: campaignId,
      slug: newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      is_deep_link: false,
    });
    if (error) {
      toast.error(error.message.includes('unique') ? "Slug já existe" : "Erro ao criar link");
    } else {
      toast.success("Link criado!");
      setNewSlug("");
      fetchLinks();
    }
    setIsCreatingLink(false);
  };

  const toggleDeepLink = async (linkId: string, val: boolean) => {
    await supabase.from('group_redirect_links').update({ is_deep_link: val }).eq('id', linkId);
    fetchLinks();
  };

  const copyLink = (slug: string) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/group-redirect-link?slug=${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  const addVariable = async () => {
    if (!newVarName.trim()) { toast.error("Nome obrigatório"); return; }
    const { error } = await supabase.from('campaign_variables').upsert({
      campaign_id: campaignId,
      variable_name: newVarName.trim().toLowerCase().replace(/\s+/g, '_'),
      variable_value: newVarValue,
    }, { onConflict: 'campaign_id,variable_name' });
    if (error) { toast.error("Erro ao salvar variável"); return; }
    toast.success("Variável salva!");
    setNewVarName(""); setNewVarValue("");
    fetchVariables();
  };

  const updateVariable = async (id: string, value: string) => {
    await supabase.from('campaign_variables').update({ variable_value: value }).eq('id', id);
    fetchVariables();
  };

  const deleteVariable = async (id: string) => {
    await supabase.from('campaign_variables').delete().eq('id', id);
    fetchVariables();
  };

  const targetGroups: string[] = campaign?.target_groups || [];
  const groupCount = targetGroups.length;

  // Check if all campaign groups are full
  const campaignGroups = allGroups.filter(g => targetGroups.includes(g.id));
  const allGroupsFull = campaignGroups.length > 0 && campaignGroups.every(g => g.participant_count >= (g.max_participants || 1024));

  const createGroupForCampaign = async () => {
    if (!newGroupName.trim()) { toast.error("Nome do grupo obrigatório"); return; }
    setIsCreatingGroup(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', groupName: newGroupName.trim() }),
      });
      const result = await res.json();
      if (result.success && result.groupId) {
        // Add new group to DB and to campaign
        const { data: newGroup } = await supabase.from('whatsapp_groups').insert({
          group_id: result.groupId,
          name: newGroupName.trim(),
          is_vip: true,
          is_active: true,
          participant_count: 1,
          max_participants: 1024,
        }).select().single();

        if (newGroup) {
          const updated = [...targetGroups, newGroup.id];
          await supabase.from('group_campaigns').update({ target_groups: updated, total_groups: updated.length }).eq('id', campaignId);
          setCampaign((prev: any) => prev ? { ...prev, target_groups: updated, total_groups: updated.length } : prev);
          fetchAllGroups();
        }
        toast.success(`Grupo "${newGroupName}" criado e adicionado à campanha!`);
        setShowCreateGroup(false);
        setNewGroupName("");
      } else {
        toast.error(result.error || "Erro ao criar grupo");
      }
    } catch { toast.error("Erro ao criar grupo"); }
    finally { setIsCreatingGroup(false); }
  };

  const toggleGroupInCampaign = async (groupId: string) => {
    const current: string[] = campaign?.target_groups || [];
    const updated = current.includes(groupId)
      ? current.filter((id: string) => id !== groupId)
      : [...current, groupId];
    await supabase.from('group_campaigns').update({ target_groups: updated, total_groups: updated.length }).eq('id', campaignId);
    setCampaign((prev: any) => prev ? { ...prev, target_groups: updated, total_groups: updated.length } : prev);
  };

  const filteredAllGroups = allGroups.filter(g => {
    if (!groupSearch) return true;
    return g.name?.toLowerCase().includes(groupSearch.toLowerCase());
  });

  // Calendar helpers
  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart); // 0=Sun

  const getMessagesForDay = (day: Date) => messages.filter(m => isSameDay(new Date(m.scheduled_at), day));

  if (showBulkSettings) {
    return <CampaignBulkSettings campaignId={campaignId} targetGroups={campaign?.target_groups || []} onBack={() => setShowBulkSettings(false)} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">{campaign?.name || "Campanha"}</h3>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" /> {groupCount} grupos
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowBulkSettings(true)} className="gap-1">
          <Settings className="h-3.5 w-3.5" /> Configurar Grupos
        </Button>
        <Button size="sm" onClick={() => { setEditingMessage(null); setShowMessageForm(true); }} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Enviar Mensagem
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-300px)]">
        <Tabs defaultValue="strategy" className="space-y-4">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="strategy" className="text-xs">Estratégia</TabsTrigger>
            <TabsTrigger value="overview" className="text-xs">Visão Geral</TabsTrigger>
            <TabsTrigger value="groups" className="text-xs">Grupos</TabsTrigger>
            <TabsTrigger value="messages" className="text-xs">Mensagens</TabsTrigger>
            <TabsTrigger value="calendar" className="text-xs">Calendário</TabsTrigger>
            <TabsTrigger value="variables" className="text-xs">Variáveis</TabsTrigger>
            <TabsTrigger value="links" className="text-xs">Links</TabsTrigger>
          </TabsList>

          {/* OVERVIEW / DASHBOARD TAB */}
          <TabsContent value="overview" className="space-y-4">
            <CampaignDashboard targetGroups={targetGroups} allGroups={allGroups} links={links} messages={messages} campaignId={campaignId} onRefreshGroups={fetchAllGroups} />
          </TabsContent>

          {/* STRATEGY TAB */}
          <TabsContent value="strategy" className="space-y-4">
            <VipStrategyPanel campaignId={campaignId} campaignName={campaign?.name} />
          </TabsContent>

          {/* GROUPS TAB */}
          <TabsContent value="groups" className="space-y-3">
            {allGroupsFull && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between">
                  <span className="text-xs">Todos os grupos desta campanha estão cheios!</span>
                  <Button size="sm" variant="outline" className="gap-1 ml-2 shrink-0" onClick={() => setShowCreateGroup(true)}>
                    <Plus className="h-3.5 w-3.5" /> Criar Novo Grupo
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar grupos..." value={groupSearch} onChange={e => setGroupSearch(e.target.value)} className="pl-9" />
              </div>
              <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => setShowCreateGroup(true)}>
                <Plus className="h-3.5 w-3.5" /> Criar Grupo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{groupCount} grupos selecionados</p>
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {filteredAllGroups.map(g => (
                <div key={g.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                  <Checkbox checked={targetGroups.includes(g.id)} onCheckedChange={() => toggleGroupInCampaign(g.id)} />
                  {g.photo_url ? (
                    <img src={g.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{g.name}</p>
                    <p className="text-[10px] text-muted-foreground">{g.participant_count}/{g.max_participants}</p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* MESSAGES TAB */}
          <TabsContent value="messages" className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">MENSAGENS ({messages.length})</p>
            {messages.length === 0 ? (
              <Card><CardContent className="py-8 text-center">
                <Send className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground">Nenhuma mensagem agendada</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {messages.map(msg => (
                  <Card key={msg.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {STATUS_ICONS[msg.status]}
                            <span className="text-xs font-medium">{TYPE_LABELS[msg.message_type] || msg.message_type}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {format(new Date(msg.scheduled_at), "dd/MM HH:mm", { locale: ptBR })}
                            </Badge>
                            {msg.status === 'sent' && (
                              <span className="text-[10px] text-muted-foreground">
                                ✅ {msg.sent_count} {msg.failed_count > 0 && `· ❌ ${msg.failed_count}`}
                              </span>
                            )}
                          </div>
                          {msg.message_content && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{msg.message_content}</p>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {msg.status === 'pending' && (
                            <>
                              <Button variant="outline" size="icon" className="h-7 w-7"
                                onClick={() => { setEditingMessage(msg); setShowMessageForm(true); }}>
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button variant="outline" size="icon" className="h-7 w-7"
                                onClick={() => sendMessage(msg.id)} disabled={isSending === msg.id}>
                                {isSending === msg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                onClick={() => cancelMessage(msg.id)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          {(msg.status === 'cancelled' || msg.status === 'failed') && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                              onClick={() => deleteMessage(msg.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* CALENDAR TAB */}
          <TabsContent value="calendar" className="space-y-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <p className="text-sm font-medium">{format(calendarMonth, "MMMM yyyy", { locale: ptBR })}</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-px text-center">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => (
                <div key={d} className="text-[10px] font-medium text-muted-foreground py-1">{d}</div>
              ))}
              {Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`empty-${i}`} />)}
              {days.map(day => {
                const dayMsgs = getMessagesForDay(day);
                return (
                  <div key={day.toISOString()} className={cn(
                    "min-h-[48px] p-1 border rounded text-[10px]",
                    isSameDay(day, new Date()) && "bg-primary/10 border-primary/30"
                  )}>
                    <p className="font-medium">{day.getDate()}</p>
                    {dayMsgs.slice(0, 2).map(m => (
                      <div key={m.id} className={cn("rounded px-0.5 mt-0.5 truncate",
                        m.status === 'sent' ? 'bg-emerald-500/20' : m.status === 'pending' ? 'bg-amber-500/20' : 'bg-muted'
                      )}>
                        {format(new Date(m.scheduled_at), "HH:mm")}
                      </div>
                    ))}
                    {dayMsgs.length > 2 && <p className="text-muted-foreground">+{dayMsgs.length - 2}</p>}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* VARIABLES TAB */}
          <TabsContent value="variables" className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">VARIÁVEIS DA CAMPANHA</p>
            <p className="text-[10px] text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">{`{{nome_variavel}}`}</code> nas mensagens. O valor é substituído na hora do envio.
            </p>
            {variables.map(v => (
              <div key={v.id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] shrink-0">{`{{${v.variable_name}}}`}</Badge>
                <Input className="flex-1 h-8 text-xs" value={v.variable_value}
                  onChange={e => {
                    setVariables(prev => prev.map(x => x.id === v.id ? { ...x, variable_value: e.target.value } : x));
                  }}
                  onBlur={e => updateVariable(v.id, e.target.value)}
                  placeholder="Valor da variável..." />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0"
                  onClick={() => deleteVariable(v.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Separator />
            <div className="flex gap-2">
              <Input className="h-8 text-xs" placeholder="nome_variavel" value={newVarName} onChange={e => setNewVarName(e.target.value)} />
              <Input className="h-8 text-xs flex-1" placeholder="Valor" value={newVarValue} onChange={e => setNewVarValue(e.target.value)} />
              <Button size="sm" className="h-8" onClick={addVariable}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
          </TabsContent>

          {/* LINKS TAB */}
          <TabsContent value="links" className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">LINKS DE REDIRECIONAMENTO</p>
            <div className="flex gap-2">
              <Input placeholder="slug-do-link" value={newSlug} onChange={e => setNewSlug(e.target.value)} className="flex-1" />
              <Button size="sm" onClick={createLink} disabled={isCreatingLink} className="gap-1">
                {isCreatingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LinkIcon className="h-3.5 w-3.5" />}
                Criar
              </Button>
            </div>
            {links.map(link => (
              <Card key={link.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">/{link.slug}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {link.click_count} cliques · {link.redirect_count} redirecionamentos
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Label className="text-[10px]">Deep Link</Label>
                        <Switch checked={link.is_deep_link} onCheckedChange={v => toggleDeepLink(link.id, v)} />
                      </div>
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => copyLink(link.slug)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </ScrollArea>

      <ScheduledMessageForm
        open={showMessageForm}
        onOpenChange={open => { setShowMessageForm(open); if (!open) setEditingMessage(null); }}
        onSubmit={handleAddMessage}
        onSendNow={handleSendNow}
        editingMessage={editingMessage}
        onUpdate={handleUpdateMessage}
        campaignId={campaignId}
      />

      {/* CREATE GROUP DIALOG */}
      <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Criar Novo Grupo WhatsApp</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              O grupo será criado automaticamente no WhatsApp e adicionado a esta campanha como VIP.
            </p>
            <Input placeholder="Nome do grupo (ex: VIP Banana #11)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateGroup(false)}>Cancelar</Button>
            <Button onClick={createGroupForCampaign} disabled={isCreatingGroup} className="gap-1">
              {isCreatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar Grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
