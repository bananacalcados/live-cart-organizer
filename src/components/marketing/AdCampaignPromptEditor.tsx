import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Loader2, RotateCcw, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

interface SituationPrompt {
  id: string;
  campaign_id: string | null;
  situation: string;
  sub_situation: string | null;
  prompt_text: string;
  is_active: boolean;
  sort_order: number;
}

const SITUATION_META: Record<string, { label: string; icon: string; description: string }> = {
  info_qualificacao: { label: "Informação + Qualificação", icon: "👋", description: "Primeiro contato: saudar, apresentar produto e perguntar tamanho" },
  duvidas: { label: "Dúvidas", icon: "❓", description: "Responder perguntas do cliente (ativado por sub-situações)" },
  followup_1: { label: "Follow-up 1", icon: "🔔", description: "Cliente não respondeu — retomar conversa" },
  coleta_dados: { label: "Coleta de Dados", icon: "📋", description: "Coletar nome, CPF, endereço, email (um por vez)" },
  pagamento: { label: "Pagamento", icon: "💳", description: "Perguntar forma de pagamento e enviar link/PIX" },
  followup_2: { label: "Follow-up 2", icon: "🎯", description: "Mudar de assunto, convidar para Live" },
  checkout_abandonado: { label: "Checkout Abandonado", icon: "🛒", description: "Cliente abriu o link mas não finalizou a compra" },
  requalificacao: { label: "Requalificação", icon: "🔄", description: "Cliente quer outro produto" },
};

const SUB_SITUATION_META: Record<string, { label: string; icon: string }> = {
  tamanho: { label: "Tamanho/Numeração", icon: "📏" },
  cores: { label: "Cores", icon: "🎨" },
  frete: { label: "Frete/Entrega", icon: "🚚" },
  localizacao: { label: "Localização", icon: "📍" },
  pagamento: { label: "Forma de Pagamento", icon: "💰" },
  fotos: { label: "Fotos", icon: "📸" },
  desconto: { label: "Descontos", icon: "🏷️" },
  geral: { label: "Dúvida Geral", icon: "💬" },
};

interface Props {
  campaignId: string;
}

export default function AdCampaignPromptEditor({ campaignId }: Props) {
  const [globalPrompts, setGlobalPrompts] = useState<SituationPrompt[]>([]);
  const [campaignPrompts, setCampaignPrompts] = useState<SituationPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSituation, setExpandedSituation] = useState<string | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<string, { text: string; isActive: boolean }>>({});

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    const [globalRes, campaignRes] = await Promise.all([
      supabase
        .from("ad_campaign_situation_prompts")
        .select("*")
        .is("campaign_id", null)
        .order("sort_order"),
      supabase
        .from("ad_campaign_situation_prompts")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order"),
    ]);
    setGlobalPrompts((globalRes.data as any[]) || []);
    setCampaignPrompts((campaignRes.data as any[]) || []);
    setEditedPrompts({});
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const getEffectivePrompt = (situation: string, subSituation: string | null): { prompt: SituationPrompt | null; isOverride: boolean } => {
    const key = `${situation}|${subSituation || ""}`;
    const campaignMatch = campaignPrompts.find(
      p => p.situation === situation && (p.sub_situation || "") === (subSituation || "")
    );
    if (campaignMatch) return { prompt: campaignMatch, isOverride: true };
    const globalMatch = globalPrompts.find(
      p => p.situation === situation && (p.sub_situation || "") === (subSituation || "")
    );
    return { prompt: globalMatch || null, isOverride: false };
  };

  const getEditedText = (situation: string, subSituation: string | null): string | null => {
    const key = `${situation}|${subSituation || ""}`;
    return editedPrompts[key]?.text ?? null;
  };

  const setEditedText = (situation: string, subSituation: string | null, text: string) => {
    const key = `${situation}|${subSituation || ""}`;
    setEditedPrompts(prev => ({
      ...prev,
      [key]: { text, isActive: prev[key]?.isActive ?? true },
    }));
  };

  const saveSituationPrompt = async (situation: string, subSituation: string | null) => {
    const key = `${situation}|${subSituation || ""}`;
    const edited = editedPrompts[key];
    if (!edited) return;

    setSaving(true);
    const existing = campaignPrompts.find(
      p => p.situation === situation && (p.sub_situation || "") === (subSituation || "")
    );

    if (existing) {
      await supabase
        .from("ad_campaign_situation_prompts")
        .update({ prompt_text: edited.text, is_active: edited.isActive })
        .eq("id", existing.id);
    } else {
      const globalMatch = globalPrompts.find(
        p => p.situation === situation && (p.sub_situation || "") === (subSituation || "")
      );
      await supabase.from("ad_campaign_situation_prompts").insert({
        campaign_id: campaignId,
        situation,
        sub_situation: subSituation || null,
        prompt_text: edited.text,
        is_active: edited.isActive,
        sort_order: globalMatch?.sort_order || 0,
      });
    }

    setSaving(false);
    toast.success("Prompt salvo!");
    fetchPrompts();
  };

  const resetToGlobal = async (situation: string, subSituation: string | null) => {
    const existing = campaignPrompts.find(
      p => p.situation === situation && (p.sub_situation || "") === (subSituation || "")
    );
    if (existing) {
      await supabase.from("ad_campaign_situation_prompts").delete().eq("id", existing.id);
      toast.success("Restaurado para o padrão global");
      fetchPrompts();
    }
    const key = `${situation}|${subSituation || ""}`;
    setEditedPrompts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const situations = Object.keys(SITUATION_META);

  if (loading) return <div className="flex items-center justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  const renderPromptRow = (situation: string, subSituation: string | null) => {
    const { prompt, isOverride } = getEffectivePrompt(situation, subSituation);
    const editedText = getEditedText(situation, subSituation);
    const currentText = editedText ?? prompt?.prompt_text ?? "";
    const hasChanges = editedText !== null && editedText !== (prompt?.prompt_text ?? "");
    const subMeta = subSituation ? SUB_SITUATION_META[subSituation] : null;

    return (
      <div key={`${situation}-${subSituation || "main"}`} className={`p-3 rounded-lg border ${isOverride ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {subMeta && <span className="text-sm">{subMeta.icon}</span>}
            <Label className="text-xs font-medium">
              {subMeta ? subMeta.label : "Prompt principal"}
            </Label>
            {isOverride && (
              <Badge variant="outline" className="text-[10px] h-4 px-1 border-primary/50 text-primary">
                Customizado
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isOverride && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => resetToGlobal(situation, subSituation)}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs">Restaurar padrão global</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {hasChanges && (
              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => saveSituationPrompt(situation, subSituation)} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                Salvar
              </Button>
            )}
          </div>
        </div>
        <Textarea
          value={currentText}
          onChange={e => setEditedText(situation, subSituation, e.target.value)}
          rows={3}
          className="text-xs"
          placeholder="Instruções para a IA nesta situação..."
        />
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Label className="text-sm font-semibold">🧠 Prompts por Situação</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px]">
              <p className="text-xs">Prompts globais são usados por padrão. Customize aqui para esta campanha específica. Prompts customizados são indicados com badge "Customizado".</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {situations.map(situation => {
        const meta = SITUATION_META[situation];
        const isExpanded = expandedSituation === situation;
        const subSituations = situation === "duvidas" ? Object.keys(SUB_SITUATION_META) : [];
        const overrideCount = campaignPrompts.filter(p => p.situation === situation).length;

        return (
          <div key={situation} className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
              onClick={() => setExpandedSituation(isExpanded ? null : situation)}
            >
              <div className="flex items-center gap-2">
                <span>{meta.icon}</span>
                <span className="text-sm font-medium">{meta.label}</span>
                {overrideCount > 0 && (
                  <Badge variant="default" className="text-[10px] h-4 px-1">
                    {overrideCount} custom
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground hidden sm:block">{meta.description}</span>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>

            {isExpanded && (
              <div className="p-3 pt-0 space-y-2">
                {renderPromptRow(situation, null)}
                {subSituations.map(sub => renderPromptRow(situation, sub))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
