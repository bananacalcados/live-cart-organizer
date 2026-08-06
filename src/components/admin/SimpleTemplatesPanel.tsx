import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, RefreshCw, Upload, CheckCircle2, Clock, XCircle, Plus, Trash2, MessageSquare, Image as ImageIcon,
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
} from "@/lib/pos/carouselTemplate";

interface MetaNumber {
  id: string;
  label: string | null;
  phone_display: string | null;
  business_account_id: string | null;
  provider: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: any[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface BtnValue { type: ButtonType; text: string; url?: string; phone?: string }

function statusBadge(status: string) {
  if (status === "APPROVED")
    return <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" /> Aprovado</Badge>;
  if (status === "REJECTED")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rejeitado</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> {status || "Pendente"}</Badge>;
}

export interface SimpleTemplatesPanelProps {
  /** Prefixo opcional aplicado ao nome enviado para a Meta. */
  namePrefix?: string;
}

/**
 * Criação de templates Meta SIMPLES (somente texto | imagem + texto),
 * com as mesmas variáveis nomeadas usadas no editor de carrossel.
 * Não toca em nada do fluxo de carrossel — apenas cria via
 * `meta-whatsapp-create-template` e lista via `meta-whatsapp-get-templates`.
 */
export function SimpleTemplatesPanel({ namePrefix = "" }: SimpleTemplatesPanelProps = {}) {
  const [numbers, setNumbers] = useState<MetaNumber[]>([]);
  const [numberId, setNumberId] = useState("");
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [kind, setKind] = useState<"text" | "image">("text");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("Oiee {{nome}}, chegou novidade na loja 👟");
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<BtnValue[]>([]);

  const [mediaHandle, setMediaHandle] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [variables, setVariables] = useState<VarDef[]>([...STANDARD_VARS]);
  const addVariable = (v: VarDef) =>
    setVariables((prev) => (prev.some((x) => x.token === v.token) ? prev : [...prev, v]));

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

  const loadSellers = async () => {
    const { data } = await supabase.from("pos_sellers").select("name").eq("is_active", true);
    const names = Array.from(
      new Set(
        (data || [])
          .map((s: { name: string | null }) => (s.name || "").trim())
          .filter((n) => n && !isVirtualSeller(n)),
      ),
    );
    if (names.length) {
      setVariables((prev) =>
        prev.map((v) => (v.token === SELLER_VAR_TOKEN ? { ...v, example: names[0] } : v)),
      );
    }
  };

  const loadTemplates = async () => {
    if (!numberId) { setTemplates([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-get-templates?whatsappNumberId=${numberId}`,
        {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
        },
      );
      const result = await res.json();
      if (result.success) {
        const list: MetaTemplate[] = (result.templates || []).filter(
          (t: MetaTemplate) =>
            !(t.components || []).some((c) => String(c?.type).toUpperCase() === "CAROUSEL"),
        );
        setTemplates(list);
      } else {
        toast.error("Erro ao buscar templates");
      }
    } catch {
      toast.error("Erro ao buscar templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadNumbers(); loadSellers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTemplates(); }, [numberId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem (JPG ou PNG)"); return; }
    setUploading(true);
    setMediaName(file.name);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-upload-header`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            whatsappNumberId: numberId,
            fileName: file.name,
            fileType: file.type,
            fileBase64: base64,
          }),
        },
      );
      const result = await res.json();
      if (result.success && result.handle) {
        setMediaHandle(result.handle);
        toast.success("Imagem enviada");
      } else {
        setMediaHandle("");
        setMediaName("");
        toast.error(result.details?.error?.message || result.error || "Erro ao enviar imagem");
      }
    } catch {
      setMediaHandle("");
      setMediaName("");
      toast.error("Erro ao enviar imagem");
    } finally {
      setUploading(false);
    }
  };

  const addButton = () => {
    if (buttons.length >= 2) return;
    setButtons((p) => [...p, { type: "QUICK_REPLY", text: "" }]);
  };
  const setBtn = (i: number, patch: Partial<BtnValue>) =>
    setButtons((p) => p.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const removeBtn = (i: number) => setButtons((p) => p.filter((_, idx) => idx !== i));

  const validate = (): string | null => {
    if (!numberId) return "Selecione um número Meta/WABA";
    const finalName = `${namePrefix}${name}`.trim();
    if (!finalName) return "Preencha o nome do template";
    if (!/^[a-z][a-z0-9_]*$/.test(finalName))
      return "O nome deve ter apenas letras minúsculas, números e underscore, começando com letra";
    if (!bodyText.trim()) return "Preencha o corpo da mensagem";
    const positional = buildComponentText(bodyText.trim(), variables).text.trim();
    // A Meta rejeita variável colada no início/fim, mesmo com espaços, quebras
    // de linha ou pontuação isolada em volta.
    if (/^[\s\p{P}\p{S}]*\{\{\d+\}\}/u.test(positional) || /\{\{\d+\}\}[\s\p{P}\p{S}]*$/u.test(positional))
      return "A Meta não permite variável no início ou no fim do corpo. Escreva texto antes e depois da variável.";
    if (kind === "image" && !mediaHandle) return "Envie a imagem de exemplo do cabeçalho";
    if (kind === "text" && headerText.trim()) {
      const h = buildComponentText(headerText.trim(), variables);
      if (h.examples.length > 1) return "O cabeçalho de texto aceita no máximo 1 variável";
      const ht = h.text.trim();
      if (/^\{\{\d+\}\}/.test(ht) || /\{\{\d+\}\}$/.test(ht))
        return "A Meta não permite variável no início ou no fim do cabeçalho. Escreva texto antes e depois.";
    }

    for (const b of buttons) {
      if (!b.text.trim()) return "Preencha o texto de todos os botões";
      if (b.type === "URL" && !(b.url || "").trim()) return "Preencha a URL dos botões de link";
      if (b.type === "PHONE_NUMBER" && !(b.phone || "").trim()) return "Preencha o telefone dos botões de ligação";
    }
    return null;
  };

  const resetForm = () => {
    setName("");
    setHeaderText("");
    setBodyText("");
    setFooterText("");
    setButtons([]);
    setMediaHandle("");
    setMediaName("");
  };

  const handleCreate = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setCreating(true);
    try {
      const components: Record<string, unknown>[] = [];

      if (kind === "image") {
        components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [mediaHandle] } });
      } else if (headerText.trim()) {
        const h = buildComponentText(headerText.trim(), variables);
        const header: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: h.text };
        if (h.examples.length) header.example = { header_text: h.examples };
        components.push(header);
      }

      const body = buildComponentText(bodyText.trim(), variables);
      const bodyComp: Record<string, unknown> = { type: "BODY", text: body.text };
      if (body.examples.length) bodyComp.example = { body_text: [body.examples] };
      components.push(bodyComp);

      if (footerText.trim()) components.push({ type: "FOOTER", text: footerText.trim() });

      if (buttons.length) {
        components.push({
          type: "BUTTONS",
          buttons: buttons.map((b) => {
            if (b.type === "URL") return { type: "URL", text: b.text.trim(), url: (b.url || "").trim() };
            if (b.type === "PHONE_NUMBER")
              return { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: (b.phone || "").trim() };
            return { type: "QUICK_REPLY", text: b.text.trim() };
          }),
        });
      }

      const { data, error } = await supabase.functions.invoke("meta-whatsapp-create-template", {
        body: {
          whatsappNumberId: numberId,
          name: `${namePrefix}${name}`.trim(),
          category,
          language: "pt_BR",
          components,
        },
      });
      if (error) throw error;
      if (data?.error) {
        const detail = data?.details?.error?.error_user_msg || data?.details?.error?.message;
        toast.error(detail || "Erro ao criar template");
        return;
      }
      toast.success("Template enviado para aprovação da Meta");
      resetForm();
      loadTemplates();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar template");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Número Meta (WABA)</Label>
            <Select value={numberId} onValueChange={setNumberId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label || n.phone_display || n.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de template</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "text" | "image")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Somente texto</SelectItem>
                <SelectItem value="image">Imagem + texto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="UTILITY">Utilidade</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Nome do template</Label>
          <div className="flex items-center gap-2">
            {namePrefix && <span className="text-sm text-muted-foreground">{namePrefix}</span>}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="ex.: novidades_semana"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Só letras minúsculas, números e underscore.
          </p>
        </div>

        {kind === "image" ? (
          <div className="space-y-1.5">
            <Label>Imagem de exemplo (usada na aprovação)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={onPickFile}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!numberId || uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="ml-2">Subir imagem</span>
              </Button>
              {mediaName && (
                <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                  {mediaName} {mediaHandle ? "✓" : ""}
                </span>
              )}
            </div>
          </div>
        ) : (
          <VariableTextField
            label="Cabeçalho (opcional)"
            value={headerText}
            onChange={setHeaderText}
            variables={variables}
            onAddVariable={addVariable}
            placeholder="ex.: Novidades da semana"
            hint="Título curto acima da mensagem. Máx. 1 variável."
          />
        )}

        <VariableTextField
          label="Corpo da mensagem"
          value={bodyText}
          onChange={setBodyText}
          variables={variables}
          onAddVariable={addVariable}
          multiline
          placeholder="Escreva a mensagem e clique nas variáveis acima para inserir"
          hint="A Meta não aceita variável no começo nem no fim do texto."
        />

        <div className="space-y-1.5">
          <Label>Rodapé (opcional)</Label>
          <Textarea
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            rows={2}
            placeholder="ex.: Banana Calçados"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Botões (opcional, até 2)</Label>
            <Button type="button" variant="outline" size="sm" onClick={addButton} disabled={buttons.length >= 2}>
              <Plus className="h-3 w-3 mr-1" /> Adicionar botão
            </Button>
          </div>
          {buttons.map((b, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[160px_1fr_1fr_auto] items-end rounded-md border p-2">
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select value={b.type} onValueChange={(v) => setBtn(i, { type: v as ButtonType })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(BUTTON_TYPE_LABEL) as ButtonType[]).map((t) => (
                      <SelectItem key={t} value={t}>{BUTTON_TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Texto do botão</Label>
                <Input className="h-9" value={b.text} onChange={(e) => setBtn(i, { text: e.target.value })} />
              </div>
              <div className="space-y-1">
                {b.type === "URL" && (
                  <>
                    <Label className="text-xs">URL</Label>
                    <Input className="h-9" value={b.url || ""} onChange={(e) => setBtn(i, { url: e.target.value })} placeholder="https://..." />
                  </>
                )}
                {b.type === "PHONE_NUMBER" && (
                  <>
                    <Label className="text-xs">Telefone</Label>
                    <Input className="h-9" value={b.phone || ""} onChange={(e) => setBtn(i, { phone: e.target.value })} placeholder="+5533..." />
                  </>
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeBtn(i)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={creating || uploading}>
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : (kind === "image" ? <ImageIcon className="h-4 w-4 mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />)}
            Enviar para aprovação
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Templates simples nesta instância</h3>
          <Button variant="outline" size="sm" onClick={loadTemplates} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>
        {templates.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">Nenhum template encontrado.</p>
        )}
        <div className="space-y-2">
          {templates.map((t) => {
            const body = (t.components || []).find((c) => String(c?.type).toUpperCase() === "BODY");
            const header = (t.components || []).find((c) => String(c?.type).toUpperCase() === "HEADER");
            return (
              <div key={t.id} className="rounded-md border p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{t.name}</span>
                  {statusBadge(t.status)}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {header ? (header.format === "TEXT" ? "Texto + cabeçalho" : `Mídia: ${header.format}`) : "Somente texto"}
                  </Badge>
                </div>
                {body?.text && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{body.text}</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
