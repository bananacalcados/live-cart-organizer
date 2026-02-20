import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";

export interface ChannelParams {
  [key: string]: any;
}

interface StageConfig {
  name: string;
  date: string;
  messageCount: number;
  contentTypes: string[];
  description: string;
}

interface Props {
  channelType: string;
  params: ChannelParams;
  onParamsChange: (params: ChannelParams) => void;
}

const CONTENT_TYPES_VIP = ["texto", "imagem", "video", "enquete", "audio"];
const CONTENT_TYPES_INSTA = ["reels", "feed_foto", "feed_carrossel", "stories"];
const RFM_SEGMENTS = ["Campeões", "Leais", "Potenciais", "Novos", "Em Risco", "Hibernando", "Perdidos"];
const DIVULGACAO_CANAIS = ["carro_de_som", "panfleto", "vitrine", "banner_loja", "faixa_rua"];

export function ChannelConfigurator({ channelType, params, onParamsChange }: Props) {
  const update = (key: string, value: any) => onParamsChange({ ...params, [key]: value });

  const stages: StageConfig[] = params.stages || [];
  const updateStage = (idx: number, field: string, value: any) => {
    const newStages = [...stages];
    newStages[idx] = { ...newStages[idx], [field]: value };
    update("stages", newStages);
  };
  const addStage = () => {
    update("stages", [...stages, { name: `Etapa ${stages.length + 1}`, date: "", messageCount: 3, contentTypes: ["texto"], description: "" }]);
  };
  const removeStage = (idx: number) => {
    update("stages", stages.filter((_, i) => i !== idx));
  };

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];

  if (channelType === "grupo_vip") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Data de Execução</Label>
            <Input type="date" value={params.execution_date || ""} onChange={e => update("execution_date", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Nome do Grupo</Label>
            <Input placeholder="Ex: VIP Verão 2026" value={params.group_name || ""} onChange={e => update("group_name", e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label className="font-semibold">Etapas da Comunicação ({stages.length})</Label>
          <Button variant="outline" size="sm" onClick={addStage} className="gap-1"><Plus className="h-3 w-3" />Etapa</Button>
        </div>

        {stages.map((stage, i) => (
          <Card key={i} className="border-dashed">
            <CardContent className="pt-3 pb-3 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline">Etapa {i + 1}</Badge>
                <Button variant="ghost" size="sm" onClick={() => removeStage(i)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input value={stage.name} onChange={e => updateStage(i, "name", e.target.value)} placeholder="Aquecimento" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={stage.date} onChange={e => updateStage(i, "date", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Qtd Mensagens</Label>
                  <Select value={String(stage.messageCount)} onValueChange={v => updateStage(i, "messageCount", parseInt(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6,7,8,9,10].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipos de Conteúdo</Label>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES_VIP.map(ct => (
                    <label key={ct} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox checked={stage.contentTypes.includes(ct)} onCheckedChange={() => updateStage(i, "contentTypes", toggleArrayItem(stage.contentTypes, ct))} />
                      {ct}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrição da etapa</Label>
                <Textarea value={stage.description} onChange={e => updateStage(i, "description", e.target.value)} rows={2} placeholder="O que deve acontecer nessa etapa..." />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (channelType === "whatsapp_marketing") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Quantidade de Mensagens</Label>
            <Select value={String(params.message_count || 3)} onValueChange={v => update("message_count", parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7,8,9,10].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Qtd de Etapas</Label>
            <Select value={String(params.step_count || 1)} onValueChange={v => update("step_count", parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Segmentos RFM Alvo</Label>
          <div className="flex flex-wrap gap-2">
            {RFM_SEGMENTS.map(seg => (
              <label key={seg} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={(params.target_segments || []).includes(seg)} onCheckedChange={() => update("target_segments", toggleArrayItem(params.target_segments || [], seg))} />
                {seg}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Delay entre Etapas (horas)</Label>
            <Select value={String(params.delay_hours || 24)} onValueChange={v => update("delay_hours", parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,4,6,12,24,48,72].map(n => <SelectItem key={n} value={String(n)}>{n}h</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Horário de Envio</Label>
            <Select value={params.send_time || "09:00"} onValueChange={v => update("send_time", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["07:00","08:00","09:00","10:00","11:00","12:00","14:00","16:00","18:00","19:00","20:00"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Instruções adicionais</Label>
          <Textarea value={params.extra_instructions || ""} onChange={e => update("extra_instructions", e.target.value)} rows={2} placeholder="Ex: Focar em reativação de clientes inativos..." />
        </div>
      </div>
    );
  }

  if (channelType === "instagram") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Tipos de Conteúdo</Label>
          <div className="flex flex-wrap gap-2">
            {CONTENT_TYPES_INSTA.map(ct => (
              <label key={ct} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={(params.content_types || ["reels", "feed_carrossel", "stories"]).includes(ct)} onCheckedChange={() => update("content_types", toggleArrayItem(params.content_types || ["reels", "feed_carrossel", "stories"], ct))} />
                {ct === "reels" ? "Reels" : ct === "feed_foto" ? "Feed (Foto)" : ct === "feed_carrossel" ? "Feed (Carrossel)" : "Stories"}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Qtd Posts por Tipo</Label>
            <Select value={String(params.posts_per_type || 3)} onValueChange={v => update("posts_per_type", parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7,8,10].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Frequência Semanal</Label>
            <Select value={String(params.weekly_frequency || 3)} onValueChange={v => update("weekly_frequency", parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7].map(n => <SelectItem key={n} value={String(n)}>{n}x/semana</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={params.use_influencer || false} onCheckedChange={v => update("use_influencer", v)} />
            Usar Influenciador?
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={params.invest_ads || false} onCheckedChange={v => update("invest_ads", v)} />
            Investir em Ads?
          </label>
        </div>
        {params.invest_ads && (
          <div className="space-y-2">
            <Label>Orçamento de Ads (R$)</Label>
            <Input type="number" value={params.ads_budget || ""} onChange={e => update("ads_budget", e.target.value)} placeholder="500" />
          </div>
        )}
      </div>
    );
  }

  if (channelType === "loja_fisica") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Público da Ação</Label>
          <Input value={params.target_public || ""} onChange={e => update("target_public", e.target.value)} placeholder="Ex: Mulheres 30-50 anos, clientes do bairro" />
        </div>
        <div className="space-y-2">
          <Label>Canais de Divulgação</Label>
          <div className="flex flex-wrap gap-2">
            {DIVULGACAO_CANAIS.map(ch => (
              <label key={ch} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={(params.divulgacao_channels || []).includes(ch)} onCheckedChange={() => update("divulgacao_channels", toggleArrayItem(params.divulgacao_channels || [], ch))} />
                {ch === "carro_de_som" ? "Carro de Som" : ch === "panfleto" ? "Panfleto" : ch === "vitrine" ? "Vitrine" : ch === "banner_loja" ? "Banner Loja" : "Faixa de Rua"}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Meta de Vendas/Dia</Label>
            <Input type="number" value={params.sales_goal_day || ""} onChange={e => update("sales_goal_day", e.target.value)} placeholder="10" />
          </div>
          <div className="space-y-2">
            <Label>Meta de Cadastros/Dia</Label>
            <Input type="number" value={params.signup_goal_day || ""} onChange={e => update("signup_goal_day", e.target.value)} placeholder="20" />
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={params.use_gamification || false} onCheckedChange={v => update("use_gamification", v)} />
            Gamificação Equipe?
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={params.change_store_layout || false} onCheckedChange={v => update("change_store_layout", v)} />
            Organização Especial?
          </label>
        </div>
        <div className="space-y-2">
          <Label>Instruções adicionais</Label>
          <Textarea value={params.extra_instructions || ""} onChange={e => update("extra_instructions", e.target.value)} rows={2} placeholder="Ex: Foco em calçados ortopédicos, montar ilha de promoção..." />
        </div>
      </div>
    );
  }

  if (channelType === "email") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Quantidade de Emails</Label>
            <Select value={String(params.email_count || 3)} onValueChange={v => update("email_count", parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,8,10].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Frequência</Label>
            <Select value={params.frequency || "2x_semana"} onValueChange={v => update("frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="diario">Diário</SelectItem>
                <SelectItem value="2x_semana">2x por semana</SelectItem>
                <SelectItem value="semanal">Semanal</SelectItem>
                <SelectItem value="quinzenal">Quinzenal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Automações</Label>
          <div className="flex flex-wrap gap-2">
            {["welcome", "abandoned_cart", "post_purchase", "reactivation"].map(a => (
              <label key={a} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={(params.automations || []).includes(a)} onCheckedChange={() => update("automations", toggleArrayItem(params.automations || [], a))} />
                {a === "welcome" ? "Welcome" : a === "abandoned_cart" ? "Carrinho Abandonado" : a === "post_purchase" ? "Pós-Compra" : "Reativação"}
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // site
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={params.use_banners ?? true} onCheckedChange={v => update("use_banners", v)} />
          Banners
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={params.use_popups || false} onCheckedChange={v => update("use_popups", v)} />
          Pop-ups
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={params.use_landing_page || false} onCheckedChange={v => update("use_landing_page", v)} />
          Landing Page
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={params.use_coupon || false} onCheckedChange={v => update("use_coupon", v)} />
          Cupom Exclusivo
        </label>
      </div>
      {params.use_coupon && (
        <div className="space-y-2">
          <Label>Código do Cupom</Label>
          <Input value={params.coupon_code || ""} onChange={e => update("coupon_code", e.target.value)} placeholder="VERAO2026" />
        </div>
      )}
    </div>
  );
}
