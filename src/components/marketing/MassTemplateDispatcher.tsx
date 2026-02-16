import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Send, Search, Users, Filter, Loader2, CheckCircle, TestTube,
  ChevronDown, ChevronUp, Phone, MapPin, Crown, FileSpreadsheet,
  AlertTriangle, Eye, Zap, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
}

interface Recipient {
  phone: string;
  name: string;
  source: 'crm' | 'lead';
  segment?: string;
  city?: string;
  state?: string;
}

export function MassTemplateDispatcher() {
  const { numbers, selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});

  // Audience
  const [audienceSource, setAudienceSource] = useState<'crm' | 'leads' | 'both'>('crm');
  const [crmCustomers, setCrmCustomers] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);

  // CRM Filters
  const [rfmFilter, setRfmFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [dddFilter, setDddFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Leads filters
  const [leadCampaignFilter, setLeadCampaignFilter] = useState<string>("all");
  const [leadCampaignTags, setLeadCampaignTags] = useState<string[]>([]);

  // Selection
  const [selectAll, setSelectAll] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());

  // Sending
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0, failed: 0 });
  const [testPhone, setTestPhone] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (numbers.length === 0) fetchNumbers();
  }, [numbers.length, fetchNumbers]);

  useEffect(() => {
    if (selectedNumberId && !selectedNumber) setSelectedNumber(selectedNumberId);
  }, [selectedNumberId, selectedNumber]);

  useEffect(() => {
    if (selectedNumber) fetchTemplates();
  }, [selectedNumber]);

  useEffect(() => {
    fetchAudience();
  }, []);

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-get-templates?whatsappNumberId=${selectedNumber}`,
        { headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const result = await res.json();
      if (result.success) {
        setTemplates((result.templates || []).filter((t: MetaTemplate) => t.status === 'APPROVED'));
      }
    } catch { toast.error("Erro ao buscar templates"); }
    finally { setIsLoadingTemplates(false); }
  };

  const fetchAudience = async () => {
    setIsLoadingAudience(true);
    try {
      // Fetch CRM customers in batches
      let allCustomers: any[] = [];
      let from = 0;
      let keepFetching = true;
      while (keepFetching) {
        const { data, error } = await supabase
          .from('zoppy_customers')
          .select('id, first_name, last_name, phone, city, state, ddd, rfm_segment, region_type')
          .not('phone', 'is', null)
          .order('total_spent', { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        if (data && data.length > 0) {
          allCustomers = allCustomers.concat(data);
          from += 1000;
          if (data.length < 1000) keepFetching = false;
        } else keepFetching = false;
        if (allCustomers.length >= 25000) keepFetching = false;
      }
      setCrmCustomers(allCustomers);

      // Fetch leads
      const { data: leadsData } = await supabase
        .from('lp_leads')
        .select('id, name, phone, campaign_tag, source, created_at')
        .not('phone', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000);
      setLeads(leadsData || []);

      // Get unique campaign tags
      const tags = [...new Set((leadsData || []).map((l: any) => l.campaign_tag).filter(Boolean))];
      setLeadCampaignTags(tags);
    } catch (err) { console.error(err); toast.error("Erro ao carregar audiência"); }
    finally { setIsLoadingAudience(false); }
  };

  // Extract variables from template
  const templateVariables = useMemo(() => {
    if (!selectedTemplate) return [];
    const vars: { component: string; index: number; key: string }[] = [];
    for (const comp of selectedTemplate.components) {
      if (comp.text) {
        const matches = comp.text.matchAll(/\{\{(\d+)\}\}/g);
        for (const m of matches) {
          const key = `${comp.type.toLowerCase()}_${m[1]}`;
          vars.push({ component: comp.type, index: parseInt(m[1]), key });
        }
      }
    }
    return vars;
  }, [selectedTemplate]);

  // Build rendered message text
  const renderedMessage = useMemo(() => {
    if (!selectedTemplate) return "";
    let parts: string[] = [];
    for (const comp of selectedTemplate.components) {
      if (comp.type === 'HEADER' && comp.text) {
        let text = comp.text;
        text = text.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[`header_${n}`] || `{{${n}}}`);
        parts.push(`*${text}*`);
      }
      if (comp.type === 'BODY' && comp.text) {
        let text = comp.text;
        text = text.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[`body_${n}`] || `{{${n}}}`);
        parts.push(text);
      }
      if (comp.type === 'FOOTER' && comp.text) {
        parts.push(`_${comp.text}_`);
      }
    }
    return parts.join('\n\n');
  }, [selectedTemplate, variables]);

  // Filtered recipients
  const filteredRecipients = useMemo((): Recipient[] => {
    const list: Recipient[] = [];
    const addedPhones = new Set<string>();

    if (audienceSource === 'crm' || audienceSource === 'both') {
      for (const c of crmCustomers) {
        if (!c.phone) continue;
        const phone = c.phone.replace(/\D/g, '');
        if (!phone || phone.length < 8) continue;
        if (rfmFilter !== 'all' && c.rfm_segment !== rfmFilter) continue;
        if (stateFilter !== 'all' && c.state !== stateFilter) continue;
        if (cityFilter !== 'all' && c.city !== cityFilter) continue;
        if (dddFilter !== 'all' && c.ddd !== dddFilter) continue;
        if (regionFilter !== 'all' && c.region_type !== regionFilter) continue;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
          if (!name.includes(q) && !phone.includes(q)) continue;
        }
        if (addedPhones.has(phone)) continue;
        addedPhones.add(phone);
        list.push({
          phone,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || phone,
          source: 'crm',
          segment: c.rfm_segment || undefined,
          city: c.city || undefined,
          state: c.state || undefined,
        });
      }
    }

    if (audienceSource === 'leads' || audienceSource === 'both') {
      for (const l of leads) {
        if (!l.phone) continue;
        const phone = l.phone.replace(/\D/g, '');
        if (!phone || phone.length < 8) continue;
        if (leadCampaignFilter !== 'all' && l.campaign_tag !== leadCampaignFilter) continue;
        if (addedPhones.has(phone)) continue;
        addedPhones.add(phone);
        list.push({
          phone,
          name: l.name || phone,
          source: 'lead',
        });
      }
    }

    return list;
  }, [crmCustomers, leads, audienceSource, rfmFilter, stateFilter, cityFilter, dddFilter, regionFilter, searchQuery, leadCampaignFilter]);

  // Unique filter options
  const uniqueSegments = useMemo(() => [...new Set(crmCustomers.map(c => c.rfm_segment).filter(Boolean))].sort(), [crmCustomers]);
  const uniqueStates = useMemo(() => [...new Set(crmCustomers.map(c => c.state).filter(Boolean))].sort(), [crmCustomers]);
  const uniqueCities = useMemo(() => {
    const cities = crmCustomers.filter(c => stateFilter === 'all' || c.state === stateFilter).map(c => c.city).filter(Boolean);
    return [...new Set(cities)].sort();
  }, [crmCustomers, stateFilter]);
  const uniqueDdds = useMemo(() => [...new Set(crmCustomers.map(c => c.ddd).filter(Boolean))].sort(), [crmCustomers]);

  // Selection handlers
  useEffect(() => {
    if (selectAll) {
      setSelectedPhones(new Set(filteredRecipients.map(r => r.phone)));
    } else {
      setSelectedPhones(new Set());
    }
  }, [selectAll, filteredRecipients]);

  const togglePhone = (phone: string) => {
    setSelectedPhones(prev => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
    setSelectAll(false);
  };

  // Build API components from variables
  const buildComponents = () => {
    const components: any[] = [];
    const bodyVars = templateVariables.filter(v => v.component === 'BODY');
    const headerVars = templateVariables.filter(v => v.component === 'HEADER');

    if (headerVars.length > 0) {
      components.push({
        type: 'header',
        parameters: headerVars.map(v => ({ type: 'text', text: variables[v.key] || '' })),
      });
    }
    if (bodyVars.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyVars.map(v => ({ type: 'text', text: variables[v.key] || '' })),
      });
    }
    return components;
  };

  // Test send
  const handleTestSend = async () => {
    if (!selectedNumber) { toast.error("Selecione um número de WhatsApp primeiro"); return; }
    if (!selectedTemplate || !testPhone.trim()) {
      toast.error("Selecione um template e insira um número para teste");
      return;
    }
    setIsTesting(true);
    try {
      const components = buildComponents();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-send-template`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone.replace(/\D/g, ''),
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          whatsappNumberId: selectedNumber,
          components: components.length > 0 ? components : undefined,
          renderedMessage,
        }),
      });
      const data = await res.json();
      if (data.success) toast.success("✅ Teste enviado com sucesso!");
      else toast.error(`Erro: ${data.error || data.details?.error?.message || 'Falha no envio'}`);
    } catch (err) { toast.error("Erro ao enviar teste"); }
    finally { setIsTesting(false); }
  };

  // Mass send
  const handleMassSend = async () => {
    setConfirmOpen(false);
    if (!selectedTemplate || !selectedNumber) return;

    const phones = [...selectedPhones];
    if (phones.length === 0) {
      toast.error("Selecione pelo menos um destinatário");
      return;
    }

    setIsSending(true);
    setSendProgress({ sent: 0, total: phones.length, failed: 0 });

    try {
      const components = buildComponents();
      // Queue all messages
      const queueItems = phones.map(phone => ({
        phone,
        template_name: selectedTemplate.name,
        template_language: selectedTemplate.language,
        template_params: components.length > 0 ? components : null,
        status: 'pending',
        max_attempts: 3,
      }));

      // Insert in batches
      const allIds: string[] = [];
      for (let i = 0; i < queueItems.length; i += 100) {
        const batch = queueItems.slice(i, i + 100);
        const { data, error } = await supabase
          .from('meta_message_queue')
          .insert(batch)
          .select('id');
        if (error) throw error;
        allIds.push(...(data || []).map((d: any) => d.id));
      }

      // Send in batches of 50
      let sent = 0, failed = 0;
      for (let i = 0; i < allIds.length; i += 50) {
        const batchIds = allIds.slice(i, i + 50);
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-send-template`, {
          method: 'POST',
          headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queueIds: batchIds,
            whatsappNumberId: selectedNumber,
          }),
        });
        const data = await res.json();
        if (data.results) {
          for (const r of data.results) {
            if (r.success) sent++;
            else failed++;
          }
        }
        setSendProgress({ sent, total: phones.length, failed });
      }

      // Now update all sent messages to include rendered body
      if (renderedMessage) {
        const phoneList = phones.map(p => {
          let fp = p.replace(/\D/g, '');
          if (!fp.startsWith('55')) fp = '55' + fp;
          return fp;
        });
        // Update recently sent template messages to show rendered body
        await supabase
          .from('whatsapp_messages')
          .update({ message: renderedMessage })
          .eq('message', `[Template: ${selectedTemplate.name}]`)
          .in('phone', phoneList)
          .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
      }

      toast.success(`Disparo concluído! ✅ ${sent} enviados, ${failed > 0 ? `❌ ${failed} falharam` : 'nenhuma falha'}`);
    } catch (err) {
      console.error(err);
      toast.error("Erro durante o disparo em massa");
    } finally {
      setIsSending(false);
    }
  };

  const selectedCount = selectedPhones.size;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Send className="h-4 w-4" />
            Disparador de Templates em Massa
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Selecione um template, configure variáveis e dispare para sua audiência
          </p>
        </div>
        <Select value={selectedNumber} onValueChange={setSelectedNumber}>
          <SelectTrigger className="w-[260px] h-9 text-xs">
            <Phone className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="Selecionar número de WhatsApp" />
          </SelectTrigger>
          <SelectContent>
            {numbers.map(num => (
              <SelectItem key={num.id} value={num.id}>{num.label} - {num.phone_display}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Column 1: Template + Variables */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              1. Template & Variáveis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Template selector */}
            <div className="space-y-2">
              <Label className="text-xs">Template aprovado</Label>
              {isLoadingTemplates ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />Carregando...
                </div>
              ) : (
                <Select
                  value={selectedTemplate?.name || ""}
                  onValueChange={name => {
                    const t = templates.find(t => t.name === name);
                    setSelectedTemplate(t || null);
                    setVariables({});
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Selecione um template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.name} className="text-xs">
                        {t.name} ({t.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={fetchTemplates}>
                <RefreshCw className="h-3 w-3" />Atualizar
              </Button>
            </div>

            {/* Variables */}
            {templateVariables.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">Variáveis</Label>
                {templateVariables.map(v => (
                  <div key={v.key} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      {v.component} - {`{{${v.index}}}`}
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder={`Valor para {{${v.index}}}`}
                      value={variables[v.key] || ''}
                      onChange={e => setVariables(prev => ({ ...prev, [v.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {selectedTemplate && (
              <div className="space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Eye className="h-3 w-3" />Preview
                </Label>
                <div className="bg-[#dcf8c6] dark:bg-[#005c4b] rounded-lg p-3 text-sm whitespace-pre-wrap">
                  {renderedMessage || "Selecione um template"}
                </div>
              </div>
            )}

            <Separator />

            {/* Test send */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1">
                <TestTube className="h-3 w-3" />Envio de Teste
              </Label>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs flex-1"
                  placeholder="55 33 99999-9999"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs"
                  onClick={handleTestSend}
                  disabled={isTesting || !selectedTemplate}
                >
                  {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Testar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Envie para um número de teste antes do disparo em massa
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Column 2: Audience Selection */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                2. Audiência
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {filteredRecipients.length} disponíveis
                </Badge>
                <Badge className="text-xs bg-primary">
                  {selectedCount} selecionados
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Source tabs */}
            <div className="flex gap-2">
              {[
                { value: 'crm' as const, label: 'Clientes CRM', icon: Users },
                { value: 'leads' as const, label: 'Leads Captados', icon: FileSpreadsheet },
                { value: 'both' as const, label: 'Ambos', icon: Zap },
              ].map(s => (
                <Button
                  key={s.value}
                  variant={audienceSource === s.value ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => { setAudienceSource(s.value); setSelectAll(false); setSelectedPhones(new Set()); }}
                >
                  <s.icon className="h-3 w-3" />{s.label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" className="gap-1 text-xs ml-auto" onClick={fetchAudience} disabled={isLoadingAudience}>
                <RefreshCw className={`h-3 w-3 ${isLoadingAudience ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {(audienceSource === 'crm' || audienceSource === 'both') && (
                <>
                  <Select value={rfmFilter} onValueChange={v => { setRfmFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[160px] h-8 text-xs"><Crown className="h-3 w-3 mr-1" /><SelectValue placeholder="Segmento RFM" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos Segmentos</SelectItem>
                      {uniqueSegments.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={stateFilter} onValueChange={v => { setStateFilter(v); setCityFilter('all'); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[130px] h-8 text-xs"><MapPin className="h-3 w-3 mr-1" /><SelectValue placeholder="Estado" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos Estados</SelectItem>
                      {uniqueStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={cityFilter} onValueChange={v => { setCityFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Cidade" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas Cidades</SelectItem>
                      {uniqueCities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={dddFilter} onValueChange={v => { setDddFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[110px] h-8 text-xs"><Phone className="h-3 w-3 mr-1" /><SelectValue placeholder="DDD" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos DDDs</SelectItem>
                      {uniqueDdds.map(d => <SelectItem key={d} value={d}>DDD {d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={regionFilter} onValueChange={v => { setRegionFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Região" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas Regiões</SelectItem>
                      <SelectItem value="local">🏪 Loja Física</SelectItem>
                      <SelectItem value="online">🌐 Online</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
              {(audienceSource === 'leads' || audienceSource === 'both') && (
                <Select value={leadCampaignFilter} onValueChange={v => { setLeadCampaignFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                  <SelectTrigger className="w-[180px] h-8 text-xs"><FileSpreadsheet className="h-3 w-3 mr-1" /><SelectValue placeholder="Campanha do Lead" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Campanhas</SelectItem>
                    {leadCampaignTags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Input
                className="w-[200px] h-8 text-xs"
                placeholder="Buscar nome ou telefone..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Select all */}
            <div className="flex items-center gap-2 py-1">
              <Checkbox
                checked={selectAll}
                onCheckedChange={(checked) => setSelectAll(!!checked)}
              />
              <span className="text-xs">Selecionar todos ({filteredRecipients.length})</span>
            </div>

            {/* Recipients list */}
            <ScrollArea className="h-[350px] border rounded-lg">
              <div className="p-1">
                {isLoadingAudience ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredRecipients.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-xs">
                    Nenhum destinatário encontrado com os filtros atuais
                  </div>
                ) : (
                  filteredRecipients.slice(0, 500).map(r => (
                    <div
                      key={r.phone}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded text-xs"
                    >
                      <Checkbox
                        checked={selectedPhones.has(r.phone)}
                        onCheckedChange={() => togglePhone(r.phone)}
                      />
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="text-muted-foreground font-mono text-[10px]">{r.phone}</span>
                      {r.segment && (
                        <Badge variant="outline" className="text-[9px] h-4">{r.segment}</Badge>
                      )}
                      {r.city && r.state && (
                        <span className="text-[9px] text-muted-foreground">{r.city}/{r.state}</span>
                      )}
                      <Badge variant={r.source === 'crm' ? 'secondary' : 'default'} className="text-[9px] h-4">
                        {r.source === 'crm' ? 'CRM' : 'Lead'}
                      </Badge>
                    </div>
                  ))
                )}
                {filteredRecipients.length > 500 && (
                  <p className="text-[10px] text-muted-foreground text-center py-2">
                    Mostrando 500 de {filteredRecipients.length} destinatários
                  </p>
                )}
              </div>
            </ScrollArea>

            {/* Action bar */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                {selectedCount > 0 && (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-emerald-500" />
                    {selectedCount} destinatários selecionados
                  </span>
                )}
              </div>
              <Button
                className="gap-2"
                disabled={isSending || selectedCount === 0 || !selectedTemplate}
                onClick={() => setConfirmOpen(true)}
              >
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando {sendProgress.sent}/{sendProgress.total}...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Disparar para {selectedCount} contatos
                  </>
                )}
              </Button>
            </div>

            {/* Progress */}
            {isSending && (
              <div className="space-y-1">
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${sendProgress.total > 0 ? (sendProgress.sent + sendProgress.failed) / sendProgress.total * 100 : 0}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  ✅ {sendProgress.sent} enviados · ❌ {sendProgress.failed} falharam · 📊 {sendProgress.total} total
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar Disparo em Massa
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm">Você está prestes a enviar:</p>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1">
              <p className="text-sm font-medium">Template: <span className="font-mono">{selectedTemplate?.name}</span></p>
              <p className="text-sm">Destinatários: <span className="font-bold">{selectedCount}</span></p>
            </div>
            <div className="bg-[#dcf8c6] dark:bg-[#005c4b] rounded-lg p-3 text-sm whitespace-pre-wrap">
              {renderedMessage}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Esta ação não pode ser desfeita. Recomendamos testar antes do disparo.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={handleMassSend} className="gap-1">
              <Send className="h-4 w-4" />Confirmar Disparo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
