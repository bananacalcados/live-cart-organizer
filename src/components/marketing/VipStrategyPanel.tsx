import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Sparkles, Loader2, Save, ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface VipStrategyPanelProps {
  /** If provided, shows campaign-level strategy; otherwise shows general monthly strategy */
  campaignId?: string;
  campaignName?: string;
}

export function VipStrategyPanel({ campaignId, campaignName }: VipStrategyPanelProps) {
  const [month, setMonth] = useState(new Date());
  const [prompt, setPrompt] = useState("");
  const [content, setContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const monthKey = format(month, "yyyy-MM");
  const monthLabel = format(month, "MMMM yyyy", { locale: ptBR });

  useEffect(() => {
    loadStrategy();
  }, [monthKey, campaignId]);

  const loadStrategy = async () => {
    setIsLoaded(false);
    if (campaignId) {
      const { data } = await supabase
        .from('group_campaigns')
        .select('strategy_prompt, strategy_content')
        .eq('id', campaignId)
        .single();
      if (data) {
        setPrompt((data as any).strategy_prompt || "");
        setContent((data as any).strategy_content || "");
      }
    } else {
      const { data } = await supabase
        .from('vip_group_strategies')
        .select('*')
        .eq('month_year', monthKey)
        .maybeSingle();
      if (data) {
        setPrompt((data as any).strategy_prompt || "");
        setContent((data as any).strategy_content || "");
      } else {
        setPrompt("");
        setContent("");
      }
    }
    setIsLoaded(true);
  };

  const generateStrategy = async () => {
    if (!prompt.trim()) { toast.error("Descreva a estratégia desejada"); return; }
    setIsGenerating(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-vip-strategy`, {
        method: 'POST',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          type: campaignId ? 'campaign' : 'general',
          campaignName: campaignName || '',
          monthYear: monthLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao gerar estratégia");
        return;
      }
      if (data.strategy) {
        setContent(data.strategy);
        toast.success("Estratégia gerada pela IA!");
      }
    } catch { toast.error("Erro ao gerar estratégia"); }
    finally { setIsGenerating(false); }
  };

  const saveStrategy = async () => {
    setIsSaving(true);
    try {
      if (campaignId) {
        await supabase.from('group_campaigns').update({
          strategy_prompt: prompt,
          strategy_content: content,
        } as any).eq('id', campaignId);
      } else {
        await supabase.from('vip_group_strategies').upsert({
          month_year: monthKey,
          strategy_prompt: prompt,
          strategy_content: content,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'month_year' });
      }
      toast.success("Estratégia salva!");
    } catch { toast.error("Erro ao salvar"); }
    finally { setIsSaving(false); }
  };

  const prevMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth() - 1));
  const nextMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1));

  return (
    <div className="space-y-4">
      {/* Month selector (only for general strategy) */}
      {!campaignId && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold capitalize min-w-[140px] text-center">
            📅 {monthLabel}
          </span>
          <Button variant="ghost" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Prompt */}
      <Card className="border-dashed">
        <CardContent className="p-4 space-y-3">
          <Label className="text-xs flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {campaignId ? "Descreva o objetivo desta campanha" : "Descreva a estratégia geral do mês"}
          </Label>
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={campaignId
              ? "Ex: Campanha de lançamento da coleção verão, foco em criar urgência e exclusividade..."
              : "Ex: Mês de promoções de inverno, foco em fidelização, 2 mensagens por dia..."
            }
            rows={3}
          />
          <div className="flex gap-2">
            <Button onClick={generateStrategy} disabled={isGenerating} className="gap-1" size="sm">
              {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Gerar com IA
            </Button>
            <Button onClick={saveStrategy} disabled={isSaving} variant="outline" size="sm" className="gap-1">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {content ? (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BookOpen className="h-4 w-4" />
              {campaignId ? "Estratégia da Campanha" : "Estratégia do Mês"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ScrollArea className="max-h-[400px]">
              <Textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={16}
                className="font-mono text-xs leading-relaxed resize-none"
              />
            </ScrollArea>
            <Button onClick={saveStrategy} disabled={isSaving} variant="outline" size="sm" className="gap-1 mt-3">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar Alterações
            </Button>
          </CardContent>
        </Card>
      ) : isLoaded ? (
        <Card>
          <CardContent className="py-8 text-center">
            <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {campaignId ? "Nenhuma estratégia definida para esta campanha." : "Nenhuma estratégia definida para este mês."}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Use o prompt acima para gerar uma com IA.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
