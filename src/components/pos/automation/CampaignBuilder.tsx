import { useEffect, useMemo, useRef, useState } from "react";
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
import { ArrowLeft, Loader2, Save, Play, Users, Pause, Send } from "lucide-react";
import { CampaignCardsEditor, CampaignCard, emptyCard } from "./CampaignCardsEditor";
import { isVirtualSeller } from "@/lib/pos/virtualSellers";
import {
  applyTokens, mappingToken, namedTokensOf, tokenToMapping, previewMappingValue,
  parseCarouselTemplate, BODY_VAR_OPTIONS, CARD_VAR_OPTIONS,
  type ParsedCarouselTemplate, type VarKind, type VarMapping,
} from "@/lib/pos/carouselTemplate";

/** Resolve a named token to a SAMPLE value for the test send. */
function resolveTestToken(
  token: string,
  cardLegenda: string | null,
  vars: Record<string, string>,
  vendedora: string,
): string {
  switch (token) {
    case "nome": return "Maria Teste";
    case "primeiro_nome": return "Maria";
    case "tamanho": return "37";
    case "vendedora": return vendedora || "nossa loja";
    case "legenda": return (cardLegenda || "").trim() || "—";
    default: return (vars[token] || "").trim() || "—";
  }
}

/** Keep only digits and ensure a Brazilian country code. */
function normalizeTestPhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

const WEEKDAYS = [
  { v: 1, label: "Seg" }, { v: 2, label: "Ter" }, { v: 3, label: "Qua" },
  { v: 4, label: "Qui" }, { v: 5, label: "Sex" }, { v: 6, label: "Sáb" }, { v: 0, label: "Dom" },
];

interface MetaNumber { id: string; label: string | null; phone_display: string | null; }
interface Publico { id: string; nome: string; filtro_json: unknown; }
interface Seller { id: string; name: string }
interface TplEntry { qtd: number; templateId: string; language: string }

interface Props {
  editingId: string | null;
  onClose: () => void;
}

/** Row to map ONE approved positional variable to a named token. */
function VarMappingRow({
  index, mapping, options, onChange,
}: {
  index: number;
  mapping: VarMapping;
  options: { kind: VarKind; label: string }[];
  onChange: (m: VarMapping) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white p-2">
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600">
        {`{{${index + 1}}}`}
      </span>
      <span className="text-xs text-neutral-500">preenche com</span>
      <Select value={mapping.kind} onValueChange={(v) => onChange({ kind: v as VarKind, value: mapping.value })}>
        <SelectTrigger className="h-8 w-[210px] bg-white text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.kind} value={o.kind}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {mapping.kind === "livre" && (
        <Input
          value={mapping.value || ""}
          onChange={(e) => onChange({ kind: "livre", value: e.target.value })}
          placeholder="Texto fixo"
          className="h-8 w-[200px] bg-white text-xs"
        />
      )}
    </div>
  );
}

export function CampaignBuilder({ editingId, onClose }: Props) {
  const [loading, setLoading] = useState(!!editingId);
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState("");
  const [numberId, setNumberId] = useState("");
  const [modelo, setModelo] = useState("");
  const [selectedQtd, setSelectedQtd] = useState<number | null>(null);

  const [cards, setCards] = useState<CampaignCard[]>([]);

  // Template structure + variable mappings.
  const [tplStruct, setTplStruct] = useState<ParsedCarouselTemplate | null>(null);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [bodyVars, setBodyVars] = useState<VarMapping[]>([]);
  const [cardVars, setCardVars] = useState<VarMapping[]>([]);

  const [publicoId, setPublicoId] = useState("");
  const [qtdPorDia, setQtdPorDia] = useState(50);
  const [diasSemana, setDiasSemana] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cooldownDias, setCooldownDias] = useState(30);
  const [rodizio, setRodizio] = useState(true);
  const [vendedorasSel, setVendedorasSel] = useState<string[]>([]);
  const [ativa, setAtiva] = useState(false);

  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);

  const [numbers, setNumbers] = useState<MetaNumber[]>([]);
  const [tplByModel, setTplByModel] = useState<Record<string, TplEntry[]>>({});
  const [publicos, setPublicos] = useState<Publico[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  // Holds stored values while editing, until the template is fetched and we can
  // reverse-derive the variable mappings.
  const editStored = useRef<{ topBody: string; cardBody: string; vars: Record<string, unknown> } | null>(null);

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
    if (!instanceId) { setTplByModel({}); return; }
    const { data } = await supabase
      .from("templates_carrossel")
      .select("nome, qtd_cards, template_id, template_language")
      .eq("whatsapp_number_id", instanceId)
      .eq("aprovado", true);
    const byModel: Record<string, TplEntry[]> = {};
    (data || []).forEach((r: { nome: string | null; qtd_cards: number; template_id: string; template_language: string | null }) => {
      const m = (r.nome || "Padrão").trim();
      (byModel[m] ||= []).push({ qtd: r.qtd_cards, templateId: r.template_id, language: r.template_language || "pt_BR" });
    });
    Object.values(byModel).forEach((arr) => arr.sort((a, b) => a.qtd - b.qtd));
    setTplByModel(byModel);
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
    setPublicoId(c.publico_id || "");
    setQtdPorDia(c.qtd_por_dia ?? 50);
    setDiasSemana(Array.isArray(c.dias_semana) ? c.dias_semana : [1, 2, 3, 4, 5]);
    setCooldownDias(c.cooldown_dias ?? 30);
    setRodizio(!!c.rodizio_vendedora);
    setVendedorasSel(Array.isArray(c.vendedoras_rodizio) ? c.vendedoras_rodizio : []);
    setAtiva(!!c.ativa);

    const vars = (c.variaveis && typeof c.variaveis === "object" && !Array.isArray(c.variaveis))
      ? (c.variaveis as Record<string, unknown>) : {};
    editStored.current = { topBody: c.top_body || "", cardBody: c.card_body || "", vars };

    const { data: cc } = await supabase
      .from("campanha_cards")
      .select("id, ordem, imagem_url, legenda, shopify_product_id, shopify_variant_id")
      .eq("campanha_id", id)
      .order("ordem", { ascending: true });
    const loaded = (cc || []).map((r: CampaignCard) => ({
      id: r.id, ordem: r.ordem, imagem_url: r.imagem_url, legenda: r.legenda || "",
      shopify_product_id: r.shopify_product_id, shopify_variant_id: r.shopify_variant_id,
    }));
    setCards(loaded);
    if (loaded.length >= 2) setSelectedQtd(loaded.length);
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

  const qtdOptions = useMemo<number[]>(
    () => (modelo && tplByModel[modelo] ? tplByModel[modelo].map((e) => e.qtd) : []),
    [modelo, tplByModel],
  );

  // Fetch the approved template structure from Meta when instance/model/qtd ready.
  useEffect(() => {
    const entry = (tplByModel[modelo] || []).find((e) => e.qtd === selectedQtd);
    if (!numberId || !modelo || !selectedQtd || !entry) { setTplStruct(null); return; }
    let active = true;
    setLoadingTpl(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
          body: { whatsappNumberId: numberId },
        });
        if (!active) return;
        if (error || !data?.templates) throw new Error(error?.message || "Falha ao buscar templates");
        const tpl = (data.templates as { name?: string; language?: string }[]).find(
          (t) => t.name === entry.templateId,
        );
        const parsed = parseCarouselTemplate(tpl);
        if (!parsed) { toast.error("Não foi possível ler a estrutura do template aprovado"); setTplStruct(null); return; }
        setTplStruct(parsed);

        // Build / restore mappings.
        const stored = editStored.current;
        const topTokens = stored ? namedTokensOf(stored.topBody) : [];
        const cardTokens = stored ? namedTokensOf(stored.cardBody) : [];
        setBodyVars(Array.from({ length: parsed.topVarCount }, (_, i) =>
          topTokens[i] ? tokenToMapping(topTokens[i], stored!.vars) : { kind: "nome" as VarKind }));
        setCardVars(Array.from({ length: parsed.cardVarCount }, (_, i) =>
          cardTokens[i] ? tokenToMapping(cardTokens[i], stored!.vars) : { kind: "legenda" as VarKind }));
        editStored.current = null;

        // Align card count with the template.
        setCards((prev) => {
          const next = [...prev];
          while (next.length < parsed.qtdCards) next.push(emptyCard(next.length));
          return next.slice(0, parsed.qtdCards).map((c, i) => ({ ...c, ordem: i }));
        });
      } catch (e) {
        if (active) { toast.error("Erro ao carregar template: " + (e as Error).message); setTplStruct(null); }
      } finally {
        if (active) setLoadingTpl(false);
      }
    })();
    return () => { active = false; };
  }, [numberId, modelo, selectedQtd, tplByModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const showCardLegenda = cardVars.some((m) => m.kind === "legenda");

  const buildPersistTexts = () => {
    if (!tplStruct) return { top: "", card: "", variaveis: {} as Record<string, string> };
    const topTokens = bodyVars.map((m, i) => mappingToken(m, "livre_top", i));
    const cardTokens = cardVars.map((m, i) => mappingToken(m, "livre_card", i));
    const variaveis: Record<string, string> = {};
    bodyVars.forEach((m, i) => { if (m.kind === "livre") variaveis[`livre_top_${i + 1}`] = m.value || ""; });
    cardVars.forEach((m, i) => { if (m.kind === "livre") variaveis[`livre_card_${i + 1}`] = m.value || ""; });
    return {
      top: applyTokens(tplStruct.topBodyText, topTokens),
      card: applyTokens(tplStruct.cardBodyText, cardTokens),
      variaveis,
    };
  };

  const sendTest = async () => {
    const phone = normalizeTestPhone(testPhone);
    if (phone.length < 12) { toast.error("Informe um telefone válido com DDD"); return; }
    if (!tplStruct) { toast.error("Aguarde o carregamento do template aprovado"); return; }
    const entry = (tplByModel[modelo] || []).find((e) => e.qtd === selectedQtd);
    if (!entry) { toast.error("Selecione instância, modelo e quantidade de cards"); return; }
    const okCards = cards.filter((c) => c.imagem_url).slice(0, selectedQtd || 0);
    if (okCards.length < (selectedQtd || 0)) { toast.error(`Adicione imagem em todos os ${selectedQtd} cards`); return; }

    setTestSending(true);
    try {
      const texts = buildPersistTexts();
      const vendedora = sellers.find((s) => vendedorasSel.includes(s.id))?.name || sellers[0]?.name || "";
      const topTokens = namedTokensOf(texts.top);
      const cardTokens = namedTokensOf(texts.card);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const components: any[] = [];
      if (topTokens.length) {
        components.push({
          type: "body",
          parameters: topTokens.map((t) => ({ type: "text", text: resolveTestToken(t, null, texts.variaveis, vendedora) })),
        });
      }
      const carouselCards = okCards.map((card, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const comps: any[] = [
          { type: "header", parameters: [{ type: "image", image: { link: card.imagem_url } }] },
        ];
        if (cardTokens.length) {
          comps.push({
            type: "body",
            parameters: cardTokens.map((t) => ({ type: "text", text: resolveTestToken(t, card.legenda, texts.variaveis, vendedora) })),
          });
        }
        return { card_index: i, components: comps };
      });
      components.push({ type: "carousel", cards: carouselCards });

      const { data, error } = await supabase.functions.invoke("meta-whatsapp-send-template", {
        body: {
          phone,
          templateName: entry.templateId,
          language: entry.language,
          whatsappNumberId: numberId,
          components,
        },
      });
      if (error) throw new Error(error.message);
      if (data && data.success === false) throw new Error(data.error || "Falha no envio");
      toast.success(`Teste enviado para ${phone} 🚀`);
    } catch (e) {
      toast.error("Erro ao enviar teste: " + (e as Error).message);
    } finally {
      setTestSending(false);
    }
  };

  const validateStart = (): string | null => {
    if (!nome.trim()) return "Dê um nome à automação";
    if (!numberId) return "Selecione a instância Meta";
    if (!modelo) return "Selecione o modelo de template";
    if (!selectedQtd) return "Selecione a quantidade de cards";
    if (!tplStruct) return "Aguarde o carregamento do template aprovado";
    if (!publicoId) return "Selecione o público";
    if (diasSemana.length === 0) return "Escolha ao menos um dia da semana";
    if (qtdPorDia < 1) return "O limite diário precisa ser ≥ 1";
    const okCards = cards.filter((c) => c.imagem_url).length;
    if (okCards < selectedQtd) return `Adicione imagem em todos os ${selectedQtd} cards`;
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
      const texts = buildPersistTexts();
      const payload = {
        nome: nome.trim(),
        whatsapp_number_id: numberId || null,
        template_modelo: modelo || null,
        top_body: texts.top,
        card_body: texts.card,
        variaveis: texts.variaveis as unknown as never,
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

  const models = Object.keys(tplByModel);
  const bodyPreview = tplStruct
    ? applyTokens(tplStruct.topBodyText, bodyVars.map((m) => previewMappingValue(m)))
    : "";

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

      {/* 1. Instância + modelo + quantidade de cards */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">1. Template aprovado</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Instância Meta</Label>
            <Select value={numberId} onValueChange={(v) => { setNumberId(v); setModelo(""); setSelectedQtd(null); setTplStruct(null); }}>
              <SelectTrigger className="bg-white"><SelectValue placeholder="Selecione a instância" /></SelectTrigger>
              <SelectContent>
                {numbers.map((n) => <SelectItem key={n.id} value={n.id}>{n.label || n.phone_display || n.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Modelo de template</Label>
            <Select value={modelo} onValueChange={(v) => { setModelo(v); setSelectedQtd(null); setTplStruct(null); }} disabled={!numberId}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder={numberId ? "Selecione o modelo" : "Escolha a instância primeiro"} />
              </SelectTrigger>
              <SelectContent>
                {models.length === 0
                  ? <div className="px-2 py-1.5 text-xs text-neutral-400">Nenhum template aprovado nesta instância</div>
                  : models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantidade de cards</Label>
            <Select
              value={selectedQtd ? String(selectedQtd) : ""}
              onValueChange={(v) => setSelectedQtd(Number(v))}
              disabled={!modelo}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder={modelo ? "Escolha a qtd" : "Escolha o modelo"} />
              </SelectTrigger>
              <SelectContent>
                {qtdOptions.length === 0
                  ? <div className="px-2 py-1.5 text-xs text-neutral-400">Nenhuma quantidade aprovada</div>
                  : qtdOptions.map((q) => <SelectItem key={q} value={String(q)}>{q} cards</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {loadingTpl && (
          <p className="text-[11px] text-neutral-500 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando estrutura do template aprovado...
          </p>
        )}
      </Card>

      {/* 2. Mensagem (texto do corpo, ACIMA dos cards) */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">2. Mensagem do disparo (acima dos cards)</h4>
        {!tplStruct ? (
          <p className="text-xs text-neutral-500">
            Selecione instância, modelo e quantidade de cards para carregar o texto aprovado.
          </p>
        ) : (
          <div className="space-y-2.5">
            <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Texto aprovado na Meta</p>
              {tplStruct.topBodyText || <span className="text-neutral-400">(sem texto)</span>}
            </div>
            {bodyVars.length > 0 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Como preencher cada variável</Label>
                {bodyVars.map((m, i) => (
                  <VarMappingRow
                    key={i} index={i} mapping={m} options={BODY_VAR_OPTIONS}
                    onChange={(nm) => setBodyVars((prev) => prev.map((x, j) => (j === i ? nm : x)))}
                  />
                ))}
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                  Prévia: {bodyPreview}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-neutral-400">Este texto não tem variáveis — será enviado fixo.</p>
            )}
          </div>
        )}
      </Card>

      {/* 3. Cards (abaixo da mensagem) */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">3. Imagens e cards do carrossel</h4>
        {tplStruct && tplStruct.cardVarCount > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Como preencher as variáveis do texto de cada card</Label>
            {cardVars.map((m, i) => (
              <VarMappingRow
                key={i} index={i} mapping={m} options={CARD_VAR_OPTIONS}
                onChange={(nm) => setCardVars((prev) => prev.map((x, j) => (j === i ? nm : x)))}
              />
            ))}
            <p className="rounded-md bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
              Para colocar <strong>nome e preço diferentes em cada card</strong>, escolha
              {" "}<strong>"Texto diferente em cada card"</strong>. Aí aparecerá um campo de texto
              próprio em cada card abaixo. Use "Texto fixo" só quando a legenda for igual em todos.
            </p>
          </div>
        )}
        <CampaignCardsEditor
          cards={cards}
          onChange={setCards}
          cardBodyText={tplStruct?.cardBodyText || null}
          buttonsPerCard={tplStruct?.cards.map((c) => c.buttons) || []}
          showLegenda={showCardLegenda}
          templateLoaded={!!tplStruct}
        />
      </Card>

      {/* 4. Público */}
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

      {/* 5. Agendamento */}
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

      {/* 6. Testar disparo */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-neutral-800">6. Testar disparo</h4>
        <p className="text-xs text-neutral-500">
          Envie o template exatamente como está configurado acima para um número de teste antes de
          iniciar a automação para todo o público.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Telefone do teste (com DDD)</Label>
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Ex.: 33 99195-5003"
              className="h-9 w-[220px] bg-white"
            />
          </div>
          <Button
            type="button"
            onClick={sendTest}
            disabled={testSending || !tplStruct}
            className="h-9 gap-2 bg-indigo-600 hover:bg-indigo-700"
          >
            {testSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Disparar teste
          </Button>
        </div>
        <p className="text-[11px] text-neutral-400">
          Variáveis de cliente ({`{{nome}}`}, {`{{tamanho}}`}) usam valores de exemplo. As legendas
          de cada card são enviadas exatamente como você digitou.
        </p>
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
