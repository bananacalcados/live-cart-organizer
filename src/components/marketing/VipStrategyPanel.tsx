import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Sparkles, Loader2, Save, ChevronLeft, ChevronRight, BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface VipStrategyPanelProps {
  campaignId?: string;
  campaignName?: string;
}

export function VipStrategyPanel({ campaignId, campaignName }: VipStrategyPanelProps) {
  const [month, setMonth] = useState(new Date());
  const [prompt, setPrompt] = useState("");
  const [content, setContent] = useState("");
  const [messageCount, setMessageCount] = useState(10);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

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
          messageCount,
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
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

  // For campaign mode, render inline (no collapsible)
  if (campaignId) {
    return (
      <div className="space-y-4">
        <StrategyForm
          campaignId={campaignId}
          prompt={prompt} setPrompt={setPrompt}
          messageCount={messageCount} setMessageCount={setMessageCount}
          periodStart={periodStart} setPeriodStart={setPeriodStart}
          periodEnd={periodEnd} setPeriodEnd={setPeriodEnd}
          isGenerating={isGenerating} generateStrategy={generateStrategy}
          isSaving={isSaving} saveStrategy={saveStrategy}
        />
        <StrategyContent
          content={content} setContent={setContent}
          campaignId={campaignId} isLoaded={isLoaded}
          isSaving={isSaving} saveStrategy={saveStrategy}
        />
      </div>
    );
  }

  // For main VIP page: collapsible element
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-dashed">
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-primary" />
                Estratégia Geral do Mês
                <span className="text-xs text-muted-foreground capitalize ml-1">— {monthLabel}</span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={prevMonth}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={nextMonth}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            <StrategyForm
              prompt={prompt} setPrompt={setPrompt}
              messageCount={messageCount} setMessageCount={setMessageCount}
              periodStart={periodStart} setPeriodStart={setPeriodStart}
              periodEnd={periodEnd} setPeriodEnd={setPeriodEnd}
              isGenerating={isGenerating} generateStrategy={generateStrategy}
              isSaving={isSaving} saveStrategy={saveStrategy}
            />
            <StrategyContent
              content={content} setContent={setContent}
              isLoaded={isLoaded}
              isSaving={isSaving} saveStrategy={saveStrategy}
            />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function StrategyForm({
  campaignId,
  prompt, setPrompt,
  messageCount, setMessageCount,
  periodStart, setPeriodStart,
  periodEnd, setPeriodEnd,
  isGenerating, generateStrategy,
  isSaving, saveStrategy,
}: {
  campaignId?: string;
  prompt: string; setPrompt: (v: string) => void;
  messageCount: number; setMessageCount: (v: number) => void;
  periodStart: string; setPeriodStart: (v: string) => void;
  periodEnd: string; setPeriodEnd: (v: string) => void;
  isGenerating: boolean; generateStrategy: () => void;
  isSaving: boolean; saveStrategy: () => void;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <Label className="text-xs flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {campaignId ? "Descreva o objetivo e tom desta campanha" : "Descreva a estratégia geral do mês"}
        </Label>
        <Textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={campaignId
            ? "Ex: Campanha de lançamento da coleção verão, foco em criar urgência e exclusividade, tom divertido e provocativo..."
            : "Ex: Mês de promoções de inverno, foco em fidelização, tom acolhedor..."
          }
          rows={3}
        />

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Qtd. mensagens</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={messageCount}
              onChange={e => setMessageCount(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Início do período</Label>
            <Input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Fim do período</Label>
            <Input
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          A IA irá gerar um roteiro completo com mensagens prontas (textos, enquetes, sugestões de imagens/vídeos/áudios) distribuídas no período.
        </p>

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
  );
}

function StrategyContent({
  content, setContent, campaignId, isLoaded, isSaving, saveStrategy,
}: {
  content: string; setContent: (v: string) => void;
  campaignId?: string; isLoaded: boolean;
  isSaving: boolean; saveStrategy: () => void;
}) {
  if (content) {
    return (
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <BookOpen className="h-4 w-4" />
            {campaignId ? "Roteiro da Campanha" : "Roteiro do Mês"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ScrollArea className="max-h-[500px]">
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={20}
              className="font-mono text-xs leading-relaxed resize-none"
            />
          </ScrollArea>
          <Button onClick={saveStrategy} disabled={isSaving} variant="outline" size="sm" className="gap-1 mt-3">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar Alterações
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoaded) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {campaignId ? "Nenhuma estratégia definida para esta campanha." : "Nenhuma estratégia definida para este mês."}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Use o prompt acima para gerar uma com IA.</p>
        </CardContent>
      </Card>
    );
  }

  return null;
}
