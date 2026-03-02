import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft, Plus, Play, Clock, CheckCircle, XCircle, Loader2,
  Trash2, Users, Send, Link as LinkIcon, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScheduledMessageForm, type ScheduledMessageData } from "./ScheduledMessageForm";

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
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [isSending, setIsSending] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [isCreatingLink, setIsCreatingLink] = useState(false);

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

  useEffect(() => { fetchCampaign(); fetchMessages(); fetchLinks(); }, [fetchCampaign, fetchMessages, fetchLinks]);

  // Polling for pending messages
  useEffect(() => {
    const interval = setInterval(async () => {
      const { data: pendingMsgs } = await supabase
        .from('group_campaign_scheduled_messages')
        .select('id, scheduled_at')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString());

      if (pendingMsgs && pendingMsgs.length > 0) {
        for (const msg of pendingMsgs) {
          await sendMessage(msg.id, true);
        }
        fetchMessages();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [campaignId]);

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
      scheduled_at: scheduledAt.toISOString(),
      send_speed: data.sendSpeed,
    });

    if (error) throw error;
    toast.success("Mensagem agendada!");
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

  const groupCount = campaign?.target_groups?.length || 0;

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
        <Button size="sm" onClick={() => setShowMessageForm(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Agendar Mensagem
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-300px)]">
        <div className="space-y-4">
          {/* Messages Timeline */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              MENSAGENS ({messages.length})
            </p>
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
          </div>

          <Separator />

          {/* Links */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              LINKS DE REDIRECIONAMENTO
            </p>
            <div className="flex gap-2 mb-3">
              <Input placeholder="slug-do-link" value={newSlug} onChange={e => setNewSlug(e.target.value)} className="flex-1" />
              <Button size="sm" onClick={createLink} disabled={isCreatingLink} className="gap-1">
                {isCreatingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LinkIcon className="h-3.5 w-3.5" />}
                Criar
              </Button>
            </div>
            {links.length > 0 && (
              <div className="space-y-2">
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
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <ScheduledMessageForm open={showMessageForm} onOpenChange={setShowMessageForm} onSubmit={handleAddMessage} />
    </div>
  );
}
