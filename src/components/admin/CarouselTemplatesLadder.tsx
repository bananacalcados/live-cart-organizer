import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, RefreshCw, Upload, Images, CheckCircle2, Clock, XCircle, Layers, Plus, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { VariableTextField } from "@/components/admin/VariableTextField";
import { isVirtualSeller } from "@/lib/pos/virtualSellers";
import {
  STANDARD_VARS,
  SELLER_VAR_TOKEN,
  buildComponentText,
  BUTTON_TYPE_LABEL,
  type VarDef,
  type ButtonType,
  type BuiltButton,
} from "@/lib/pos/carouselTemplate";

const LADDER = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_CARDS = 10;

interface MetaNumber {
  id: string;
  label: string | null;
  phone_display: string | null;
  business_account_id: string | null;
  provider: string | null;
}

interface LadderRow {
  id: string;
  nome: string;
  qtd_cards: number;
  template_id: string;
  template_language: string;
  aprovado: boolean;
  meta_status: string;
  whatsapp_number_id: string | null;
  updated_at: string;
}

interface BtnSlot { type: ButtonType; }
interface BtnValue { text: string; url?: string; phone?: string; }

function statusBadge(row?: LadderRow) {
  if (!row) return <Badge variant="outline" className="gap-1"><Layers className="h-3 w-3" /> Não criado</Badge>;
  if (row.aprovado || row.meta_status === "APPROVED")
    return <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" /> Aprovado</Badge>;
  if (row.meta_status === "REJECTED")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rejeitado</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> {row.meta_status || "Pendente"}</Badge>;
}

function emptyCardValues(): BtnValue[] {
  return Array.from({ length: MAX_CARDS }, () => ({ text: "" }));
}

export function CarouselTemplatesLadder() {
  const [numbers, setNumbers] = useState<MetaNumber[]>([]);
  const [numberId, setNumberId] = useState<string>("");
  const [models, setModels] = useState<string[]>([]);
  const [modelName, setModelName] = useState<string>("Padrão");
  const [rows, setRows] = useState<Record<number, LadderRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [sampleB64, setSampleB64] = useState<string>("");
  const [sampleType, setSampleType] = useState<string>("");
  const [sampleName, setSampleName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Editable variables registry (standard + free).
  const [variables, setVariables] = useState<VarDef[]>([...STANDARD_VARS]);
  const addVariable = (v: VarDef) =>
    setVariables((prev) => (prev.some((x) => x.token === v.token) ? prev : [...prev, v]));

  // Active real sellers (used for the {{vendedora}} rotation + approval example).
  const [sellers, setSellers] = useState<string[]>([]);

  const [topBody, setTopBody] = useState("Oiee {{nome}}! Confira nossas novidades 👟");
  const [cardBody, setCardBody] = useState("Produto incrível por um super preço");

  // Buttons.
  const [buttonMode, setButtonMode] = useState<"shared" | "perCard">("shared");
  const [buttonSlots, setButtonSlots] = useState<BtnSlot[]>([{ type: "QUICK_REPLY" }]);
  const [sharedValues, setSharedValues] = useState<BtnValue[]>([{ text: "Quero esse" }]);
  const [perCardValues, setPerCardValues] = useState<BtnValue[][]>([emptyCardValues()]);

  const addSlot = () => {
    if (buttonSlots.length >= 2) return;
    setButtonSlots((p) => [...p, { type: "QUICK_REPLY" }]);
    setSharedValues((p) => [...p, { text: "" }]);
    setPerCardValues((p) => [...p, emptyCardValues()]);
  };
  const removeSlot = (i: number) => {
    if (buttonSlots.length <= 1) return;
    setButtonSlots((p) => p.filter((_, idx) => idx !== i));
    setSharedValues((p) => p.filter((_, idx) => idx !== i));
    setPerCardValues((p) => p.filter((_, idx) => idx !== i));
  };
  const setSlotType = (i: number, type: ButtonType) =>
    setButtonSlots((p) => p.map((s, idx) => (idx === i ? { type } : s)));
  const setShared = (i: number, patch: Partial<BtnValue>) =>
    setSharedValues((p) => p.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const setPerCard = (slot: number, card: number, patch: Partial<BtnValue>) =>
    setPerCardValues((p) =>
      p.map((arr, si) =>
        si === slot ? arr.map((v, ci) => (ci === card ? { ...v, ...patch } : v)) : arr,
      ),
    );

  const loadNumbers = async () => {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_display, business_account_id, provider")
      .eq("is_active", true);
    const meta = (data || []).filter(
      (n: MetaNumber) => (n.provider === "meta" || !n.provider) && !!n.business_account_id,
    );
    setNumbers(meta);
    if (meta.length && !numberId) setNumberId(meta[0].id);
  };

  // Distinct model names that already exist for the selected instance.
  const loadModels = async () => {
    if (!numberId) { setModels([]); return; }
    const { data } = await supabase
      .from("templates_carrossel")
      .select("nome")
      .eq("whatsapp_number_id", numberId);
    const names = Array.from(
      new Set((data || []).map((r: { nome: string | null }) => (r.nome || "Padrão").trim())),
    );
    setModels(names);
  };

  const loadRows = async () => {
    if (!numberId) { setRows({}); return; }
    setLoading(true);
    const { data } = await supabase
      .from("templates_carrossel")
      .select("*")
      .eq("whatsapp_number_id", numberId)
      .order("nome", { ascending: true });
    const map: Record<number, LadderRow[]> = {};
    (data || []).forEach((r: LadderRow) => {
      (map[r.qtd_cards] ||= []).push(r);
    });
    setRows(map);
    setLoading(false);
  };

  const loadSellers = async () => {
    const { data } = await supabase
      .from("pos_sellers")
      .select("name")
      .eq("is_active", true);
    const names = Array.from(
      new Set(
        (data || [])
          .map((s: { name: string | null }) => (s.name || "").trim())
          .filter((n) => n && !isVirtualSeller(n)),
      ),
    );
    setSellers(names);
    // Use a real seller name as the Meta-approval example for {{vendedora}}.
    if (names.length) {
      setVariables((prev) =>
        prev.map((v) =>
          v.token === SELLER_VAR_TOKEN ? { ...v, example: names[0] } : v,
        ),
      );
    }
  };

  useEffect(() => { loadNumbers(); loadSellers(); }, []);

  // When the instance changes, reload its models + ladder.
  useEffect(() => { loadModels(); loadRows(); }, [numberId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the model changes, reload its ladder.
  useEffect(() => { loadRows(); }, [modelName]); // eslint-disable-line react-hooks/exhaustive-deps


  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setSampleB64(String(reader.result));
      setSampleType(file.type);
      setSampleName(file.name);
    };
    reader.readAsDataURL(file);
  };

  // Build the per-card buttons array for a step of N cards.
  const buildCards = (n: number): { buttons: BuiltButton[] }[] => {
    return Array.from({ length: n }, (_, ci) => ({
      buttons: buttonSlots.map((slot, si) => {
        const val = buttonMode === "shared"
          ? sharedValues[si]
          : (perCardValues[si]?.[ci] || { text: "" });
        const b: BuiltButton = { type: slot.type, text: (val.text || "").trim() };
        if (slot.type === "URL") {
          const built = buildComponentText(val.url || "", variables);
          b.url = built.text;
          if (built.examples.length) b.urlExample = built.examples[0];
        }
        if (slot.type === "PHONE_NUMBER") b.phone = (val.phone || "").trim();
        return b;
      }),
    }));
  };

  const validate = (n: number): string | null => {
    if (!numberId) return "Selecione um número Meta/WABA";
    if (!sampleB64) return "Suba uma imagem-exemplo primeiro";
    if (!topBody.trim()) return "O texto do corpo é obrigatório";
    if (!cardBody.trim()) return "A legenda do card é obrigatória";
    for (let si = 0; si < buttonSlots.length; si++) {
      const slot = buttonSlots[si];
      const vals = buttonMode === "shared" ? [sharedValues[si]] : perCardValues[si].slice(0, n);
      for (const v of vals) {
        if (!v.text?.trim()) return `Preencha o texto de todos os botões (Botão ${si + 1})`;
        if (slot.type === "URL" && !v.url?.trim()) return `Preencha a URL do Botão ${si + 1}`;
        if (slot.type === "PHONE_NUMBER" && !v.phone?.trim()) return `Preencha o telefone do Botão ${si + 1}`;
      }
    }
    return null;
  };

  const createRow = async (qtd: number) => {
    const err = validate(qtd);
    if (err) { toast.error(err); return; }
    setCreating(qtd);
    try {
      const top = buildComponentText(topBody, variables);
      const legend = buildComponentText(cardBody, variables);
      const { data, error } = await supabase.functions.invoke("carousel-ladder-create", {
        body: {
          whatsappNumberId: numberId,
          qtdCards: qtd,
          modelo: modelName,
          sampleImageBase64: sampleB64,
          sampleImageType: sampleType,
          topBody: top,
          cardBody: legend,
          cards: buildCards(qtd),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      toast.success(`Template "${modelName}" de ${qtd} cards enviado à Meta (${data?.meta_status || "PENDING"})`);
      await loadModels();
      await loadRows();
    } catch (e) {
      toast.error(`Erro ao criar template de ${qtd} cards: ${(e as Error).message}`);
    } finally {
      setCreating(null);
    }
  };

  const syncStatus = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId: numberId },
      });
      if (error) throw error;
      const templates: Array<{ name: string; status: string }> = data?.templates || data?.data || [];
      const byName = new Map(templates.map((t) => [t.name, t.status]));
      let updated = 0;
      for (const qtd of LADDER) {
        const row = rows[qtd];
        if (!row) continue;
        const metaStatus = byName.get(row.template_id);
        if (metaStatus && metaStatus !== row.meta_status) {
          await supabase
            .from("templates_carrossel")
            .update({ meta_status: metaStatus, aprovado: metaStatus === "APPROVED" })
            .eq("id", row.id);
          updated++;
        }
      }
      toast.success(updated ? `${updated} status atualizados` : "Status já sincronizados");
      await loadRows();
    } catch (e) {
      toast.error(`Erro ao sincronizar: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const approvedCount = LADDER.filter((q) => rows[q]?.aprovado).length;

  const renderButtonExtra = (
    slot: BtnSlot,
    val: BtnValue,
    onPatch: (patch: Partial<BtnValue>) => void,
  ) => {
    if (slot.type === "URL")
      return (
        <Input
          value={val.url || ""}
          onChange={(e) => onPatch({ url: e.target.value })}
          placeholder="https://... (pode usar {{tamanho}})"
          className="h-8"
        />
      );
    if (slot.type === "PHONE_NUMBER")
      return (
        <Input
          value={val.phone || ""}
          onChange={(e) => onPatch({ phone: e.target.value })}
          placeholder="+5511999999999"
          className="h-8"
        />
      );
    return null;
  };

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Images className="h-4 w-4" /> Escada de templates de carrossel
            </h3>
            <p className="text-sm text-muted-foreground">
              Crie 1 template aprovado para cada quantidade de cards (2 a 10). A vendedora nunca escolhe template — o sistema escolhe pela quantidade de fotos. {approvedCount}/9 aprovados.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={syncStatus} disabled={syncing} className="gap-1.5">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar status
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Número Meta/WABA (oficial)</Label>
            <Select value={numberId} onValueChange={setNumberId}>
              <SelectTrigger><SelectValue placeholder="Selecione o número" /></SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label || n.phone_display || n.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {numbers.length === 0 && (
              <p className="text-xs text-destructive">Nenhum número Meta/WABA oficial encontrado (precisa de business_account_id).</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Imagem-exemplo (usada na criação dos templates)</Label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {sampleName ? sampleName : "Subir imagem-exemplo"}
            </Button>
          </div>
        </div>

        {/* Modelo de template */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label className="text-sm font-semibold">Modelo de template</Label>
          <p className="text-[11px] text-muted-foreground">
            Crie modelos diferentes para situações diferentes (ex.: "Tamanho 34", "Lançamentos"). Cada modelo tem sua própria escada de 2 a 10 cards na instância selecionada.
          </p>
          <Input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder='Nome do modelo (ex.: Lançamentos)'
            className="h-9"
            disabled={!numberId}
          />
          {models.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {models.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={m === modelName ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setModelName(m)}
                >
                  {m}
                </Button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {!numberId ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Selecione uma instância Meta acima para ver e gerenciar os templates aprovados dessa instância.
        </Card>
      ) : (
        <>
        <Card className="p-4 space-y-4">

        <div className="rounded-md border border-dashed bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Rodízio de vendedoras:</span>{" "}
          ao usar a variável <code className="rounded bg-muted px-1">{`{{vendedora}}`}</code>, cada
          envio entra com o nome de uma vendedora diferente, em rodízio.{" "}
          {sellers.length
            ? `${sellers.length} vendedora(s) ativa(s): ${sellers.join(", ")}.`
            : "Nenhuma vendedora ativa encontrada no PDV."}
        </div>


        <VariableTextField
          label="Texto do corpo (mensagem acima dos cards)"
          value={topBody}
          onChange={setTopBody}
          variables={variables}
          onAddVariable={addVariable}
          multiline
          hint="Use os botões para inserir variáveis ou emojis. As variáveis são preenchidas no envio."
        />

        <VariableTextField
          label="Legenda do card (texto abaixo da foto)"
          value={cardBody}
          onChange={setCardBody}
          variables={variables}
          onAddVariable={addVariable}
          multiline
          hint="Mesma legenda para todos os cards. Pode conter variáveis e emojis."
        />

        {/* Buttons */}
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-sm font-semibold">Botões do card</Label>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={buttonMode === "shared" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setButtonMode("shared")}
              >
                Iguais em todos os cards
              </Button>
              <Button
                type="button"
                size="sm"
                variant={buttonMode === "perCard" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setButtonMode("perCard")}
              >
                Exclusivos por card
              </Button>
            </div>
          </div>

          {buttonSlots.map((slot, si) => (
            <div key={si} className="rounded-md border bg-muted/30 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Botão {si + 1}</span>
                <Select value={slot.type} onValueChange={(v) => setSlotType(si, v as ButtonType)}>
                  <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(BUTTON_TYPE_LABEL) as ButtonType[]).map((t) => (
                      <SelectItem key={t} value={t}>{BUTTON_TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {buttonSlots.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 ml-auto" onClick={() => removeSlot(si)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              {buttonMode === "shared" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={sharedValues[si]?.text || ""}
                    onChange={(e) => setShared(si, { text: e.target.value })}
                    placeholder="Texto do botão"
                    className="h-8"
                  />
                  {renderButtonExtra(slot, sharedValues[si] || { text: "" }, (p) => setShared(si, p))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    Preencha por card. Cada degrau usa as primeiras N linhas.
                  </p>
                  {Array.from({ length: MAX_CARDS }, (_, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-12 shrink-0">Card {ci + 1}</span>
                      <Input
                        value={perCardValues[si]?.[ci]?.text || ""}
                        onChange={(e) => setPerCard(si, ci, { text: e.target.value })}
                        placeholder="Texto do botão"
                        className="h-8"
                      />
                      {renderButtonExtra(slot, perCardValues[si]?.[ci] || { text: "" }, (p) => setPerCard(si, ci, p))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {buttonSlots.length < 2 && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5 h-8" onClick={addSlot}>
              <Plus className="h-3.5 w-3.5" /> Adicionar botão
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            A Meta permite até 2 botões por card, e todos os cards de um carrossel precisam ter os mesmos tipos de botão na mesma ordem.
          </p>
        </div>
      </Card>

      <div className="grid gap-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando escada...
          </div>
        ) : (
          LADDER.map((qtd) => {
            const row = rows[qtd];
            return (
              <Card key={qtd} className="p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center font-semibold text-sm">
                    {qtd}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{qtd} cards</p>
                    <p className="text-xs text-muted-foreground">
                      {row?.template_id || `carrossel_escada_${qtd}cards`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(row)}
                  <Button
                    size="sm"
                    variant={row ? "outline" : "default"}
                    disabled={creating === qtd}
                    onClick={() => createRow(qtd)}
                    className="gap-1.5"
                  >
                    {creating === qtd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {row ? "Recriar" : "Criar template"}
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
        </>
      )}
    </div>
  );
}
