import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, Save, Loader2, Users, Building2, UserPlus, Settings2,
} from "lucide-react";

interface Sector {
  id: string;
  name: string;
  description: string | null;
  ai_routing_keywords: string[] | null;
  is_active: boolean;
  sort_order: number;
}

interface SectorAgent {
  id: string;
  sector_id: string;
  user_id: string;
  is_active: boolean;
  is_online: boolean;
  current_load: number;
  max_concurrent: number;
  last_assigned_at: string | null;
  profile?: { display_name: string; user_id: string };
}

interface Profile {
  user_id: string;
  display_name: string;
}

export function SectorManager() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<SectorAgent[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editSector, setEditSector] = useState<Sector | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [addAgentSectorId, setAddAgentSectorId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formActive, setFormActive] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [sectorsRes, agentsRes, profilesRes] = await Promise.all([
      supabase.from("chat_sectors").select("*").order("sort_order"),
      supabase.from("chat_sector_agents").select("*"),
      supabase.from("profiles").select("user_id, display_name"),
    ]);
    setSectors((sectorsRes.data || []) as Sector[]);
    setAgents((agentsRes.data || []) as SectorAgent[]);
    setProfiles((profilesRes.data || []) as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = () => {
    setEditSector(null);
    setFormName("");
    setFormDescription("");
    setFormKeywords("");
    setFormActive(true);
    setEditOpen(true);
  };

  const openEdit = (sector: Sector) => {
    setEditSector(sector);
    setFormName(sector.name);
    setFormDescription(sector.description || "");
    setFormKeywords((sector.ai_routing_keywords || []).join(", "));
    setFormActive(sector.is_active);
    setEditOpen(true);
  };

  const saveSector = async () => {
    if (!formName.trim()) { toast.error("Nome é obrigatório"); return; }
    const keywords = formKeywords.split(",").map(k => k.trim()).filter(Boolean);
    
    if (editSector) {
      const { error } = await supabase.from("chat_sectors").update({
        name: formName, description: formDescription || null,
        ai_routing_keywords: keywords, is_active: formActive,
      }).eq("id", editSector.id);
      if (error) { toast.error("Erro ao atualizar"); return; }
      toast.success("Setor atualizado!");
    } else {
      const maxOrder = Math.max(0, ...sectors.map(s => s.sort_order));
      const { error } = await supabase.from("chat_sectors").insert({
        name: formName, description: formDescription || null,
        ai_routing_keywords: keywords, is_active: formActive,
        sort_order: maxOrder + 1,
      });
      if (error) { toast.error("Erro ao criar"); return; }
      toast.success("Setor criado!");
    }
    setEditOpen(false);
    fetchAll();
  };

  const deleteSector = async (id: string) => {
    await supabase.from("chat_sector_agents").delete().eq("sector_id", id);
    await supabase.from("chat_sectors").delete().eq("id", id);
    toast.success("Setor excluído");
    fetchAll();
  };

  const addAgent = async () => {
    if (!selectedUserId || !addAgentSectorId) return;
    const { error } = await supabase.from("chat_sector_agents").insert({
      sector_id: addAgentSectorId, user_id: selectedUserId,
    });
    if (error) {
      if (error.code === "23505") toast.error("Agente já está neste setor");
      else toast.error("Erro ao adicionar");
      return;
    }
    toast.success("Agente adicionado!");
    setAddAgentOpen(false);
    setSelectedUserId("");
    fetchAll();
  };

  const removeAgent = async (agentId: string) => {
    await supabase.from("chat_sector_agents").delete().eq("id", agentId);
    toast.success("Agente removido");
    fetchAll();
  };

  const toggleAgentOnline = async (agent: SectorAgent) => {
    await supabase.from("chat_sector_agents").update({ is_online: !agent.is_online }).eq("id", agent.id);
    fetchAll();
  };

  const getProfileName = (userId: string) => {
    return profiles.find(p => p.user_id === userId)?.display_name || userId.slice(0, 8);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Configure setores de atendimento e distribua leads automaticamente via round-robin.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1">
          <Plus className="h-3.5 w-3.5" />Novo Setor
        </Button>
      </div>

      {sectors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum setor configurado</p>
            <Button size="sm" className="mt-3 gap-1" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />Criar primeiro setor
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sectors.map(sector => {
            const sectorAgents = agents.filter(a => a.sector_id === sector.id);
            const onlineCount = sectorAgents.filter(a => a.is_online).length;
            return (
              <Card key={sector.id} className={`${!sector.is_active ? "opacity-60" : ""}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      {sector.name}
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(sector)}>
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteSector(sector.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {sector.description && (
                    <p className="text-[10px] text-muted-foreground">{sector.description}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Keywords */}
                  {sector.ai_routing_keywords && sector.ai_routing_keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sector.ai_routing_keywords.slice(0, 6).map(kw => (
                        <Badge key={kw} variant="outline" className="text-[9px] px-1.5 py-0">{kw}</Badge>
                      ))}
                      {sector.ai_routing_keywords.length > 6 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0">+{sector.ai_routing_keywords.length - 6}</Badge>
                      )}
                    </div>
                  )}

                  {/* Agents */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase">
                        Agentes ({sectorAgents.length}) · {onlineCount} online
                      </span>
                      <Button
                        variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2"
                        onClick={() => { setAddAgentSectorId(sector.id); setAddAgentOpen(true); }}
                      >
                        <UserPlus className="h-3 w-3" />Adicionar
                      </Button>
                    </div>
                    {sectorAgents.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground py-2">Nenhum agente atribuído</p>
                    ) : (
                      <div className="space-y-1">
                        {sectorAgents.map(agent => (
                          <div key={agent.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/50 text-xs">
                            <div className={`w-2 h-2 rounded-full ${agent.is_online ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                            <span className="flex-1 truncate">{getProfileName(agent.user_id)}</span>
                            <span className="text-[10px] text-muted-foreground">{agent.current_load}/{agent.max_concurrent}</span>
                            <Switch
                              checked={agent.is_online}
                              onCheckedChange={() => toggleAgentOnline(agent)}
                              className="scale-75"
                            />
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeAgent(agent.id)}>
                              <Trash2 className="h-2.5 w-2.5 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] pt-1 border-t border-border">
                    <span className={sector.is_active ? "text-green-600" : "text-muted-foreground"}>
                      {sector.is_active ? "● Ativo" : "○ Inativo"}
                    </span>
                    <span className="text-muted-foreground">Round-robin automático</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit/Create Sector Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSector ? "Editar Setor" : "Novo Setor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Vendas" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Descrição para a IA entender quando rotear..." rows={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Palavras-chave para IA (separadas por vírgula)</Label>
              <Textarea value={formKeywords} onChange={e => setFormKeywords(e.target.value)} placeholder="comprar, preço, produto, tamanho, disponível" rows={2} />
              <p className="text-[10px] text-muted-foreground">A IA usará essas palavras + a descrição para decidir o roteamento</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Ativo</Label>
              <Switch checked={formActive} onCheckedChange={setFormActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveSector} className="gap-1"><Save className="h-3.5 w-3.5" />Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Agent Dialog */}
      <Dialog open={addAgentOpen} onOpenChange={setAddAgentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adicionar Agente ao Setor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Usuário</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddAgentOpen(false)}>Cancelar</Button>
            <Button onClick={addAgent} disabled={!selectedUserId} className="gap-1">
              <UserPlus className="h-3.5 w-3.5" />Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
