import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft, Plus, Play, Clock, CheckCircle, XCircle, Loader2,
  Trash2, Users, Send, Link as LinkIcon, Copy, Edit, Calendar as CalendarIcon,
  Variable, Settings, ChevronLeft, ChevronRight, Search, RefreshCw,
  UserPlus, UserMinus, Percent, BarChart3, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
  const [zapiContacts, setZapiContacts] = useState<{ phone: string; name: string; short: string }[]>([]);
  const [zapiContactsLoading, setZapiContactsLoading] = useState(false);
  const [zapiContactsLoaded, setZapiContactsLoaded] = useState(false);
  const [selectedGroupContacts, setSelectedGroupContacts] = useState<{ phone: string; name: string; short: string }[]>([]);
  const [showImportMessages, setShowImportMessages] = useState(false);
  const [otherCampaigns, setOtherCampaigns] = useState<any[]>([]);
  const [otherMessages, setOtherMessages] = useState<ScheduledMessage[]>([]);
  const [selectedImportCampaign, setSelectedImportCampaign] = useState<string | null>(null);
  const [selectedImportMsgs, setSelectedImportMsgs] = useState<string[]>([]);
  const [importScheduleDate, setImportScheduleDate] = useState<Date>(new Date());
  const [importScheduleTime, setImportScheduleTime] = useState("10:00");
  const [isImporting, setIsImporting] = useState(false);
  const [calendarSelectedDay, setCalendarSelectedDay] = useState<Date | null>(null);
  const [contactSearchQuery, setContactSearchQuery] = useState("");
  const [importFilterDateFrom, setImportFilterDateFrom] = useState<Date | undefined>(undefined);
  const [importFilterDateTo, setImportFilterDateTo] = useState<Date | undefined>(undefined);
  const [isSyncingFromZapi, setIsSyncingFromZapi] = useState(false);
  const { selectedNumberId } = useWhatsAppNumberStore();

  const fetchCampaign = useCallback(async () => {
    const { data } = await supabase.from('group_campaigns').select('*').eq('id', campaignId).single();
    setCampaign(data);
  }, [campaignId]);

  const handleCampaignNumberChange = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('group_campaigns')
      .update({ whatsapp_number_id: id } as any)
      .eq('id', campaignId);

    if (error) {
      toast.error('Erro ao atualizar instância WhatsApp');
      return;
    }

    setCampaign((prev: any) => prev ? { ...prev, whatsapp_number_id: id } : prev);
    toast.success('Instância WhatsApp atualizada');
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
    const { data } = await supabase.from('whatsapp_groups').select('id, group_id, name, photo_url, participant_count, previous_participant_count, max_participants').order('name');
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
    const campaignNumberId = (campaign as any)?.whatsapp_number_id || selectedNumberId || null;

    const multiMediaTypes = ['image', 'video', 'document'];

    // Multi-block support
    if (data.blocks && data.blocks.length > 0) {
      let offset = 0;
      const messageGroupId = data.blocks.length > 1 ? crypto.randomUUID() : null;
      const allInserts: any[] = [];
      for (const block of data.blocks) {
        if (multiMediaTypes.includes(block.type) && block.mediaItems.length > 0) {
          for (let i = 0; i < block.mediaItems.length; i++) {
            const item = block.mediaItems[i];
            allInserts.push({
              campaign_id: campaignId,
              message_type: block.type,
              message_content: item.caption || null,
              media_url: item.url,
              scheduled_at: new Date(scheduledAt.getTime()).toISOString(),
              send_speed: data.sendSpeed,
              mention_all: data.mentionAll,
              whatsapp_number_id: campaignNumberId,
              message_group_id: messageGroupId,
              block_order: offset,
              status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
            });
            offset++;
          }
        } else if (block.type === 'text') {
          allInserts.push({
            campaign_id: campaignId,
            message_type: 'text',
            message_content: block.content,
            scheduled_at: new Date(scheduledAt.getTime()).toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
            message_group_id: messageGroupId,
            block_order: offset,
            status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
          });
          offset++;
        } else if (block.type === 'poll') {
          allInserts.push({
            campaign_id: campaignId,
            message_type: 'poll',
            message_content: block.content,
            poll_options: block.pollOptions.filter(o => o.trim()),
            poll_max_options: block.pollMaxOptions,
            scheduled_at: new Date(scheduledAt.getTime()).toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
            message_group_id: messageGroupId,
            block_order: offset,
            status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
          });
          offset++;
        } else if (block.type === 'audio') {
          allInserts.push({
            campaign_id: campaignId,
            message_type: 'audio',
            media_url: block.mediaUrl,
            scheduled_at: new Date(scheduledAt.getTime()).toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
            message_group_id: messageGroupId,
            block_order: offset,
            status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
          });
          offset++;
        }
      }
      for (const ins of allInserts) {
        const { error } = await supabase.from('group_campaign_scheduled_messages').insert(ins as any);
        if (error) throw error;
      }
      toast.success(`${offset} mensagem(ns) agendada(s)!`);
    } else {
      // Legacy fallback
      if (multiMediaTypes.includes(data.messageType) && data.mediaItems && data.mediaItems.length > 0) {
        for (let i = 0; i < data.mediaItems.length; i++) {
          const item = data.mediaItems[i];
          const itemTime = new Date(scheduledAt.getTime() + i * 5000);
          const { error } = await supabase.from('group_campaign_scheduled_messages').insert({
            campaign_id: campaignId,
            message_type: data.messageType,
            message_content: item.caption || null,
            media_url: item.url,
            scheduled_at: itemTime.toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
          } as any);
          if (error) throw error;
        }
        toast.success(`${data.mediaItems.length} arquivo(s) agendado(s)!`);
      } else {
        const { error } = await supabase.from('group_campaign_scheduled_messages').insert({
          campaign_id: campaignId,
          message_type: data.messageType,
          message_content: data.messageContent,
          media_url: data.mediaUrl || null,
          poll_options: data.messageType === 'poll' ? data.pollOptions : null,
          poll_max_options: data.messageType === 'poll' ? data.pollMaxOptions : 1,
          scheduled_at: scheduledAt.toISOString(),
          send_speed: data.sendSpeed,
          mention_all: data.mentionAll,
          whatsapp_number_id: campaignNumberId,
        } as any);
        if (error) throw error;
        toast.success("Mensagem agendada!");
      }
    }
    fetchMessages();
  };

  const handleSendNow = async (data: ScheduledMessageData) => {
    const now = new Date();
    const multiMediaTypes = ['image', 'video', 'document'];
    const campaignNumberId = (campaign as any)?.whatsapp_number_id || selectedNumberId || null;

    if (data.blocks && data.blocks.length > 0) {
      let offset = 0;
      const messageGroupId = data.blocks.length > 1 ? crypto.randomUUID() : null;
      const allInserted: string[] = [];
      for (const block of data.blocks) {
        if (multiMediaTypes.includes(block.type) && block.mediaItems.length > 0) {
          for (const item of block.mediaItems) {
            const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
              campaign_id: campaignId,
              message_type: block.type,
              message_content: item.caption || null,
              media_url: item.url,
              scheduled_at: new Date(now.getTime()).toISOString(),
              send_speed: data.sendSpeed,
              mention_all: data.mentionAll,
              whatsapp_number_id: campaignNumberId,
              message_group_id: messageGroupId,
              block_order: offset,
              status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
            } as any).select().single();
            if (error) throw error;
            allInserted.push(inserted.id);
            offset++;
          }
        } else if (block.type === 'text') {
          const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
            campaign_id: campaignId,
            message_type: 'text',
            message_content: block.content,
            scheduled_at: new Date(now.getTime()).toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
            message_group_id: messageGroupId,
            block_order: offset,
            status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
          } as any).select().single();
          if (error) throw error;
          allInserted.push(inserted.id);
          offset++;
        } else if (block.type === 'poll') {
          const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
            campaign_id: campaignId,
            message_type: 'poll',
            message_content: block.content,
            poll_options: block.pollOptions.filter(o => o.trim()),
            poll_max_options: block.pollMaxOptions,
            scheduled_at: new Date(now.getTime()).toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
            message_group_id: messageGroupId,
            block_order: offset,
            status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
          } as any).select().single();
          if (error) throw error;
          allInserted.push(inserted.id);
          offset++;
        } else if (block.type === 'audio') {
          const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
            campaign_id: campaignId,
            message_type: 'audio',
            media_url: block.mediaUrl,
            scheduled_at: new Date(now.getTime()).toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
            message_group_id: messageGroupId,
            block_order: offset,
            status: offset === 0 ? 'pending' : (messageGroupId ? 'grouped' : 'pending'),
          } as any).select().single();
          if (error) throw error;
          allInserted.push(inserted.id);
          offset++;
        }
      }
      // Send only the first block — edge function handles the rest via message_group_id
      if (allInserted.length > 0) {
        await sendMessage(allInserted[0]);
      }
    } else {
      // Legacy fallback
      if (multiMediaTypes.includes(data.messageType) && data.mediaItems && data.mediaItems.length > 0) {
        for (const item of data.mediaItems) {
          const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
            campaign_id: campaignId,
            message_type: data.messageType,
            message_content: item.caption || null,
            media_url: item.url,
            scheduled_at: now.toISOString(),
            send_speed: data.sendSpeed,
            mention_all: data.mentionAll,
            whatsapp_number_id: campaignNumberId,
          } as any).select().single();
          if (error) throw error;
          await sendMessage(inserted.id);
        }
      } else {
        const { data: inserted, error } = await supabase.from('group_campaign_scheduled_messages').insert({
          campaign_id: campaignId,
          message_type: data.messageType,
          message_content: data.messageContent,
          media_url: data.mediaUrl || null,
          poll_options: data.messageType === 'poll' ? data.pollOptions : null,
          poll_max_options: data.messageType === 'poll' ? data.pollMaxOptions : 1,
          scheduled_at: now.toISOString(),
          send_speed: data.sendSpeed,
          mention_all: data.mentionAll,
          whatsapp_number_id: campaignNumberId,
        } as any).select().single();
        if (error) throw error;
        await sendMessage(inserted.id);
      }
    }
    fetchMessages();
  };

  const handleUpdateMessage = async (id: string, data: ScheduledMessageData) => {
    const [hours, minutes] = data.scheduledTime.split(':').map(Number);
    const scheduledAt = new Date(data.scheduledAt);
    scheduledAt.setHours(hours, minutes, 0, 0);

    // Check if this is a duplicate (create new) or real edit
    const isDuplicate = id.startsWith('__duplicate__');
    
    // For update, use first block or legacy
    const block = data.blocks?.[0];
    const msgData = {
      message_type: block?.type || data.messageType,
      message_content: block?.content || data.messageContent,
      media_url: block?.mediaItems?.[0]?.url || block?.mediaUrl || data.mediaUrl || null,
      poll_options: (block?.type || data.messageType) === 'poll' ? (block?.pollOptions || data.pollOptions) : null,
      poll_max_options: (block?.type || data.messageType) === 'poll' ? (block?.pollMaxOptions ?? data.pollMaxOptions) : 1,
      scheduled_at: scheduledAt.toISOString(),
      send_speed: data.sendSpeed,
      mention_all: data.mentionAll,
      whatsapp_number_id: (campaign as any)?.whatsapp_number_id || selectedNumberId || null,
    };

    if (isDuplicate) {
      // Create new message
      const { error } = await supabase.from('group_campaign_scheduled_messages').insert({
        campaign_id: campaignId,
        ...msgData,
        status: 'pending',
      });
      if (error) throw error;
      toast.success("Mensagem duplicada!");
    } else {
      const { error } = await supabase.from('group_campaign_scheduled_messages').update(msgData).eq('id', id);
      if (error) throw error;
      toast.success("Mensagem atualizada!");
    }
    setEditingMessage(null);
    fetchMessages();
  };

  const sendMessage = async (messageId: string, auto = false) => {
    if (!auto) setIsSending(messageId);
    try {
      // Trigger first batch — cron will continue remaining batches automatically
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-scheduled-send`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledMessageId: messageId }),
      });
      const result = await res.json();
      if (result.success) {
        if (result.complete) {
          toast.success(`Enviada! ${result.sentCount}/${result.total} grupos`);
        } else {
          toast.success(`Iniciado! ${result.processed}/${result.total} grupos enviados, restante será processado automaticamente`);
        }
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
    const base = window.location.origin;
    const url = `${base}/vip/${slug}`;
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

  const deleteLink = async (id: string) => {
    await supabase.from('group_redirect_links').delete().eq('id', id);
    toast.success("Link excluído");
    fetchLinks();
  };

  const duplicateMessage = async (msg: ScheduledMessage) => {
    // Open edit form pre-filled with original content so user can see/edit
    const editMsg: ScheduledMessage = {
      ...msg,
      id: '__duplicate__' + msg.id,
      status: 'pending',
      scheduled_at: msg.scheduled_at,
    };
    setEditingMessage(editMsg);
    setShowMessageForm(true);
  };

  const openImportDialog = async () => {
    setShowImportMessages(true);
    setSelectedImportCampaign(null);
    setOtherMessages([]);
    setSelectedImportMsgs([]);
    setImportFilterDateFrom(undefined);
    setImportFilterDateTo(undefined);
    const { data } = await supabase.from('group_campaigns').select('id, name, created_at')
      .neq('id', campaignId).order('created_at', { ascending: false }).limit(50);
    setOtherCampaigns(data || []);
  };

  const loadOtherCampaignMessages = async (otherCampaignId: string) => {
    setSelectedImportCampaign(otherCampaignId);
    setSelectedImportMsgs([]);
    const { data } = await supabase.from('group_campaign_scheduled_messages')
      .select('*').eq('campaign_id', otherCampaignId).order('scheduled_at', { ascending: true });
    setOtherMessages((data || []) as ScheduledMessage[]);
    if (data && data.length > 0) {
      const first = new Date(data[0].scheduled_at);
      setImportScheduleDate(first);
      setImportScheduleTime(format(first, "HH:mm"));
    }
  };

  const importSelectedMessages = async () => {
    if (selectedImportMsgs.length === 0) { toast.error("Selecione mensagens"); return; }
    setIsImporting(true);
    try {
      const [hours, minutes] = importScheduleTime.split(':').map(Number);
      const baseDate = new Date(importScheduleDate);
      baseDate.setHours(hours, minutes, 0, 0);

      const msgsToImport = otherMessages.filter(m => selectedImportMsgs.includes(m.id));
      for (let i = 0; i < msgsToImport.length; i++) {
        const msg = msgsToImport[i];
        const scheduledAt = new Date(baseDate.getTime() + i * 5000);
        await supabase.from('group_campaign_scheduled_messages').insert({
          campaign_id: campaignId,
          message_type: msg.message_type,
          message_content: msg.message_content,
          media_url: msg.media_url,
          poll_options: msg.poll_options,
          scheduled_at: scheduledAt.toISOString(),
          send_speed: msg.send_speed || 'normal',
          status: 'pending',
          whatsapp_number_id: (campaign as any)?.whatsapp_number_id || selectedNumberId || null,
        } as any);
      }
      toast.success(`${msgsToImport.length} mensagem(ns) importada(s)!`);
      setShowImportMessages(false);
      fetchMessages();
    } catch { toast.error("Erro ao importar"); }
    finally { setIsImporting(false); }
  };

  const targetGroups: string[] = campaign?.target_groups || [];
  const groupCount = targetGroups.length;

  // Check campaign groups status
  const campaignGroups = allGroups.filter(g => targetGroups.includes(g.id));
  const allGroupsFull = campaignGroups.length > 0 && campaignGroups.every(g => g.participant_count >= (g.max_participants || 1024));
  const hasNearFullGroup = campaignGroups.some(g => (g.participant_count || 0) >= 950 && !(g.participant_count >= (g.max_participants || 1024)));
  const hasStandbyGroup = campaignGroups.some(g => (g.participant_count || 0) < 50);

  const getGroupStatusBadge = (g: any) => {
    const count = g.participant_count || 0;
    const isFull = count >= (g.max_participants || 1024);
    if (isFull) return <Badge variant="destructive" className="text-[10px] shrink-0">🔴 Cheio</Badge>;
    if (count >= 950) return <Badge className="text-[10px] bg-amber-500 hover:bg-amber-600 text-white shrink-0">⚠️ Quase cheio</Badge>;
    if (count < 50) return <Badge className="text-[10px] bg-blue-500 hover:bg-blue-600 text-white shrink-0">🔵 Standby</Badge>;
    return <Badge className="text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white shrink-0">🟢 Disponível</Badge>;
  };

  const loadZapiContacts = async () => {
    if (zapiContactsLoaded) return;
    setZapiContactsLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-get-contacts`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success && data.contacts) {
        setZapiContacts(data.contacts);
        setZapiContactsLoaded(true);
      }
    } catch { /* ignore */ }
    finally { setZapiContactsLoading(false); }
  };

  useEffect(() => {
    if (showCreateGroup && !zapiContactsLoaded) loadZapiContacts();
  }, [showCreateGroup]);

  const filteredZapiContacts = useMemo(() => {
    if (!contactSearchQuery.trim()) return zapiContacts.slice(0, 50);
    const q = contactSearchQuery.toLowerCase();
    return zapiContacts.filter(c => c.name.toLowerCase().includes(q) || c.short.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 50);
  }, [zapiContacts, contactSearchQuery]);

  const toggleGroupContact = (contact: { phone: string; name: string; short: string }) => {
    setSelectedGroupContacts(prev => {
      const exists = prev.find(c => c.phone === contact.phone);
      if (exists) return prev.filter(c => c.phone !== contact.phone);
      return [...prev, contact];
    });
  };

  const createGroupForCampaign = async () => {
    if (!newGroupName.trim()) { toast.error("Nome do grupo obrigatório"); return; }
    if (selectedGroupContacts.length === 0) { toast.error("Selecione pelo menos 1 participante"); return; }
    setIsCreatingGroup(true);
    try {
      const phones = selectedGroupContacts.map(c => c.phone);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', groupName: newGroupName.trim(), phones }),
      });
      const result = await res.json();
      const newGroupId = result.groupId || result.data?.phone || result.data?.groupId;
      
      if (result.success && newGroupId) {
        const { data: newGroup } = await supabase.from('whatsapp_groups').insert({
          group_id: newGroupId,
          name: newGroupName.trim(),
          is_vip: true,
          is_active: true,
          participant_count: selectedGroupContacts.length,
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
        setSelectedGroupContacts([]);
        setContactSearchQuery("");
      } else {
        const errMsg = result.data?.message || result.error || "Erro ao criar grupo";
        console.error("Create group response:", JSON.stringify(result));
        toast.error(errMsg);
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
      <div className="space-y-2">
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
        <div className="flex items-center gap-2 pl-10">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Instância WhatsApp:</span>
          <WhatsAppNumberSelector
            className="w-56"
            filterProvider="zapi"
            value={(campaign as any)?.whatsapp_number_id ?? undefined}
            autoSelect={false}
            disabled={!campaign}
            onValueChange={handleCampaignNumberChange}
          />
        </div>
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
            {hasNearFullGroup && hasStandbyGroup && (
              <Alert className="border-emerald-500/50 bg-emerald-500/10">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <AlertDescription className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✅ Grupo standby pronto para receber novos membros
                </AlertDescription>
              </Alert>
            )}
            {hasNearFullGroup && !hasStandbyGroup && !allGroupsFull && (
              <Alert className="border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="flex items-center justify-between">
                  <span className="text-xs text-amber-700 dark:text-amber-400">Grupo próximo do limite! Crie um grupo standby.</span>
                  <Button size="sm" variant="outline" className="gap-1 ml-2 shrink-0" onClick={() => setShowCreateGroup(true)}>
                    <Plus className="h-3.5 w-3.5" /> Criar Standby
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar grupos..." value={groupSearch} onChange={e => setGroupSearch(e.target.value)} className="pl-9" />
              </div>
              <WhatsAppNumberSelector filterProvider="zapi" className="w-[180px] h-9 text-xs" />
              <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={async () => {
                setIsSyncingFromZapi(true);
                try {
                  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
                    method: 'POST',
                    headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ syncToDb: true, whatsapp_number_id: selectedNumberId }),
                  });
                  const data = await res.json();
                  if (data.success) { toast.success(`${data.total} grupos sincronizados do WhatsApp!`); fetchAllGroups(); }
                  else toast.error(data.error || "Erro ao sincronizar");
                } catch { toast.error("Erro ao sincronizar"); }
                finally { setIsSyncingFromZapi(false); }
              }} disabled={isSyncingFromZapi}>
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncingFromZapi ? 'animate-spin' : ''}`} />
                Sincronizar do WhatsApp
              </Button>
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
                  {targetGroups.includes(g.id) && getGroupStatusBadge(g)}
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
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                          <ScrollArea className="max-h-[200px]">
                            {msg.media_url && ['image'].includes(msg.message_type) && (
                              <img src={msg.media_url} alt="" className="max-h-40 rounded-md mt-1 mb-1 object-contain" />
                            )}
                            {msg.media_url && msg.message_type === 'video' && (
                              <video src={msg.media_url} controls className="max-h-40 rounded-md mt-1 mb-1" />
                            )}
                            {msg.media_url && msg.message_type === 'audio' && (
                              <audio src={msg.media_url} controls className="mt-1 mb-1 w-full h-8" />
                            )}
                            {msg.media_url && msg.message_type === 'document' && (
                              <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 underline mt-0.5 block">
                                📄 {msg.media_url.split('/').pop()}
                              </a>
                            )}
                            {msg.message_content && (
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{msg.message_content}</p>
                            )}
                            {msg.poll_options && Array.isArray(msg.poll_options) && (
                              <div className="mt-1 space-y-0.5">
                                {msg.poll_options.map((opt: string, i: number) => (
                                  <p key={i} className="text-[10px] text-muted-foreground">• {opt}</p>
                                ))}
                              </div>
                            )}
                          </ScrollArea>
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
                          {msg.status === 'sent' && (
                            <Button variant="outline" size="icon" className="h-7 w-7" title="Reenviar como nova"
                              onClick={() => duplicateMessage(msg)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                          {(msg.status === 'cancelled' || msg.status === 'failed') && (
                            <>
                              <Button variant="outline" size="icon" className="h-7 w-7" title="Reagendar"
                                onClick={() => duplicateMessage(msg)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                onClick={() => deleteMessage(msg.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
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
          <TabsContent value="calendar" className="space-y-4">
            {/* Calendar grid */}
            <div className="space-y-2">
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
                  const isSelected = calendarSelectedDay && isSameDay(day, calendarSelectedDay);
                  return (
                    <div key={day.toISOString()} 
                      onClick={() => setCalendarSelectedDay(prev => prev && isSameDay(prev, day) ? null : day)}
                      className={cn(
                        "min-h-[48px] p-1 border rounded text-[10px] cursor-pointer hover:bg-muted/50 transition-colors",
                        isSameDay(day, new Date()) && "bg-primary/10 border-primary/30",
                        isSelected && "ring-2 ring-primary border-primary"
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
            </div>

            <Separator />

            {/* Action buttons */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {calendarSelectedDay 
                  ? `MENSAGENS DE ${format(calendarSelectedDay, "dd/MM/yyyy")}` 
                  : `TODAS AS MENSAGENS (${messages.length})`}
              </p>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={openImportDialog}>
                  <Copy className="h-3 w-3" /> Importar
                </Button>
                <Button size="sm" className="gap-1 text-xs" onClick={() => { setEditingMessage(null); setShowMessageForm(true); }}>
                  <Plus className="h-3 w-3" /> Nova
                </Button>
              </div>
            </div>

            {/* Message list below calendar */}
            {(() => {
              const displayMsgs = calendarSelectedDay 
                ? messages.filter(m => isSameDay(new Date(m.scheduled_at), calendarSelectedDay))
                : messages;
              
              if (displayMsgs.length === 0) return (
                <Card><CardContent className="py-6 text-center">
                  <CalendarIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {calendarSelectedDay ? "Nenhuma mensagem neste dia" : "Nenhuma mensagem agendada"}
                  </p>
                </CardContent></Card>
              );

              return (
                <div className="space-y-2">
                  {displayMsgs.map(msg => (
                    <Card key={msg.id} className="overflow-hidden">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                            <ScrollArea className="max-h-[250px]">
                              {msg.media_url && ['image'].includes(msg.message_type) && (
                                <img src={msg.media_url} alt="" className="max-h-40 rounded-md mt-1 mb-1 object-contain" />
                              )}
                              {msg.media_url && msg.message_type === 'video' && (
                                <video src={msg.media_url} controls className="max-h-40 rounded-md mt-1 mb-1" />
                              )}
                              {msg.media_url && msg.message_type === 'audio' && (
                                <audio src={msg.media_url} controls className="mt-1 mb-1 w-full h-8" />
                              )}
                              {msg.media_url && msg.message_type === 'document' && (
                                <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 underline mt-0.5 block">
                                  📄 {msg.media_url.split('/').pop()}
                                </a>
                              )}
                              {msg.message_content && (
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{msg.message_content}</p>
                              )}
                              {msg.poll_options && Array.isArray(msg.poll_options) && (
                                <div className="mt-1 space-y-0.5">
                                  {msg.poll_options.map((opt: string, i: number) => (
                                    <p key={i} className="text-[10px] text-muted-foreground">• {opt}</p>
                                  ))}
                                </div>
                              )}
                            </ScrollArea>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {msg.status === 'pending' && (
                              <>
                                <Button variant="outline" size="icon" className="h-7 w-7" title="Editar"
                                  onClick={() => { setEditingMessage(msg); setShowMessageForm(true); }}>
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button variant="outline" size="icon" className="h-7 w-7" title="Enviar agora"
                                  onClick={() => sendMessage(msg.id)} disabled={isSending === msg.id}>
                                  {isSending === msg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Cancelar"
                                  onClick={() => cancelMessage(msg.id)}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {msg.status === 'sent' && (
                              <Button variant="outline" size="icon" className="h-7 w-7" title="Reenviar como nova"
                                onClick={() => duplicateMessage(msg)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                            {(msg.status === 'cancelled' || msg.status === 'failed') && (
                              <>
                                <Button variant="outline" size="icon" className="h-7 w-7" title="Reagendar"
                                  onClick={() => duplicateMessage(msg)}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Excluir"
                                  onClick={() => deleteMessage(msg.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              );
            })()}
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteLink(link.id)}>
                        <Trash2 className="h-3 w-3" />
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Criar Novo Grupo WhatsApp</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              O grupo será criado automaticamente no WhatsApp e adicionado a esta campanha como VIP. Você (número conectado) será o admin.
            </p>
            <Input placeholder="Nome do grupo (ex: VIP Banana #11)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
            
            {/* Contact picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> Participantes iniciais *
              </Label>

              {selectedGroupContacts.length > 0 && (
                <div className="flex flex-wrap gap-1 p-2 rounded-md border bg-muted/30">
                  {selectedGroupContacts.map(c => (
                    <Badge key={c.phone} variant="secondary" className="gap-1 text-xs pr-1">
                      {c.short || c.name}
                      <button onClick={() => toggleGroupContact(c)} className="ml-0.5 hover:text-destructive">
                        <XCircle className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar contato por nome ou número..."
                  value={contactSearchQuery}
                  onChange={(e) => setContactSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="h-[180px] rounded-md border">
                {zapiContactsLoading ? (
                  <div className="flex items-center justify-center h-full p-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Carregando contatos...</span>
                  </div>
                ) : filteredZapiContacts.length === 0 ? (
                  <div className="flex items-center justify-center h-full p-4">
                    <span className="text-sm text-muted-foreground">
                      {contactSearchQuery ? "Nenhum contato encontrado" : "Nenhum contato salvo"}
                    </span>
                  </div>
                ) : (
                  <div className="p-1">
                    {filteredZapiContacts.map(c => {
                      const isSelected = selectedGroupContacts.some(sc => sc.phone === c.phone);
                      return (
                        <button
                          key={c.phone}
                          onClick={() => toggleGroupContact(c)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between hover:bg-accent transition-colors ${
                            isSelected ? 'bg-primary/10 border border-primary/30' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.short || c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          </div>
                          {isSelected && (
                            <Badge variant="default" className="text-[10px] flex-shrink-0">✓</Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>

              <p className="text-[10px] text-muted-foreground">
                {zapiContacts.length} contatos · {selectedGroupContacts.length} selecionado(s)
              </p>
            </div>
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

      {/* IMPORT MESSAGES DIALOG */}
      <Dialog open={showImportMessages} onOpenChange={setShowImportMessages}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Importar Mensagens de Outra Campanha</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Campaign selector */}
            <div>
              <Label className="text-xs font-medium">Selecione a campanha</Label>
              <Select value={selectedImportCampaign || ''} onValueChange={loadOtherCampaignMessages}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha uma campanha..." /></SelectTrigger>
                <SelectContent>
                  {otherCampaigns.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({format(new Date(c.created_at), "dd/MM/yy")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Messages from selected campaign */}
            {selectedImportCampaign && (
              <>
                {/* Date filter */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Filtrar por data</Label>
                  <div className="flex gap-2 items-center">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {importFilterDateFrom ? format(importFilterDateFrom, "dd/MM/yy") : "De"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={importFilterDateFrom} onSelect={d => setImportFilterDateFrom(d || undefined)} />
                      </PopoverContent>
                    </Popover>
                    <span className="text-xs text-muted-foreground">até</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {importFilterDateTo ? format(importFilterDateTo, "dd/MM/yy") : "Até"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={importFilterDateTo} onSelect={d => setImportFilterDateTo(d || undefined)} />
                      </PopoverContent>
                    </Popover>
                    {(importFilterDateFrom || importFilterDateTo) && (
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setImportFilterDateFrom(undefined); setImportFilterDateTo(undefined); }}>
                        Limpar
                      </Button>
                    )}
                  </div>
                </div>

                {(() => {
                  const filteredImportMsgs = otherMessages.filter(m => {
                    const d = new Date(m.scheduled_at);
                    if (importFilterDateFrom && d < importFilterDateFrom) return false;
                    if (importFilterDateTo) {
                      const end = new Date(importFilterDateTo);
                      end.setHours(23, 59, 59, 999);
                      if (d > end) return false;
                    }
                    return true;
                  });

                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{filteredImportMsgs.length} mensagens{(importFilterDateFrom || importFilterDateTo) ? ' (filtradas)' : ''}</p>
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
                          setSelectedImportMsgs(prev => prev.length === filteredImportMsgs.length ? [] : filteredImportMsgs.map(m => m.id));
                        }}>
                          {selectedImportMsgs.length === filteredImportMsgs.length && filteredImportMsgs.length > 0 ? "Desmarcar todas" : "Selecionar todas"}
                        </Button>
                      </div>
                      <ScrollArea className="h-[250px] rounded-md border">
                        <div className="p-2 space-y-1.5">
                          {filteredImportMsgs.map(msg => (
                            <div key={msg.id} 
                              onClick={() => setSelectedImportMsgs(prev => prev.includes(msg.id) ? prev.filter(x => x !== msg.id) : [...prev, msg.id])}
                              className={cn(
                                "flex items-start gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors",
                                selectedImportMsgs.includes(msg.id) && "bg-primary/10 border-primary/30"
                              )}>
                              <Checkbox checked={selectedImportMsgs.includes(msg.id)} className="mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-xs font-medium">{TYPE_LABELS[msg.message_type] || msg.message_type}</span>
                                  <Badge variant="outline" className="text-[10px]">
                                    {format(new Date(msg.scheduled_at), "dd/MM HH:mm")}
                                  </Badge>
                                </div>
                                {msg.media_url && ['image'].includes(msg.message_type) && (
                                  <img src={msg.media_url} alt="" className="max-h-20 rounded mt-1 mb-1 object-contain" />
                                )}
                                {msg.message_content && (
                                  <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{msg.message_content}</p>
                                )}
                                {msg.media_url && !['image'].includes(msg.message_type) && <p className="text-[10px] text-blue-500 truncate">📎 mídia</p>}
                                {msg.poll_options && Array.isArray(msg.poll_options) && (
                                  <div className="mt-0.5">
                                    {msg.poll_options.map((opt: string, i: number) => (
                                      <p key={i} className="text-[10px] text-muted-foreground">• {opt}</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </>
                  );
                })()}

                <Separator />

                {/* Schedule config */}
                <div className="space-y-2">
                  <p className="text-xs font-medium">Agendar para:</p>
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="flex-1 justify-start text-xs gap-1">
                          <CalendarIcon className="h-3.5 w-3.5" />
                          {format(importScheduleDate, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={importScheduleDate}
                          onSelect={d => d && setImportScheduleDate(d)} />
                      </PopoverContent>
                    </Popover>
                    <Input type="time" value={importScheduleTime} onChange={e => setImportScheduleTime(e.target.value)} className="w-[120px]" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    As mensagens serão importadas com 5s de intervalo a partir deste horário.
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportMessages(false)}>Cancelar</Button>
            <Button onClick={importSelectedMessages} disabled={isImporting || selectedImportMsgs.length === 0} className="gap-1">
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Importar {selectedImportMsgs.length > 0 ? `(${selectedImportMsgs.length})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
