import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Send, Search, Users, Filter, Loader2, CheckCircle, TestTube,
  ChevronDown, ChevronUp, Phone, MapPin, Crown, FileSpreadsheet,
  AlertTriangle, Eye, Zap, RefreshCw, Image, Paperclip, Store,
  Calendar, ShoppingBag, Bookmark, Trash2, Save, X
} from "lucide-react";
import { DispatchHistoryList } from "./DispatchHistoryList";
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
  firstName: string;
  lastName: string;
  source: 'crm' | 'lead';
  segment?: string;
  city?: string;
  state?: string;
  email?: string;
}

// Dynamic variable options that pull from recipient data
const DYNAMIC_VARIABLE_OPTIONS = [
  { value: '__static__', label: '✏️ Texto fixo' },
  { value: '__first_name__', label: '👤 Primeiro Nome' },
  { value: '__full_name__', label: '👤 Nome Completo' },
  { value: '__phone__', label: '📱 Telefone' },
  { value: '__city__', label: '🏙️ Cidade' },
  { value: '__state__', label: '📍 Estado' },
  { value: '__segment__', label: '🏷️ Segmento RFM' },
  { value: '__email__', label: '📧 Email' },
];

function resolveVariableForRecipient(varConfig: { mode: string; staticValue: string }, recipient: Recipient): string {
  switch (varConfig.mode) {
    case '__first_name__': return recipient.firstName || recipient.name.split(' ')[0] || 'Cliente';
    case '__full_name__': return recipient.name || 'Cliente';
    case '__phone__': return recipient.phone || '';
    case '__city__': return recipient.city || 'N/A';
    case '__state__': return recipient.state || 'N/A';
    case '__segment__': return recipient.segment || 'N/A';
    case '__email__': return recipient.email || 'N/A';
    default: return varConfig.staticValue || 'Cliente';
  }
}

function getPreviewLabel(mode: string, staticValue: string): string {
  const opt = DYNAMIC_VARIABLE_OPTIONS.find(o => o.value === mode);
  if (mode === '__static__') return staticValue || '{{?}}';
  return opt ? `[${opt.label}]` : staticValue || '{{?}}';
}

export function MassTemplateDispatcher() {
  const { numbers, selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, { mode: string; staticValue: string }>>({});

  // Audience
  const [audienceSource, setAudienceSource] = useState<'crm' | 'leads' | 'both'>('crm');
  const [crmCustomers, setCrmCustomers] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);

  // CRM Filters (same as RFM tab)
  const [rfmFilter, setRfmFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [dddFilter, setDddFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ticketMin, setTicketMin] = useState("");
  const [ticketMax, setTicketMax] = useState("");
  const [ordersMin, setOrdersMin] = useState("");
  const [ordersMax, setOrdersMax] = useState("");
  const [topN, setTopN] = useState<string>("all");

  // Store/seller mapping
  const [customerStoreMap, setCustomerStoreMap] = useState<Map<string, { store_id: string; store_name: string; seller_id: string; seller_name: string }>>(new Map());
  const [storesList, setStoresList] = useState<{ id: string; name: string }[]>([]);
  const [sellersList, setSellersList] = useState<{ id: string; name: string }[]>([]);

  // Saved presets
  const [savedPresets, setSavedPresets] = useState<{ id: string; key: string; value: any }[]>([]);

  // Leads filters
  const [leadCampaignFilter, setLeadCampaignFilter] = useState<string>("all");
  const [leadCampaignTags, setLeadCampaignTags] = useState<string[]>([]);

  // Selection
  const [selectAll, setSelectAll] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());

  // Sending
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0, failed: 0 });
  const [activeDispatchId, setActiveDispatchId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [forceResend, setForceResend] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // Check for active dispatches on mount (resume monitoring)
  useEffect(() => {
    const checkActiveDispatch = async () => {
      const { data } = await supabase
        .from('dispatch_history')
        .select('id, total_recipients, sent_count, failed_count, status')
        .eq('status', 'sending')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setActiveDispatchId(data.id);
        setIsSending(true);
        setSendProgress({ sent: data.sent_count || 0, total: data.total_recipients || 0, failed: data.failed_count || 0 });
        startPolling(data.id);
      }
    };
    checkActiveDispatch();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  const startPolling = (dispatchId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const [{ data: dispatch }, sentRes, failedRes, pendingRes] = await Promise.all([
        supabase
          .from('dispatch_history')
          .select('status, total_recipients')
          .eq('id', dispatchId)
          .single(),
        supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true }).eq('dispatch_id', dispatchId).eq('status', 'sent'),
        supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true }).eq('dispatch_id', dispatchId).eq('status', 'failed'),
        supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true }).eq('dispatch_id', dispatchId).eq('status', 'pending'),
      ]);

      if (!dispatch) return;

      const sent = sentRes.count || 0;
      const failed = failedRes.count || 0;
      const pending = pendingRes.count || 0;

      setSendProgress({
        sent,
        total: dispatch.total_recipients || sent + failed + pending,
        failed,
      });

      if (dispatch.status === 'completed' || dispatch.status === 'cancelled' || dispatch.status === 'failed' || pending === 0) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setIsSending(false);
        setActiveDispatchId(null);
        setHistoryKey(k => k + 1);
        if (dispatch.status === 'cancelled') toast.info("Disparo cancelado");
        else if (dispatch.status === 'failed') toast.error("Disparo falhou");
        else toast.success("✅ Disparo concluído em background!");
      }
    }, 3000);
  };

  useEffect(() => {
    if (numbers.length === 0) fetchNumbers();
  }, [numbers.length, fetchNumbers]);

  useEffect(() => {
    // Only auto-select if it's a Meta number (has phone_number_id)
    if (selectedNumberId && !selectedNumber) {
      const num = numbers.find(n => n.id === selectedNumberId);
      if (num && num.phone_number_id) {
        setSelectedNumber(selectedNumberId);
      } else {
        // Fallback to first Meta number
        const metaNum = numbers.find(n => !!n.phone_number_id);
        if (metaNum) setSelectedNumber(metaNum.id);
      }
    }
  }, [selectedNumberId, selectedNumber, numbers]);

  useEffect(() => {
    if (selectedNumber) fetchTemplates();
  }, [selectedNumber]);

  useEffect(() => {
    fetchAudience();
  }, []);

  // Fetch store/seller mapping
  useEffect(() => {
    const fetchMapping = async () => {
      const [mapRes, storesRes, sellersRes] = await Promise.all([
        supabase.rpc('get_customer_store_seller_map' as any),
        supabase.from('pos_stores').select('id, name').eq('is_active', true).order('name'),
        supabase.from('pos_sellers').select('id, name').eq('is_active', true).order('name'),
      ]);
      if (mapRes.data) {
        const map = new Map<string, any>();
        for (const row of mapRes.data as any[]) {
          map.set(row.customer_phone, row);
        }
        setCustomerStoreMap(map);
      }
      setStoresList((storesRes.data || []) as any[]);
      setSellersList((sellersRes.data || []) as any[]);
    };
    fetchMapping();
  }, []);

  // Fetch saved presets
  useEffect(() => {
    const fetchPresets = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('id, key, value')
        .like('key', 'rfm_filter_preset_%')
        .order('created_at', { ascending: true });
      setSavedPresets((data || []) as any[]);
    };
    fetchPresets();
  }, []);

  const loadPreset = (preset: any) => {
    const f = preset.value?.filters || preset.value;
    if (f.rfmFilter) setRfmFilter(f.rfmFilter);
    if (f.regionFilter) setRegionFilter(f.regionFilter);
    if (f.dddFilter) setDddFilter(f.dddFilter);
    if (f.storeFilter) setStoreFilter(f.storeFilter);
    if (f.sellerFilter) setSellerFilter(f.sellerFilter);
    setDateFrom(f.dateFrom || "");
    setDateTo(f.dateTo || "");
    setTicketMin(f.ticketMin || "");
    setTicketMax(f.ticketMax || "");
    setOrdersMin(f.ordersMin || "");
    setOrdersMax(f.ordersMax || "");
    if (f.topN) setTopN(f.topN);
    setSelectAll(false);
    setSelectedPhones(new Set());
    toast.success(`Filtro "${(preset.value as any)?.name || 'Preset'}" aplicado`);
  };

  const clearAllFilters = () => {
    setRfmFilter("all"); setStateFilter("all"); setCityFilter("all");
    setDddFilter("all"); setRegionFilter("all"); setStoreFilter("all");
    setSellerFilter("all"); setDateFrom(""); setDateTo("");
    setTicketMin(""); setTicketMax(""); setOrdersMin("");
    setOrdersMax(""); setTopN("all"); setSearchQuery("");
    setSelectAll(false); setSelectedPhones(new Set());
  };

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
          .select('id, first_name, last_name, phone, email, city, state, ddd, rfm_segment, region_type, total_orders, total_spent, avg_ticket, last_purchase_at')
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

      // Fetch leads (paginated to get ALL)
      const allLeads: any[] = [];
      let leadsFrom = 0;
      const leadsPageSize = 1000;
      while (true) {
        const { data: leadsPage, error: leadsErr } = await supabase
          .from('lp_leads')
          .select('id, name, phone, campaign_tag, source, created_at')
          .not('phone', 'is', null)
          .order('created_at', { ascending: false })
          .range(leadsFrom, leadsFrom + leadsPageSize - 1);
        if (leadsErr || !leadsPage || leadsPage.length === 0) break;
        allLeads.push(...leadsPage);
        if (leadsPage.length < leadsPageSize) break;
        leadsFrom += leadsPageSize;
      }
      setLeads(allLeads);

      // Get unique campaign tags
      const tags: string[] = [...new Set(allLeads.map((l: any) => l.campaign_tag).filter(Boolean))];
      setLeadCampaignTags(tags);
    } catch (err) { console.error(err); toast.error("Erro ao carregar audiência"); }
    finally { setIsLoadingAudience(false); }
  };

  // Header media state
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [uploadingHeaderFile, setUploadingHeaderFile] = useState(false);
  const headerUploadRef = useRef<HTMLInputElement>(null);
  const handleHeaderFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHeaderFile(true);
    const ext = file.name.split('.').pop();
    const fileName = `template-header-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(fileName, file);
    if (error) { toast.error("Erro ao enviar arquivo"); setUploadingHeaderFile(false); return; }
    const { data } = supabase.storage.from("chat-media").getPublicUrl(fileName);
    setHeaderMediaUrl(data.publicUrl);
    toast.success("Arquivo enviado!");
    setUploadingHeaderFile(false);
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

  // Extract header info
  const headerComponent = useMemo(() => {
    if (!selectedTemplate) return null;
    return selectedTemplate.components.find(c => c.type === 'HEADER') || null;
  }, [selectedTemplate]);

  // Extract buttons
  const templateButtons = useMemo(() => {
    if (!selectedTemplate) return [];
    const btnComp = selectedTemplate.components.find(c => c.type === 'BUTTONS');
    return btnComp?.buttons || [];
  }, [selectedTemplate]);

  // Build rendered message text (for preview, uses placeholder labels for dynamic vars)
  const renderedMessage = useMemo(() => {
    if (!selectedTemplate) return "";
    let parts: string[] = [];
    for (const comp of selectedTemplate.components) {
      if (comp.type === 'HEADER' && comp.format && comp.format !== 'TEXT') {
        parts.push(`[📎 ${comp.format}]`);
      } else if (comp.type === 'HEADER' && comp.text) {
        let text = comp.text;
        text = text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
          const vc = variables[`header_${n}`];
          return vc ? getPreviewLabel(vc.mode, vc.staticValue) : `{{${n}}}`;
        });
        parts.push(`*${text}*`);
      }
      if (comp.type === 'BODY' && comp.text) {
        let text = comp.text;
        text = text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
          const vc = variables[`body_${n}`];
          return vc ? getPreviewLabel(vc.mode, vc.staticValue) : `{{${n}}}`;
        });
        parts.push(text);
      }
      if (comp.type === 'FOOTER' && comp.text) {
        parts.push(`_${comp.text}_`);
      }
    }
    // Add buttons to preview
    if (templateButtons.length > 0) {
      parts.push(templateButtons.map((b: any) => `[ ${b.type === 'QUICK_REPLY' ? '↩️' : b.type === 'URL' ? '🔗' : '📞'} ${b.text} ]`).join('\n'));
    }
    return parts.join('\n\n');
  }, [selectedTemplate, variables, templateButtons]);

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

        // Store/seller filters via mapping
        const phoneSuffix = phone.slice(-8);
        const mapping = customerStoreMap.get(phoneSuffix);
        if (storeFilter !== 'all' && mapping?.store_id !== storeFilter) continue;
        if (sellerFilter !== 'all' && mapping?.seller_id !== sellerFilter) continue;

        // Date filters
        if (dateFrom && c.last_purchase_at && c.last_purchase_at < dateFrom) continue;
        if (dateTo && c.last_purchase_at && c.last_purchase_at > dateTo) continue;

        // Ticket filters
        if (ticketMin && (c.avg_ticket || 0) < parseFloat(ticketMin)) continue;
        if (ticketMax && (c.avg_ticket || 0) > parseFloat(ticketMax)) continue;

        // Orders filters
        if (ordersMin && (c.total_orders || 0) < parseInt(ordersMin)) continue;
        if (ordersMax && (c.total_orders || 0) > parseInt(ordersMax)) continue;

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
          firstName: c.first_name || '',
          lastName: c.last_name || '',
          source: 'crm',
          segment: c.rfm_segment || undefined,
          city: c.city || undefined,
          state: c.state || undefined,
          email: c.email || undefined,
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
        const leadName = l.name || phone;
        const leadFirstName = leadName.split(' ')[0];
        list.push({
          phone,
          name: leadName,
          firstName: leadFirstName,
          lastName: leadName.split(' ').slice(1).join(' '),
          source: 'lead',
        });
      }
    }

    // Apply topN limit
    const finalList = topN !== 'all' ? list.slice(0, parseInt(topN)) : list;
    return finalList;
  }, [crmCustomers, leads, audienceSource, rfmFilter, stateFilter, cityFilter, dddFilter, regionFilter, searchQuery, leadCampaignFilter, storeFilter, sellerFilter, dateFrom, dateTo, ticketMin, ticketMax, ordersMin, ordersMax, topN, customerStoreMap]);

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

  // Build API components from variables for a specific recipient (or static only for test)
  const buildComponentsForRecipient = (recipient?: Recipient) => {
    const components: any[] = [];
    const bodyVars = templateVariables.filter(v => v.component === 'BODY');
    const headerVars = templateVariables.filter(v => v.component === 'HEADER');

    const resolve = (key: string) => {
      const vc = variables[key];
      if (!vc) return '';
      if (vc.mode === '__static__') return vc.staticValue || 'Cliente';
      if (!recipient) {
        // Test send without recipient: use placeholder so Meta doesn't get empty text
        const opt = DYNAMIC_VARIABLE_OPTIONS.find(o => o.value === vc.mode);
        return opt ? opt.label.replace(/^.+\s/, '') : 'Cliente';
      }
      return resolveVariableForRecipient(vc, recipient) || 'Cliente';
    };

    // Header: media (IMAGE/VIDEO/DOCUMENT) or text variables
    if (headerComponent && headerComponent.format && headerComponent.format !== 'TEXT' && headerMediaUrl) {
      const mediaType = headerComponent.format.toLowerCase(); // image, video, document
      components.push({
        type: 'header',
        parameters: [{ type: mediaType, [mediaType]: { link: headerMediaUrl } }],
      });
    } else if (headerVars.length > 0) {
      components.push({
        type: 'header',
        parameters: headerVars.map(v => ({ type: 'text', text: resolve(v.key) })),
      });
    }

    if (bodyVars.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyVars.map(v => ({ type: 'text', text: resolve(v.key) })),
      });
    }

    // URL buttons with dynamic suffixes
    const urlButtons = templateButtons.filter((b: any) => b.type === 'URL' && b.url?.includes('{{'));
    urlButtons.forEach((btn: any, idx: number) => {
      const suffix = variables[`button_url_${idx}`]?.staticValue || '';
      if (suffix) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: idx.toString(),
          parameters: [{ type: 'text', text: suffix }],
        });
      }
    });

    return components;
  };

  // Build rendered message for a specific recipient
  const buildRenderedForRecipient = (recipient: Recipient) => {
    if (!selectedTemplate) return "";
    let parts: string[] = [];
    for (const comp of selectedTemplate.components) {
      if (comp.type === 'HEADER' && comp.text) {
        let text = comp.text;
        text = text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
          const vc = variables[`header_${n}`];
          if (!vc) return `{{${n}}}`;
          return vc.mode === '__static__' ? vc.staticValue : resolveVariableForRecipient(vc, recipient);
        });
        parts.push(`*${text}*`);
      }
      if (comp.type === 'BODY' && comp.text) {
        let text = comp.text;
        text = text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
          const vc = variables[`body_${n}`];
          if (!vc) return `{{${n}}}`;
          return vc.mode === '__static__' ? vc.staticValue : resolveVariableForRecipient(vc, recipient);
        });
        parts.push(text);
      }
      if (comp.type === 'FOOTER' && comp.text) {
        parts.push(`_${comp.text}_`);
      }
    }
    return parts.join('\n\n');
  };

  // Check if any variable uses dynamic mode
  const hasDynamicVars = useMemo(() => {
    return Object.values(variables).some(v => v.mode !== '__static__');
  }, [variables]);

  // Test send
  const handleTestSend = async () => {
    if (!selectedNumber) { toast.error("Selecione um número de WhatsApp primeiro"); return; }
    if (!selectedTemplate || !testPhone.trim()) {
      toast.error("Selecione um template e insira um número para teste");
      return;
    }
    setIsTesting(true);
    try {
      const components = buildComponentsForRecipient(); // static only for test
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

  // Fetch phones that already received this template today (for resume)
  // Uses OR: matches both [Template: name] marker AND rendered messages containing the name
  const fetchAlreadySentPhones = async (templateName: string, whatsappNumId: string): Promise<Set<string>> => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const alreadySent = new Set<string>();

    // Use dispatch_recipients for fast lookup — much faster than scanning whatsapp_messages
    const { data: recentDispatches } = await supabase
      .from('dispatch_history')
      .select('id')
      .eq('template_name', templateName)
      .eq('whatsapp_number_id', whatsappNumId)
      .gte('created_at', todayISO)
      .in('status', ['sending', 'completed']);

    if (recentDispatches && recentDispatches.length > 0) {
      const dispatchIds = recentDispatches.map(d => d.id);
      for (const dId of dispatchIds) {
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data, error } = await supabase
            .from('dispatch_recipients')
            .select('phone')
            .eq('dispatch_id', dId)
            .eq('status', 'sent')
            .range(from, from + pageSize - 1);
          if (error || !data || data.length === 0) break;
          for (const row of data) {
            if (row.phone) alreadySent.add(row.phone.replace(/\D/g, ''));
          }
          if (data.length < pageSize) break;
          from += pageSize;
        }
      }
    }

    return alreadySent;
  };

  // Mass send — background via Edge Function
  const handleMassSend = async () => {
    setConfirmOpen(false);
    if (!selectedTemplate || !selectedNumber) return;

    const allPhones = [...selectedPhones];
    if (allPhones.length === 0) {
      toast.error("Selecione pelo menos um destinatário");
      return;
    }

    setIsSending(true);

    // Resume: skip phones that already received this template today (unless force resend)
    let phones = allPhones;
    if (!forceResend) {
      toast.info("Verificando envios anteriores para retomar de onde parou...");
      const alreadySent = await fetchAlreadySentPhones(selectedTemplate.name, selectedNumber);

      phones = allPhones.filter(p => {
        let formatted = p.replace(/\D/g, '');
        if (!formatted.startsWith('55')) formatted = '55' + formatted;
        return !alreadySent.has(formatted) && !alreadySent.has(p.replace(/\D/g, ''));
      });

      const skipped = allPhones.length - phones.length;
      if (skipped > 0) {
        toast.success(`⏩ ${skipped} destinatários já receberam hoje — retomando dos restantes.`);
      }

      if (phones.length === 0) {
        toast.success("✅ Todos os destinatários selecionados já receberam este template hoje!");
        setIsSending(false);
        return;
      }
    } else {
      toast.info("⚠️ Forçando reenvio para TODOS os selecionados...");
    }

    setSendProgress({ sent: 0, total: phones.length, failed: 0 });

    // Save dispatch history with template components for the Edge Function
    let dispatchId: string | null = null;
    try {
      const recipientMap = new Map(filteredRecipients.map(r => [r.phone, r]));
      const { data: dispatchData } = await supabase
        .from('dispatch_history')
        .insert({
          template_name: selectedTemplate.name,
          template_language: selectedTemplate.language,
          whatsapp_number_id: selectedNumber,
          audience_source: audienceSource,
          audience_filters: {
            rfm: rfmFilter, state: stateFilter, city: cityFilter,
            ddd: dddFilter, region: regionFilter, campaign: leadCampaignFilter,
          } as any,
          total_recipients: phones.length,
          rendered_message: renderedMessage || null,
          variables_config: variables as any,
          force_resend: forceResend,
          status: 'sending',
          template_components: selectedTemplate.components as any,
          has_dynamic_vars: hasDynamicVars,
          header_media_url: headerMediaUrl || null,
        })
        .select('id')
        .single();
      dispatchId = dispatchData?.id || null;

      // Save recipients in batches
      if (dispatchId) {
        const recipientRows = phones.map(p => ({
          dispatch_id: dispatchId!,
          phone: p,
          recipient_name: recipientMap.get(p)?.name || null,
          status: 'pending',
        }));
        const recipientBatches = [];
        for (let i = 0; i < recipientRows.length; i += 500) {
          recipientBatches.push(supabase.from('dispatch_recipients').insert(recipientRows.slice(i, i + 500)));
        }
        await Promise.all(recipientBatches);
      }
    } catch (err) {
      console.error('Error saving dispatch history:', err);
      toast.error("Erro ao salvar histórico de disparo");
      setIsSending(false);
      return;
    }

    if (!dispatchId) {
      toast.error("Erro ao criar disparo");
      setIsSending(false);
      return;
    }

    // Trigger background Edge Function
    try {
      setActiveDispatchId(dispatchId);
      startPolling(dispatchId);

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dispatch-mass-send`, {
        method: 'POST',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dispatchId }),
      });
      const data = await res.json();
      if (!data.success && data.error) {
        toast.error(`Erro ao iniciar disparo: ${data.error}`);
      } else {
        toast.success("🚀 Disparo iniciado em background! Você pode fechar esta aba.");
      }
    } catch (err) {
      console.error('Error triggering dispatch:', err);
      toast.error("Erro ao iniciar disparo em background");
    }
  };

  // Cancel dispatch
  const handleCancelDispatch = async () => {
    if (!activeDispatchId) return;
    await supabase.from('dispatch_history').update({ status: 'cancelled' }).eq('id', activeDispatchId);
    toast.info("Solicitação de cancelamento enviada...");
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
            {numbers.filter(num => !!num.phone_number_id).map(num => (
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
                    setHeaderMediaUrl("");
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
              <div className="space-y-3">
                <Label className="text-xs font-medium">Variáveis</Label>
                {templateVariables.map(v => {
                  const vc = variables[v.key] || { mode: '__static__', staticValue: '' };
                  return (
                    <div key={v.key} className="space-y-1.5 p-2 rounded-md border bg-muted/20">
                      <Label className="text-[10px] text-muted-foreground">
                        {v.component} - {`{{${v.index}}}`}
                      </Label>
                      <Select
                        value={vc.mode}
                        onValueChange={mode => setVariables(prev => ({
                          ...prev,
                          [v.key]: { mode, staticValue: prev[v.key]?.staticValue || '' },
                        }))}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DYNAMIC_VARIABLE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {vc.mode === '__static__' && (
                        <Input
                          className="h-7 text-xs"
                          placeholder={`Texto fixo para {{${v.index}}}`}
                          value={vc.staticValue}
                          onChange={e => setVariables(prev => ({
                            ...prev,
                            [v.key]: { ...prev[v.key], staticValue: e.target.value },
                          }))}
                        />
                      )}
                    </div>
                  );
                })}
                {hasDynamicVars && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Variáveis dinâmicas: cada destinatário receberá dados personalizados
                  </p>
                )}
              </div>
            )}

            {/* Header Media (IMAGE/VIDEO/DOCUMENT) */}
            {headerComponent && headerComponent.format && headerComponent.format !== 'TEXT' && (
              <div className="space-y-2 p-2 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20">
                <Label className="text-xs font-medium flex items-center gap-1">
                  📎 Header ({headerComponent.format})
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder={`URL da ${headerComponent.format === 'IMAGE' ? 'imagem' : headerComponent.format === 'VIDEO' ? 'vídeo' : 'documento'}...`}
                    value={headerMediaUrl}
                    onChange={e => setHeaderMediaUrl(e.target.value)}
                  />
                  <input ref={headerUploadRef} type="file" className="hidden" accept={headerComponent.format === 'IMAGE' ? 'image/*' : headerComponent.format === 'VIDEO' ? 'video/*' : '*/*'} onChange={handleHeaderFileUpload} />
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] gap-1 shrink-0" onClick={() => headerUploadRef.current?.click()} disabled={uploadingHeaderFile}>
                    {uploadingHeaderFile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                    Upload
                  </Button>
                </div>
                {headerMediaUrl && headerComponent.format === 'IMAGE' && (
                  <img src={headerMediaUrl} alt="Header preview" className="max-h-24 rounded object-cover" />
                )}
                <p className="text-[10px] text-muted-foreground">
                  Envie um arquivo ou cole a URL pública da mídia
                </p>
              </div>
            )}

            {/* URL Button variables */}
            {templateButtons.filter((b: any) => b.type === 'URL' && b.url?.includes('{{')).length > 0 && (
              <div className="space-y-2 p-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
                <Label className="text-xs font-medium flex items-center gap-1">
                  🔗 Botões URL com variável
                </Label>
                {templateButtons.filter((b: any) => b.type === 'URL' && b.url?.includes('{{')).map((btn: any, idx: number) => (
                  <div key={idx} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{btn.text} — {btn.url}</Label>
                    <Input
                      className="h-7 text-xs"
                      placeholder="Sufixo da URL dinâmica..."
                      value={variables[`button_url_${idx}`]?.staticValue || ''}
                      onChange={e => setVariables(prev => ({
                        ...prev,
                        [`button_url_${idx}`]: { mode: '__static__', staticValue: e.target.value },
                      }))}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Buttons preview */}
            {templateButtons.length > 0 && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Botões do template:</Label>
                <div className="flex flex-wrap gap-1">
                  {templateButtons.map((b: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px]">
                      {b.type === 'QUICK_REPLY' ? '↩️' : b.type === 'URL' ? '🔗' : '📞'} {b.text}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            {selectedTemplate && (
              <div className="space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Eye className="h-3 w-3" />Preview
                </Label>
                {headerMediaUrl && headerComponent?.format === 'IMAGE' && (
                  <img src={headerMediaUrl} alt="Header" className="rounded-lg max-h-32 w-full object-cover" />
                )}
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

            {/* Saved presets */}
            {savedPresets.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center">
                <Bookmark className="h-3 w-3 text-muted-foreground" />
                {savedPresets.map(p => (
                  <Badge key={p.id} variant="outline" className="cursor-pointer gap-1 text-[10px] hover:bg-secondary" onClick={() => loadPreset(p)}>
                    {(p.value as any)?.name || 'Filtro'}
                  </Badge>
                ))}
              </div>
            )}

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
                  <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[150px] h-8 text-xs"><Store className="h-3 w-3 mr-1" /><SelectValue placeholder="Loja" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas Lojas</SelectItem>
                      {storesList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={sellerFilter} onValueChange={v => { setSellerFilter(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[150px] h-8 text-xs"><Users className="h-3 w-3 mr-1" /><SelectValue placeholder="Vendedora" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas Vendedoras</SelectItem>
                      {sellersList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
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
                  <Select value={topN} onValueChange={v => { setTopN(v); setSelectAll(false); setSelectedPhones(new Set()); }}>
                    <SelectTrigger className="w-[130px] h-8 text-xs"><Crown className="h-3 w-3 mr-1" /><SelectValue placeholder="Top N" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="10">Top 10</SelectItem>
                      <SelectItem value="20">Top 20</SelectItem>
                      <SelectItem value="50">Top 50</SelectItem>
                      <SelectItem value="100">Top 100</SelectItem>
                      <SelectItem value="200">Top 200</SelectItem>
                      <SelectItem value="500">Top 500</SelectItem>
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

            {/* Date & value filters */}
            {(audienceSource === 'crm' || audienceSource === 'both') && (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Comprou depois de</label>
                  <Input type="date" className="w-[140px] h-8 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Comprou antes de</label>
                  <Input type="date" className="w-[140px] h-8 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Ticket min</label>
                  <Input type="number" className="w-[90px] h-8 text-xs" placeholder="R$" value={ticketMin} onChange={e => setTicketMin(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Ticket max</label>
                  <Input type="number" className="w-[90px] h-8 text-xs" placeholder="R$" value={ticketMax} onChange={e => setTicketMax(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Pedidos min</label>
                  <Input type="number" className="w-[80px] h-8 text-xs" value={ordersMin} onChange={e => setOrdersMin(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Pedidos max</label>
                  <Input type="number" className="w-[80px] h-8 text-xs" value={ordersMax} onChange={e => setOrdersMax(e.target.value)} />
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearAllFilters}>
                  <X className="h-3 w-3" />Limpar
                </Button>
              </div>
            )}

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
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full mt-1"
                  onClick={handleCancelDispatch}
                >
                  ✋ Cancelar Disparo
                </Button>
                <p className="text-[10px] text-muted-foreground text-center mt-1">
                  💡 Você pode fechar esta aba — o disparo continua em background
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
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="force-resend"
                checked={forceResend}
                onCheckedChange={(v) => setForceResend(!!v)}
              />
              <Label htmlFor="force-resend" className="text-sm font-medium text-amber-600 dark:text-amber-400 cursor-pointer">
                ⚠️ Forçar reenvio (envia mesmo para quem já recebeu hoje)
              </Label>
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

      {/* Dispatch History */}
      <DispatchHistoryList key={historyKey} />
    </div>
  );
}
