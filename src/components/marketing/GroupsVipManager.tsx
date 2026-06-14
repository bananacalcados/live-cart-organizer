import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, RefreshCw, Send, Plus, Search, Star, Loader2,
  Settings, CheckCircle, XCircle, Crown, Link as LinkIcon,
  MapPin, AlertTriangle, Smartphone
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { GroupSettingsPanel } from "./GroupSettingsPanel";
import { CampaignDetailPanel } from "./CampaignDetailPanel";
import { VipStrategyPanel } from "./VipStrategyPanel";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";

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
  is_full: boolean;
  tags: string[];
  instance_id: string | null;
  last_synced_at: string | null;
  max_participants: number;
  invite_link: string | null;
  only_admins_send: boolean;
  only_admins_add: boolean;
  ddd33_count: number | null;
  ddd33_total_resolved: number | null;
  ddd33_synced_at: string | null;
}

interface InstanceInfo {
  id: string;
  label: string;
  provider: string | null;
  is_active: boolean;
  is_online: boolean | null;
  zapi_instance_id: string | null;
}


interface GroupCampaign {
  id: string;
  name: string;
  status: string;
  message_type: string;
  target_groups: string[];
  total_groups: number;
  sent_count: number;
  failed_count: number;
  send_speed: string;
  created_at: string;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  active: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

export function GroupsVipManager() {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [campaigns, setCampaigns] = useState<GroupCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignSpeed, setNewCampaignSpeed] = useState("slow");
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [settingsGroup, setSettingsGroup] = useState<WhatsAppGroup | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [instanceFilter, setInstanceFilter] = useState("all");
  const [sortByDdd33, setSortByDdd33] = useState(false);
  const [isAnalyzingDdd, setIsAnalyzingDdd] = useState(false);

  const selectedNumberId = useWhatsAppNumberStore(s => s.selectedNumberId);

  const fetchInstances = useCallback(async () => {
    const { data } = await supabase
      .from('whatsapp_numbers_safe')
      .select('id, label, provider, is_active, is_online, zapi_instance_id');
    setInstances((data || []) as InstanceInfo[]);
  }, []);

  // Resolve o instance_id de um grupo (uuid moderno OU zapi_instance_id legado).
  const resolveInstance = useCallback((instanceId: string | null): InstanceInfo | null => {
    if (!instanceId) return null;
    return instances.find(i => i.id === instanceId || i.zapi_instance_id === instanceId) || null;
  }, [instances]);

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
    } catch { toast.error("Erro ao carregar grupos"); }
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
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchGroups(); fetchCampaigns(); fetchInstances(); }, [fetchGroups, fetchCampaigns, fetchInstances]);

  // Analisa quantas pessoas com DDD 33 (Gov. Valadares) cada grupo da instância selecionada tem.
  const analyzeDdd33 = async () => {
    const selected = resolveInstance(selectedNumberId);
    if (!selectedNumberId || selected?.provider !== 'uazapi') {
      toast.error("Selecione uma instância uazapi para analisar DDD 33");
      return;
    }
    setIsAnalyzingDdd(true);
    toast.info("Analisando participantes... isso pode levar alguns minutos.");
    try {
      const { data, error } = await supabase.functions.invoke('uazapi-groups', {
        body: { action: 'dddStats', whatsapp_number_id: selectedNumberId },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`${data.processed}/${data.total} grupos analisados${data.remaining ? ` · ${data.remaining} restantes (rode de novo)` : ''}`);
        fetchGroups();
      } else {
        toast.error(data?.error || "Erro na análise");
      }
    } catch { toast.error("Erro ao analisar DDD 33"); }
    finally { setIsAnalyzingDdd(false); }
  };





  const syncGroups = async () => {
    setIsSyncing(true);
    try {
      const { numbers, selectedNumberId: numId } = useWhatsAppNumberStore.getState();
      const selected = numbers.find(n => n.id === numId);
      const provider = selected?.provider || "zapi";

      if (provider === "wasender" || provider === "uazapi") {
        const fn = provider === "uazapi" ? "uazapi-groups" : "wasender-groups";
        const { data, error } = await supabase.functions.invoke(fn, {
          body: { action: "list", syncToDb: true, whatsapp_number_id: numId },
        });
        if (error) throw error;
        if (data?.success) { toast.success(`${data.total ?? 0} grupos sincronizados!`); fetchGroups(); }
        else toast.error(data?.error || "Erro");
      } else {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-list-groups`, {
          method: 'POST',
          headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncToDb: true, whatsapp_number_id: numId }),
        });
        const data = await res.json();
        if (data.success) { toast.success(`${data.total} grupos sincronizados!`); fetchGroups(); }
        else toast.error(data.error || "Erro");
      }
    } catch { toast.error("Erro ao sincronizar"); }
    finally { setIsSyncing(false); }
  };

  const toggleVip = async (group: WhatsAppGroup) => {
    await supabase.from('whatsapp_groups').update({ is_vip: !group.is_vip }).eq('id', group.id);
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_vip: !g.is_vip } : g));
  };

  const toggleFull = async (group: WhatsAppGroup) => {
    await supabase.from('whatsapp_groups').update({ is_full: !group.is_full }).eq('id', group.id);
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_full: !g.is_full } : g));
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedGroups(checked ? filteredGroups.map(g => g.id) : []);
  };

  const createCampaign = async () => {
    if (!newCampaignName.trim()) { toast.error("Nome obrigatório"); return; }
    setIsCreatingCampaign(true);
    try {
      const groupsToUse = selectedGroups.length > 0 ? selectedGroups : [];
      const { selectedNumberId } = useWhatsAppNumberStore.getState();
      const { data, error } = await supabase.from('group_campaigns').insert({
        name: newCampaignName,
        target_groups: groupsToUse,
        total_groups: groupsToUse.length,
        send_speed: newCampaignSpeed,
        status: 'active',
        whatsapp_number_id: selectedNumberId || null,
      } as any).select().single();
      if (error) throw error;
      toast.success("Campanha criada!");
      setShowCreateCampaign(false);
      setNewCampaignName("");
      setSelectedGroups([]);
      fetchCampaigns();
      setSelectedCampaignId(data.id);
    } catch { toast.error("Erro ao criar"); }
    finally { setIsCreatingCampaign(false); }
  };

  // Grupos por instância (chave = instance_id bruto do grupo) para o filtro.
  const instanceGroupCounts = groups.reduce<Record<string, number>>((acc, g) => {
    const key = g.instance_id || '__none__';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const instanceOptions = Object.keys(instanceGroupCounts).map(key => {
    if (key === '__none__') return { key, label: 'Sem instância', count: instanceGroupCounts[key] };
    const info = resolveInstance(key);
    return { key, label: info ? info.label : `Desconhecida (${key.slice(0, 8)}…)`, count: instanceGroupCounts[key] };
  });

  const sortGroups = (arr: WhatsAppGroup[]) =>
    sortByDdd33
      ? [...arr].sort((a, b) => (b.ddd33_count ?? -1) - (a.ddd33_count ?? -1))
      : arr;

  const filteredGroups = groups.filter(g => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!g.name.toLowerCase().includes(q) && !g.group_id.includes(q)) return false;
    }
    if (instanceFilter !== 'all') {
      const key = g.instance_id || '__none__';
      if (key !== instanceFilter) return false;
    }
    if (groupFilter === 'vip') return g.is_vip;
    if (groupFilter === 'full') return g.is_full;
    if (groupFilter === 'available') return !g.is_full;
    return true;
  });

  const vipGroups = sortGroups(filteredGroups.filter(g => g.is_vip));
  const otherGroups = sortGroups(filteredGroups.filter(g => !g.is_vip));


  // If a campaign is selected, show detail view
  if (selectedCampaignId) {
    return <CampaignDetailPanel campaignId={selectedCampaignId} onBack={() => { setSelectedCampaignId(null); fetchCampaigns(); }} />;
  }

  return (
    <div className="space-y-4">
      {/* Strategy element above campaigns */}
      <VipStrategyPanel />

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns" className="gap-1"><Send className="h-3.5 w-3.5" />Campanhas</TabsTrigger>
          <TabsTrigger value="groups" className="gap-1"><Users className="h-3.5 w-3.5" />Grupos</TabsTrigger>
        </TabsList>

        {/* GROUPS TAB */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar grupos..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="vip">⭐ VIP</SelectItem>
                <SelectItem value="full">🔴 Cheios</SelectItem>
                <SelectItem value="available">🟢 Disponíveis</SelectItem>
              </SelectContent>
            </Select>
            <Select value={instanceFilter} onValueChange={setInstanceFilter}>
              <SelectTrigger className="w-[190px]">
                <Smartphone className="h-3.5 w-3.5 mr-1 shrink-0" />
                <SelectValue placeholder="Instância" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as instâncias</SelectItem>
                {instanceOptions.map(opt => (
                  <SelectItem key={opt.key} value={opt.key}>{opt.label} ({opt.count})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={sortByDdd33 ? "default" : "outline"}
              size="sm"
              onClick={() => setSortByDdd33(v => !v)}
              className="gap-1"
              title="Ordenar pelos grupos com mais pessoas de Valadares (DDD 33)"
            >
              <MapPin className="h-3.5 w-3.5" />DDD 33
            </Button>
            <WhatsAppNumberSelector allowedProviders={["zapi", "wasender", "uazapi"]} className="w-[180px] h-9 text-xs" />
            <Button variant="outline" size="sm" onClick={syncGroups} disabled={isSyncing} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />Sincronizar
            </Button>
            <Button variant="outline" size="sm" onClick={analyzeDdd33} disabled={isAnalyzingDdd} className="gap-1"
              title="Conta quantas pessoas de Valadares (DDD 33) há em cada grupo da instância selecionada">
              {isAnalyzingDdd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              Analisar DDD 33
            </Button>
            <Button size="sm" onClick={() => setShowCreateGroup(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" />Criar Grupo
            </Button>
          </div>


          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : groups.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">Nenhum grupo sincronizado.</p>
              <Button variant="outline" className="mt-4 gap-1" onClick={syncGroups}><RefreshCw className="h-4 w-4" />Sincronizar</Button>
            </CardContent></Card>
          ) : (
            <ScrollArea className="h-[calc(100vh-400px)]">
              <div className="space-y-4">
                {vipGroups.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <Crown className="h-3.5 w-3.5 text-amber-500" /> VIP ({vipGroups.length})
                    </p>
                    <div className="grid gap-2">
                      {vipGroups.map(g => (
                        <GroupCard key={g.id} group={g} isSelected={selectedGroups.includes(g.id)}
                          instance={resolveInstance(g.instance_id)}
                          canSend={!selectedNumberId || resolveInstance(g.instance_id)?.id === selectedNumberId}
                          onToggleSelect={id => setSelectedGroups(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                          onToggleVip={() => toggleVip(g)} onToggleFull={() => toggleFull(g)}
                          onOpenSettings={() => setSettingsGroup(g)} />
                      ))}

                    </div>
                  </div>
                )}
                {otherGroups.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">OUTROS ({otherGroups.length})</p>
                    <div className="grid gap-2">
                      {otherGroups.map(g => (
                        <GroupCard key={g.id} group={g} isSelected={selectedGroups.includes(g.id)}
                          onToggleSelect={id => setSelectedGroups(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                          onToggleVip={() => toggleVip(g)} onToggleFull={() => toggleFull(g)}
                          onOpenSettings={() => setSettingsGroup(g)} />
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
            <Button size="sm" onClick={() => setShowCreateCampaign(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" />Nova Campanha
            </Button>
          </div>
          <ScrollArea className="h-[calc(100vh-340px)]">
            <div className="space-y-2">
              {campaigns.length === 0 ? (
                <Card><CardContent className="py-12 text-center">
                  <Send className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">Nenhuma campanha.</p>
                </CardContent></Card>
              ) : campaigns.map(c => (
                <Card key={c.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedCampaignId(c.id)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString('pt-BR')} · {c.total_groups} grupos · {c.send_speed}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={STATUS_COLORS[c.status] || ''}>
                          {c.status === 'draft' ? 'Rascunho' : c.status === 'sending' ? 'Enviando' :
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
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* CREATE CAMPAIGN DIALOG */}
      <Dialog open={showCreateCampaign} onOpenChange={setShowCreateCampaign}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Campanha</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome da campanha" value={newCampaignName} onChange={e => setNewCampaignName(e.target.value)} />
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
              <p className="font-medium">🐢 Modo Humano (padrão)</p>
              <p className="text-muted-foreground leading-relaxed">
                Envio sequencial: todos os blocos em um grupo, depois pula pro próximo.<br />
                • 8–15s entre blocos • 45–90s entre grupos • pausa longa a cada 3 grupos
              </p>
              <p className="text-muted-foreground">Reduz drasticamente risco de banimento da Meta.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCampaign(false)}>Cancelar</Button>
            <Button onClick={createCampaign} disabled={isCreatingCampaign} className="gap-1">
              {isCreatingCampaign ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar Campanha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GROUP SETTINGS */}
      {settingsGroup && (
        <GroupSettingsPanel group={settingsGroup} open={!!settingsGroup}
          onOpenChange={open => { if (!open) setSettingsGroup(null); }}
          onUpdate={() => { fetchGroups(); setSettingsGroup(null); }} />
      )}

      {/* CREATE GROUP */}
      <CreateGroupDialog
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
        onCreated={() => { syncGroups(); }}
      />
    </div>
  );
}

function GroupCard({ group, isSelected, onToggleSelect, onToggleVip, onToggleFull, onOpenSettings }: {
  group: WhatsAppGroup;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleVip: () => void;
  onToggleFull: () => void;
  onOpenSettings: () => void;
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{group.participant_count}/{group.max_participants}</span>
          {group.is_admin && <Badge variant="secondary" className="text-[10px]">Admin</Badge>}
          {group.is_full && <Badge variant="destructive" className="text-[10px]">Cheio</Badge>}
          {group.invite_link && <LinkIcon className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); onToggleFull(); }}
          title={group.is_full ? "Marcar disponível" : "Marcar cheio"}>
          <div className={`h-2.5 w-2.5 rounded-full ${group.is_full ? 'bg-red-500' : 'bg-emerald-500'}`} />
        </Button>
        <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onToggleVip(); }}
          className={`h-8 w-8 ${group.is_vip ? 'text-amber-500' : 'text-muted-foreground'}`}>
          <Star className={`h-4 w-4 ${group.is_vip ? 'fill-amber-500' : ''}`} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); onOpenSettings(); }}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
