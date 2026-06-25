import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Save, Play, Users, Pause } from "lucide-react";
import { VariableTextField } from "@/components/admin/VariableTextField";
import { CampaignCardsEditor, CampaignCard, emptyCard } from "./CampaignCardsEditor";
import { isVirtualSeller } from "@/lib/pos/virtualSellers";
import { STANDARD_VARS, SELLER_VAR_TOKEN, type VarDef } from "@/lib/pos/carouselTemplate";

const STANDARD_TOKENS = new Set(STANDARD_VARS.map((v) => v.token));
const WEEKDAYS = [
  { v: 1, label: "Seg" },
  { v: 2, label: "Ter" },
  { v: 3, label: "Qua" },
  { v: 4, label: "Qui" },
  { v: 5, label: "Sex" },
  { v: 6, label: "Sáb" },
  { v: 0, label: "Dom" },
];

interface MetaNumber { id: string; label: string | null; phone_display: string | null; }
interface Publico { id: string; nome: string; filtro_json: unknown; }
interface Seller { id: string; name: string }

interface Props {
  editingId: string | null;
  onClose: () => void;
}

export function CampaignBuilder({ editingId, onClose }: Props) {
  const [loading, setLoading] = useState(!!editingId);
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState("");
  const [numberId, setNumberId] = useState("");
  const [modelo, setModelo] = useState("");
  const [topBody, setTopBody] = useState("Oiee {{nome}}! Confira nossas novidades 👟");
  const [cardBody, setCardBody] = useState("");
  const [variables, setVariables] = useState<VarDef[]>([...STANDARD_VARS]);
  const [cards, setCards] = useState<CampaignCard[]>([emptyCard(0), emptyCard(1)]);

  const [publicoId, setPublicoId] = useState("");
  const [qtdPorDia, setQtdPorDia] = useState(50);
  const [diasSemana, setDiasSemana] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cooldownDias, setCooldownDias] = useState(30);
  const [rodizio, setRodizio] = useState(true);
  const [vendedorasSel, setVendedorasSel] = useState<string[]>([]);
  const [ativa, setAtiva] = useState(false);

  const [numbers, setNumbers] = useState<MetaNumber[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [approvedByModel, setApprovedByModel] = useState<Record<string, number[]>>({});
  const [publicos, setPublicos] = useState<Publico[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  const addVariable = (v: VarDef) =>
    setVariables((prev) => (prev.some((x) => x.token === v.token) ? prev : [...prev, v]));

  // ---- loaders ----
  const loadNumbers = async () => {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_display, business_account_id, provider, is_active")
      .eq("is_active", true);
    const meta = (data || []).filter(
      (n: { provider: string | null; business_account_id: string | null }) =>
        (n.provider === "meta" || !n.provider) && !!n.business_account_id,
    ) as MetaNumber[];
    setNumbers(meta);
  };

  const loadApproved = async (instanceId: string) => {
    if (!instanceId) { setModels([]); setApprovedByModel({}); return; }
    const { data } = await supabase
      .from("templates_carrossel")
      .select("nome, qtd_cards")
      .eq("whatsapp_number_id", instanceId)
      .eq("aprovado", true);
    const byModel: Record<string, number[]> = {};
    (data || []).forEach((r: { nome: string | null; qtd_cards: number }) => {
      const m = (r.nome || "Padrão").trim();
      (byModel[m] ||= []).push(r.qtd_cards);
    });
    setApprovedByModel(byModel);
    setModels(Object.keys(byModel));
  };

  const loadPublicos = async () => {
    const { data } = await supabase
      .from("campanha_publicos")
      .select("id, nome, filtro_json")
      .order("created_at", { ascending: false });
    setPublicos((data as Publico[]) || []);
  };

  const loadSellers = async () => {
    const { data } = await supabase.from("pos_sellers").select("id, name").eq("is_active", true);
    setSellers(
      (data || [])
        .map((s: { id: string; name: string | null }) => ({ id: s.id, name: (s.name || "").trim() }))
        .filter((s) => s.name && !isVirtualSeller(s.name)),
    );
  };

  const loadCampaign = async (id: string) => {
    const { data: c } = await supabase.from("campanhas_auto").select("*").eq("id", id).maybeSingle();
    if (!c) { toast.error("Automação não encontrada"); onClose(); return; }
    setNome(c.nome || "");
    setNumberId(c.whatsapp_number_id || "");
    setModelo(c.template_modelo || "");
    setTopBody(c.top_body || "");
    setCardBody(c.card_body || "");
    setPublicoId(c.publico_id || "");
    setQtdPorDia(c.qtd_por_dia ?? 50);
    setDiasSemana(Array.isArray(c.dias_semana) ? c.dias_semana : [1, 2, 3, 4, 5]);
    setCooldownDias(c.cooldown_dias ?? 30);
    setRodizio(!!c.rodizio_vendedora);
    setVendedorasSel(Array.isArray(c.vendedoras_rodizio) ? c.vendedoras_rodizio : []);
    setAtiva(!!c.ativa);

    // Rebuild free variables from stored map.
    const v = (c.variaveis && typeof c.variaveis === "object" && !Array.isArray(c.variaveis))
      ? (c.variaveis as Record<string, unknown>) : {};
    const freeVars: VarDef[] = Object.entries(v).map(([token, val]) => ({
      token, label: token.startsWith("livre_") ? "Texto livre" : token, example: String(val ?? ""),
    }));
    setVariables([...STANDARD_VARS, ...freeVars.filter((fv) => !STANDARD_TOKENS.has(fv.token))]);

    const { data: cc } = await supabase
      .from("campanha_cards")
      .select("id, ordem, imagem_url, legenda, shopify_product_id, shopify_variant_id")
      .eq("campanha_id", id)
      .order("ordem", { ascending: true });
    const loaded = (cc || []).map((r: CampaignCard) => ({
      id: r.id, ordem: r.ordem, imagem_url: r.imagem_url, legenda: r.legenda || "",
      shopify_product_id: r.shopify_product_id, shopify_variant_id: r.shopify_variant_id,
    }));
    setCards(loaded.length >= 2 ? loaded : [emptyCard(0), emptyCard(1)]);
    setLoading(false);
  };

  useEffect(() => {
    loadNumbers(); loadPublicos(); loadSellers();
    if (editingId) loadCampaign(editingId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadApproved(numberId); }, [numberId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audience count for the selected público.
  useEffect(() => {
    const pub = publicos.find((p) => p.id === publicoId);
    if (!pub) { setAudienceCount(null); return; }
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc("count_campaign_audience", {
        p_filtro: pub.filtro_json as unknown as never,
      });
      if (!active) return;
      setAudienceCount(!error && typeof data === "number" ? data : null);
    })();
    return () => { active = false; };
  }, [publicoId, publicos]);

  const approvedCounts = useMemo(
    () => (modelo && approvedByModel[modelo] ? approvedByModel[modelo] : []),
    [modelo, approvedByModel],
  );

  const buildVariaveis = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const v of variables) {
      if (STANDARD_TOKENS.has(v.token) || v.token === SELLER_VAR_TOKEN) continue;
      out[v.token] = v.example || "";
    }
    return out;
  };

  const validateStart = (): string | null => {
    if (!nome.trim()) return "Dê um nome à automação";
    if (!numberId) return "Selecione a instância Meta";
    if (!modelo) return "Selecione o modelo de template";
    if (!publicoId) return "Selecione o público";
    if (diasSemana.length === 0) return "Escolha ao menos um dia da semana";
    if (qtdPorDia < 1) return "O limite diário precisa ser ≥ 1";
    const okCards = cards.filter((c) => c.imagem_url).length;
    if (okCards < 2) return "Adicione ao menos 2 cards com imagem";
    if (!approvedCounts.includes(okCards))
      return `Não há template aprovado de ${okCards} cards para o modelo "${modelo}". Aprovados: ${approvedCounts.join(", ") || "nenhum"}.`;
    return null;
  };

  const persist = async (startNow: boolean): Promise<boolean> => {
    if (startNow) {
      const err = validateStart();
      if (err) { toast.error(err); return false; }
    } else if (!nome.trim()) {
      toast.error("Dê um nome à automação");
      return false;
    }

    setSaving(true);
    try {
      const payload = {
        nome: nome.trim(),
        whatsapp_number_id: numberId || null,
        template_modelo: modelo || null,
        top_body: topBody,
        card_body: cardBody,
        variaveis: buildVariaveis() as unknown as never,
        publico_id: publicoId || null,
        qtd_por_dia: qtdPorDia,
        dias_semana: diasSemana,
        cooldown_dias: cooldownDias,
        rodizio_vendedora: rodizio,
        vendedoras_rodizio: rodizio && vendedorasSel.length ? vendedorasSel : null,
        ativa: startNow ? true : ativa,
      };

      let campId = editingId;
      if (campId) {
        const { error } = await supabase.from("campanhas_auto").update(payload).eq("id", campId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("campanhas_auto").insert(payload).select("id").single();
        if (error) throw error;
        campId = data.id;
      }

      // Replace cards.
      await supabase.from("campanha_cards").delete().eq("campanha_id", campId);
      const cardRows = cards
        .filter((c) => c.imagem_url)
        .map((c, i) => ({
          campanha_id: campId,
          ordem: i,
          imagem_url: c.imagem_url,
          legenda: c.legenda || null,
          shopify_product_id: c.shopify_product_id || null,
          shopify_variant_id: c.shopify_variant_id || null,
          status: "ok",
        }));
      if (cardRows.length) {
        const { error: cErr } = await supabase.from("campanha_cards").insert(cardRows);
        if (cErr) throw cErr;
      }

      setAtiva(payload.ativa);
      toast.success(startNow ? "Automação iniciada 🚀" : "Automação salva");
      return true;
    } catch (e) {
      toast.error("Erro ao salvar: " + (e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (d: number) =>
    setDiasSemana((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const toggleSeller = (id: string) =>
    setVendedorasSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-2 text-neutral-700" onClick={onClose}>
        <ArrowLeft className="h-4 w-4" /> Voltar às automações
      </Button>

      <div className="space-y-1.5">
        <Label>Nome da automação</Label>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Novidades tamanho 34" className="bg-white" />
      </div>

      {/* Instância + modelo */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">1. Template aprovado</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Instância Meta</Label>
            <Select value={numberId} onValueChange={(v) => { setNumberId(v); setModelo(""); }}>
              <SelectTrigger className="bg-white"><SelectValue placeholder="Selecione a instância" /></SelectTrigger>
              <SelectContent>
                {numbers.map((n) => <SelectItem key={n.id} value={n.id}>{n.label || n.phone_display || n.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Modelo de template</Label>
            <Select value={modelo} onValueChange={setModelo} disabled={!numberId}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder={numberId ? "Selecione o modelo" : "Escolha a instância primeiro"} />
              </SelectTrigger>
              <SelectContent>
                {models.length === 0
                  ? <div className="px-2 py-1.5 text-xs text-neutral-400">Nenhum template aprovado nesta instância</div>
                  : models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            {modelo && (
              <p className="text-[11px] text-neutral-400">Aprovados: {(approvedByModel[modelo] || []).sort((a, b) => a - b).join(", ") || "nenhum"} cards.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Cards */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">2. Imagens e legendas dos cards</h4>
        <CampaignCardsEditor
          cards={cards}
          onChange={setCards}
          variables={variables}
          onAddVariable={addVariable}
          approvedCounts={approvedCounts}
        />
      </Card>

      {/* Textos */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">3. Mensagem (variáveis)</h4>
        <VariableTextField
          label="Texto do corpo (acima dos cards)"
          value={topBody}
          onChange={setTopBody}
          variables={variables}
          onAddVariable={addVariable}
          multiline
          hint="As variáveis são preenchidas no envio (nome, tamanho, vendedora em rodízio, texto livre)."
        />
        <VariableTextField
          label="Legenda padrão dos cards (se o card não tiver legenda própria)"
          value={cardBody}
          onChange={setCardBody}
          variables={variables}
          onAddVariable={addVariable}
          multiline
        />
      </Card>

      {/* Público */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">4. Público</h4>
        <div className="space-y-1.5">
          <Label>Selecione o público</Label>
          <Select value={publicoId} onValueChange={setPublicoId}>
            <SelectTrigger className="bg-white"><SelectValue placeholder="Selecione o público" /></SelectTrigger>
            <SelectContent>
              {publicos.length === 0
                ? <div className="px-2 py-1.5 text-xs text-neutral-400">Nenhum público criado — crie na aba Públicos</div>
                : publicos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {publicoId && (
            <p className="text-xs text-neutral-500 flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {audienceCount === null ? "Calculando alcance..." : `~${audienceCount.toLocaleString("pt-BR")} clientes no público`}
            </p>
          )}
        </div>
      </Card>

      {/* Agendamento */}
      <Card className="p-4 space-y-4">
        <h4 className="text-sm font-bold text-neutral-800">5. Agendamento e limites</h4>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Limite de disparos por dia</Label>
            <Input type="number" min={1} value={qtdPorDia}
              onChange={(e) => setQtdPorDia(Math.max(1, Number(e.target.value) || 1))} className="bg-white" />
          </div>
          <div className="space-y-1.5">
            <Label>Cooldown (dias até reenviar à mesma pessoa)</Label>
            <Input type="number" min={0} value={cooldownDias}
              onChange={(e) => setCooldownDias(Math.max(0, Number(e.target.value) || 0))} className="bg-white" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Dias da semana de disparo</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <Button key={d.v} type="button" size="sm"
                variant={diasSemana.includes(d.v) ? "default" : "outline"}
                className={diasSemana.includes(d.v) ? "bg-blue-600 hover:bg-blue-700 h-8" : "h-8"}
                onClick={() => toggleDay(d.v)}>
                {d.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm">Rodízio de vendedoras</Label>
            <p className="text-[11px] text-neutral-500">A variável {`{{vendedora}}`} entra com nomes diferentes a cada envio.</p>
          </div>
          <Switch checked={rodizio} onCheckedChange={setRodizio} />
        </div>

        {rodizio && (
          <div className="space-y-1.5">
            <Label className="text-xs">Vendedoras no rodízio (vazio = todas ativas)</Label>
            <div className="flex flex-wrap gap-1.5">
              {sellers.map((s) => (
                <Button key={s.id} type="button" size="sm"
                  variant={vendedorasSel.includes(s.id) ? "default" : "outline"}
                  className={vendedorasSel.includes(s.id) ? "bg-emerald-600 hover:bg-emerald-700 h-7 text-xs" : "h-7 text-xs"}
                  onClick={() => toggleSeller(s.id)}>
                  {s.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Ações */}
      <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
        <Button variant="outline" onClick={() => persist(false)} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar rascunho
        </Button>
        {ativa ? (
          <Button
            onClick={async () => {
              setSaving(true);
              const { error } = await supabase.from("campanhas_auto").update({ ativa: false }).eq("id", editingId);
              setSaving(false);
              if (error) { toast.error("Erro ao pausar"); return; }
              setAtiva(false);
              toast.success("Automação pausada");
            }}
            disabled={saving || !editingId}
            className="gap-2 bg-amber-500 hover:bg-amber-600"
          >
            <Pause className="h-4 w-4" /> Pausar automação
          </Button>
        ) : (
          <Button onClick={() => persist(true)} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Iniciar automação
          </Button>
        )}
      </div>
    </div>
  );
}
