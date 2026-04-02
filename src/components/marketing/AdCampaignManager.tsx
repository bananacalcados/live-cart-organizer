import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, Trash2, Save, Loader2, ChevronDown, ChevronUp,
  Zap, Target, Users, Calendar, Brain, Eye, EyeOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import AdCampaignPromptEditor from "./AdCampaignPromptEditor";

interface CatalogProduct {
  nome: string;
  preco: string;
  keywords: string[];
  detalhes?: string;
}

interface Campaign {
  id: string;
  name: string;
  objective: string;
  activation_keywords: string[];
  prompt: string;
  product_info: any;
  payment_conditions: string | null;
  event_id: string | null;
  data_to_collect: string[];
  whatsapp_number_id: string | null;
  is_active: boolean;
  post_sale_action: string;
  post_capture_action: string;
  created_at: string;
}

interface NurtureStep {
  id: string;
  campaign_id: string;
  days_before_event: number;
  send_time: string;
  meta_template_name: string | null;
  zapi_message_text: string | null;
  meta_template_vars: any;
  is_active: boolean;
  sort_order: number;
}

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  temperature: string;
  collected_data: any;
  source: string;
  campaign_id: string | null;
  created_at: string;
  last_ai_contact_at: string | null;
}

export default function AdCampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [newDataField, setNewDataField] = useState('');
  const [nurtureSteps, setNurtureSteps] = useState<NurtureStep[]>([]);
  const [showLeads, setShowLeads] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newProductKeyword, setNewProductKeyword] = useState<Record<number, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [campaignsRes, eventsRes] = await Promise.all([
      supabase.from('ad_campaigns_ai').select('*').order('created_at', { ascending: false }),
      supabase.from('events').select('id, name, starts_at, status').order('created_at', { ascending: false }).limit(20),
    ]);
    setCampaigns((campaignsRes.data as any[]) || []);
    setEvents(eventsRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchLeads = async (campaignId: string) => {
    const { data } = await supabase
      .from('ad_leads')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(100);
    setLeads((data as any[]) || []);
    setShowLeads(campaignId);
  };

  const fetchNurtureSteps = async (campaignId: string) => {
    const { data } = await supabase
      .from('ad_campaign_nurture_steps')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('sort_order');
    setNurtureSteps((data as any[]) || []);
  };

  const createCampaign = async () => {
    const { data, error } = await supabase
      .from('ad_campaigns_ai')
      .insert({ name: 'Nova Campanha', objective: 'hibrido', prompt: 'Você é uma atendente simpática da Banana Calçados.' })
      .select()
      .single();
    if (error) { toast.error('Erro ao criar campanha'); return; }
    setCampaigns([data as any, ...campaigns]);
    setEditingCampaign(data as any);
    toast.success('Campanha criada!');
  };

  const saveCampaign = async () => {
    if (!editingCampaign) return;
    setSaving(true);
    const { error } = await supabase
      .from('ad_campaigns_ai')
      .update({
        name: editingCampaign.name,
        objective: editingCampaign.objective,
        activation_keywords: editingCampaign.activation_keywords,
        prompt: editingCampaign.prompt,
        product_info: editingCampaign.product_info,
        payment_conditions: editingCampaign.payment_conditions,
        event_id: editingCampaign.event_id || null,
        data_to_collect: editingCampaign.data_to_collect,
        is_active: editingCampaign.is_active,
        post_sale_action: editingCampaign.post_sale_action,
        post_capture_action: editingCampaign.post_capture_action,
      })
      .eq('id', editingCampaign.id);

    setSaving(false);
    if (error) { toast.error('Erro ao salvar'); return; }
    toast.success('Campanha salva!');
    fetchData();
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm('Excluir esta campanha?')) return;
    await supabase.from('ad_campaigns_ai').delete().eq('id', id);
    setCampaigns(campaigns.filter(c => c.id !== id));
    if (editingCampaign?.id === id) setEditingCampaign(null);
    toast.success('Campanha excluída');
  };

  const addNurtureStep = async (campaignId: string) => {
    const { data, error } = await supabase
      .from('ad_campaign_nurture_steps')
      .insert({ campaign_id: campaignId, days_before_event: 3, zapi_message_text: 'Oi {{nome}}! A live {{nome_evento}} será dia {{data_evento}} 🔥' })
      .select()
      .single();
    if (!error && data) {
      setNurtureSteps([...nurtureSteps, data as any]);
      toast.success('Etapa de nutrição adicionada');
    }
  };

  const updateNurtureStep = async (stepId: string, updates: Partial<NurtureStep>) => {
    await supabase.from('ad_campaign_nurture_steps').update(updates).eq('id', stepId);
    setNurtureSteps(nurtureSteps.map(s => s.id === stepId ? { ...s, ...updates } : s));
  };

  const deleteNurtureStep = async (stepId: string) => {
    await supabase.from('ad_campaign_nurture_steps').delete().eq('id', stepId);
    setNurtureSteps(nurtureSteps.filter(s => s.id !== stepId));
  };

  const temperatureColor = (temp: string) => {
    switch (temp) {
      case 'frio': return 'bg-blue-500/20 text-blue-400';
      case 'morno': return 'bg-yellow-500/20 text-yellow-400';
      case 'quente': return 'bg-orange-500/20 text-orange-400';
      case 'super_quente': return 'bg-red-500/20 text-red-400';
      case 'convertido': return 'bg-green-500/20 text-green-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const objectiveLabel = (obj: string) => {
    switch (obj) {
      case 'venda_direta': return '💰 Venda Direta';
      case 'captacao_live': return '🎥 Captação Live';
      case 'hibrido': return '🔄 Híbrido';
      default: return obj;
    }
  };

  if (loading) return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Agente IA de Ads
          </h3>
          <p className="text-sm text-muted-foreground">Configure campanhas de IA para qualificar leads de Meta Ads</p>
        </div>
        <Button onClick={createCampaign} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Nova Campanha
        </Button>
      </div>

      {/* Campaign List */}
      <div className="grid gap-3">
        {campaigns.map(campaign => (
          <Card key={campaign.id} className={`cursor-pointer transition-all ${editingCampaign?.id === campaign.id ? 'ring-2 ring-primary' : ''} ${!campaign.is_active ? 'opacity-60' : ''}`}>
            <CardHeader className="pb-2" onClick={() => {
              setEditingCampaign(editingCampaign?.id === campaign.id ? null : campaign);
              if (editingCampaign?.id !== campaign.id) fetchNurtureSteps(campaign.id);
            }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{campaign.name}</CardTitle>
                  <Badge variant="outline" className="text-xs">{objectiveLabel(campaign.objective)}</Badge>
                  {!campaign.is_active && <Badge variant="secondary" className="text-xs">Inativa</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{campaign.activation_keywords.length} keywords</Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); fetchLeads(campaign.id); }}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deleteCampaign(campaign.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            {editingCampaign?.id === campaign.id && (
              <CardContent className="space-y-4 pt-0">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Nome da Campanha</Label>
                    <Input value={editingCampaign.name} onChange={e => setEditingCampaign({ ...editingCampaign, name: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Objetivo</Label>
                    <Select value={editingCampaign.objective} onValueChange={v => setEditingCampaign({ ...editingCampaign, objective: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="venda_direta">💰 Venda Direta</SelectItem>
                        <SelectItem value="captacao_live">🎥 Captação Live</SelectItem>
                        <SelectItem value="hibrido">🔄 Híbrido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Event link */}
                <div>
                  <Label className="text-xs">Evento/Live vinculado</Label>
                  <Select value={editingCampaign.event_id || 'none'} onValueChange={v => setEditingCampaign({ ...editingCampaign, event_id: v === 'none' ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {events.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name} ({new Date(e.starts_at).toLocaleDateString('pt-BR')})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Activation Keywords */}
                <div>
                  <Label className="text-xs">Frases-chave de ativação</Label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {editingCampaign.activation_keywords.map((kw, i) => (
                      <Badge key={i} variant="secondary" className="text-xs cursor-pointer" onClick={() => {
                        setEditingCampaign({
                          ...editingCampaign,
                          activation_keywords: editingCampaign.activation_keywords.filter((_, j) => j !== i)
                        });
                      }}>
                        {kw} ✕
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newKeyword}
                      onChange={e => setNewKeyword(e.target.value)}
                      placeholder="Ex: quero comprar o tênis"
                      className="text-sm"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newKeyword.trim()) {
                          setEditingCampaign({
                            ...editingCampaign,
                            activation_keywords: [...editingCampaign.activation_keywords, newKeyword.trim()]
                          });
                          setNewKeyword('');
                        }
                      }}
                    />
                    <Button size="sm" variant="outline" onClick={() => {
                      if (newKeyword.trim()) {
                        setEditingCampaign({
                          ...editingCampaign,
                          activation_keywords: [...editingCampaign.activation_keywords, newKeyword.trim()]
                        });
                        setNewKeyword('');
                      }
                    }}>+</Button>
                  </div>
                </div>

                {/* Prompt */}
                <div>
                  <Label className="text-xs">Prompt / Instruções da IA</Label>
                  <Textarea
                    value={editingCampaign.prompt}
                    onChange={e => setEditingCampaign({ ...editingCampaign, prompt: e.target.value })}
                    rows={6}
                    placeholder="Instruções para a IA..."
                    className="text-sm"
                  />
                </div>

                {/* Data to collect */}
                <div>
                  <Label className="text-xs">Dados a coletar</Label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {editingCampaign.data_to_collect.map((field, i) => (
                      <Badge key={i} variant="outline" className="text-xs cursor-pointer" onClick={() => {
                        setEditingCampaign({
                          ...editingCampaign,
                          data_to_collect: editingCampaign.data_to_collect.filter((_, j) => j !== i)
                        });
                      }}>
                        {field} ✕
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newDataField}
                      onChange={e => setNewDataField(e.target.value)}
                      placeholder="Ex: email, cidade"
                      className="text-sm"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newDataField.trim()) {
                          setEditingCampaign({
                            ...editingCampaign,
                            data_to_collect: [...editingCampaign.data_to_collect, newDataField.trim()]
                          });
                          setNewDataField('');
                        }
                      }}
                    />
                    <Button size="sm" variant="outline" onClick={() => {
                      if (newDataField.trim()) {
                        setEditingCampaign({
                          ...editingCampaign,
                          data_to_collect: [...editingCampaign.data_to_collect, newDataField.trim()]
                        });
                        setNewDataField('');
                      }
                    }}>+</Button>
                  </div>
                </div>

                {/* Payment conditions */}
                <div>
                  <Label className="text-xs">Condições de pagamento</Label>
                  <Input
                    value={editingCampaign.payment_conditions || ''}
                    onChange={e => setEditingCampaign({ ...editingCampaign, payment_conditions: e.target.value })}
                    placeholder="Ex: PIX, cartão até 3x, boleto..."
                    className="text-sm"
                  />
                </div>

                {/* Product Catalog */}
                <div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold flex items-center gap-1">
                      <Target className="h-4 w-4" /> Catálogo de Produtos
                    </Label>
                    <Button size="sm" variant="outline" onClick={() => {
                      const catalogo = editingCampaign.product_info?.catalogo || [];
                      setEditingCampaign({
                        ...editingCampaign,
                        product_info: {
                          ...editingCampaign.product_info,
                          catalogo: [...catalogo, { nome: '', preco: '', keywords: [], detalhes: '' }],
                        },
                      });
                    }}>
                      <Plus className="h-3 w-3 mr-1" /> Produto
                    </Button>
                  </div>
                  {(editingCampaign.product_info?.catalogo || []).map((prod: CatalogProduct, idx: number) => (
                    <div key={idx} className="border rounded p-2 space-y-2 bg-muted/30">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-xs">Nome do Produto</Label>
                          <Input
                            value={prod.nome}
                            onChange={e => {
                              const catalogo = [...(editingCampaign.product_info?.catalogo || [])];
                              catalogo[idx] = { ...catalogo[idx], nome: e.target.value };
                              setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                            }}
                            placeholder="Ex: Tênis Runner Pro"
                            className="text-sm h-8"
                          />
                        </div>
                        <div className="w-28">
                          <Label className="text-xs">Preço (R$)</Label>
                          <Input
                            value={prod.preco}
                            onChange={e => {
                              const catalogo = [...(editingCampaign.product_info?.catalogo || [])];
                              catalogo[idx] = { ...catalogo[idx], preco: e.target.value };
                              setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                            }}
                            placeholder="199,90"
                            className="text-sm h-8"
                          />
                        </div>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive mt-4" onClick={() => {
                          const catalogo = (editingCampaign.product_info?.catalogo || []).filter((_: any, i: number) => i !== idx);
                          setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                        }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div>
                        <Label className="text-xs">Detalhes</Label>
                        <Input
                          value={prod.detalhes || ''}
                          onChange={e => {
                            const catalogo = [...(editingCampaign.product_info?.catalogo || [])];
                            catalogo[idx] = { ...catalogo[idx], detalhes: e.target.value };
                            setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                          }}
                          placeholder="Ex: Cores: preto, branco. Tamanhos: 34-42"
                          className="text-sm h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Keywords do produto (frases que identificam este produto)</Label>
                        <div className="flex flex-wrap gap-1 mb-1">
                          {(prod.keywords || []).map((kw, ki) => (
                            <Badge key={ki} variant="secondary" className="text-xs cursor-pointer" onClick={() => {
                              const catalogo = [...(editingCampaign.product_info?.catalogo || [])];
                              catalogo[idx] = { ...catalogo[idx], keywords: prod.keywords.filter((_, j) => j !== ki) };
                              setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                            }}>
                              {kw} ✕
                            </Badge>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={newProductKeyword[idx] || ''}
                            onChange={e => setNewProductKeyword({ ...newProductKeyword, [idx]: e.target.value })}
                            placeholder="Ex: tênis runner"
                            className="text-sm h-8"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newProductKeyword[idx]?.trim()) {
                                const catalogo = [...(editingCampaign.product_info?.catalogo || [])];
                                catalogo[idx] = { ...catalogo[idx], keywords: [...(prod.keywords || []), newProductKeyword[idx].trim()] };
                                setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                                setNewProductKeyword({ ...newProductKeyword, [idx]: '' });
                              }
                            }}
                          />
                          <Button size="sm" variant="outline" className="h-8" onClick={() => {
                            if (newProductKeyword[idx]?.trim()) {
                              const catalogo = [...(editingCampaign.product_info?.catalogo || [])];
                              catalogo[idx] = { ...catalogo[idx], keywords: [...(prod.keywords || []), newProductKeyword[idx].trim()] };
                              setEditingCampaign({ ...editingCampaign, product_info: { ...editingCampaign.product_info, catalogo } });
                              setNewProductKeyword({ ...newProductKeyword, [idx]: '' });
                            }
                          }}>+</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!editingCampaign.product_info?.catalogo || editingCampaign.product_info.catalogo.length === 0) && (
                    <p className="text-xs text-muted-foreground text-center py-2">Nenhum produto. Clique em "+ Produto" para adicionar ao catálogo.</p>
                  )}
                </div>


                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Pós-venda</Label>
                    <Select value={editingCampaign.post_sale_action} onValueChange={v => setEditingCampaign({ ...editingCampaign, post_sale_action: v })}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="convite_live">Convidar pra Live</SelectItem>
                        <SelectItem value="nenhum">Nenhum</SelectItem>
                        <SelectItem value="upsell">Upsell</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Pós-captação</Label>
                    <Select value={editingCampaign.post_capture_action} onValueChange={v => setEditingCampaign({ ...editingCampaign, post_capture_action: v })}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="oferta_produto">Oferecer produto</SelectItem>
                        <SelectItem value="nenhum">Nenhum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Active toggle */}
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editingCampaign.is_active}
                    onCheckedChange={v => setEditingCampaign({ ...editingCampaign, is_active: v })}
                  />
                  <Label className="text-sm">{editingCampaign.is_active ? 'Campanha ativa' : 'Campanha inativa'}</Label>
                </div>

                {/* Nurture Steps */}
                {editingCampaign.event_id && (
                  <div className="border rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold flex items-center gap-1">
                        <Calendar className="h-4 w-4" /> Etapas de Nutrição (pré-Live)
                      </Label>
                      <Button size="sm" variant="outline" onClick={() => addNurtureStep(editingCampaign.id)}>
                        <Plus className="h-3 w-3 mr-1" /> Etapa
                      </Button>
                    </div>
                    {nurtureSteps.map(step => (
                      <div key={step.id} className="border rounded p-2 space-y-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <Label className="text-xs">Dias antes do evento</Label>
                            <Input
                              type="number"
                              value={step.days_before_event}
                              onChange={e => updateNurtureStep(step.id, { days_before_event: parseInt(e.target.value) || 0 })}
                              className="text-sm h-8"
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs">Horário (BR)</Label>
                            <Input
                              type="time"
                              value={step.send_time?.slice(0, 5) || '10:00'}
                              onChange={e => updateNurtureStep(step.id, { send_time: e.target.value + ':00' })}
                              className="text-sm h-8"
                            />
                          </div>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive mt-4" onClick={() => deleteNurtureStep(step.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <Label className="text-xs">Template Meta (para canais Meta API)</Label>
                          <Input
                            value={step.meta_template_name || ''}
                            onChange={e => updateNurtureStep(step.id, { meta_template_name: e.target.value || null })}
                            placeholder="Nome do template aprovado na Meta"
                            className="text-sm h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Mensagem Z-API (texto livre)</Label>
                          <Textarea
                            value={step.zapi_message_text || ''}
                            onChange={e => updateNurtureStep(step.id, { zapi_message_text: e.target.value || null })}
                            placeholder="Variáveis: {{nome}}, {{data_evento}}, {{hora_evento}}, {{nome_evento}}"
                            rows={2}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    ))}
                    {nurtureSteps.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">Nenhuma etapa de nutrição. Clique em "+ Etapa" para adicionar.</p>
                    )}
                  </div>
                )}

                {/* Save button */}
                <Button onClick={saveCampaign} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Salvar Campanha
                </Button>
              </CardContent>
            )}
          </Card>
        ))}

        {campaigns.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhuma campanha de IA configurada.</p>
            <p className="text-xs mt-1">Crie uma campanha para começar a qualificar leads automaticamente.</p>
          </Card>
        )}
      </div>

      {/* Leads panel */}
      {showLeads && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Leads da Campanha ({leads.length})
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowLeads(null)}>Fechar</Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Telefone</TableHead>
                    <TableHead className="text-xs">Nome</TableHead>
                    <TableHead className="text-xs">Temperatura</TableHead>
                    <TableHead className="text-xs">Dados</TableHead>
                    <TableHead className="text-xs">Fonte</TableHead>
                    <TableHead className="text-xs">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map(lead => (
                    <TableRow key={lead.id}>
                      <TableCell className="text-xs font-mono">{lead.phone}</TableCell>
                      <TableCell className="text-xs">{lead.name || '-'}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${temperatureColor(lead.temperature)}`}>
                          {lead.temperature}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">
                        {Object.entries(lead.collected_data || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'}
                      </TableCell>
                      <TableCell className="text-xs">{lead.source}</TableCell>
                      <TableCell className="text-xs">{new Date(lead.created_at).toLocaleDateString('pt-BR')}</TableCell>
                    </TableRow>
                  ))}
                  {leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">Nenhum lead capturado ainda</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
