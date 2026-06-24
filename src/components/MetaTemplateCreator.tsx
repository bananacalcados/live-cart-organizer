import { useState, useEffect, useRef } from "react";
import { Plus, Loader2, Send, CheckCircle, Clock, XCircle, AlertCircle, RefreshCw, Variable, Trash2, Upload, Image as ImageIcon, Video, FileText, X, LayoutGrid } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejected_reason?: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
    // Carousel support
    cards?: Array<{
      components: Array<{
        type: string;
        text?: string;
        format?: string;
        example?: { header_handle?: string[]; body_text?: string[][] };
        buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
      }>;
    }>;
  }>;
}

type TemplateButton = {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone_number?: string;
  urlExample?: string;
};

// Per-card button content (label/url/phone). Index-aligned with the button STRUCTURE.
type CardButtonContent = { text?: string; url?: string; phone_number?: string; urlExample?: string };

type CarouselCard = {
  bodyText: string;
  examples: Record<number, string>;
  mediaHandle: string;
  mediaName: string;
  isUploading: boolean;
  // Per-card button content (used only when cardButtonMode === "per_card")
  buttons?: CardButtonContent[];
};

const MIN_CARDS = 2;
const MAX_CARDS = 6;
const CARD_BODY_MAX = 160;

// Extracts distinct {{n}} variable numbers from a text, sorted ascending.
function extractVarNumbers(text?: string): number[] {
  if (!text) return [];
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, ""), 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function isContiguousFromOne(nums: number[]): boolean {
  return nums.every((n, i) => n === i + 1);
}

function emptyCard(): CarouselCard {
  return { bodyText: "", examples: {}, mediaHandle: "", mediaName: "", isUploading: false, buttons: [] };
}

// Media header config: accept types and Meta format strings.
const MEDIA_HEADER = {
  image: { format: "IMAGE", accept: "image/jpeg,image/png", label: "Imagem", icon: ImageIcon },
  video: { format: "VIDEO", accept: "video/mp4", label: "Vídeo", icon: Video },
  document: { format: "DOCUMENT", accept: "application/pdf", label: "Documento (PDF)", icon: FileText },
} as const;

export function MetaTemplateCreator() {
  const { numbers, selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<string>("");

  // Form state
  const [templateType, setTemplateType] = useState<"standard" | "carousel">("standard");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("MARKETING");
  const [language, setLanguage] = useState("pt_BR");
  const [headerType, setHeaderType] = useState<string>("none");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  // Example values keyed by variable number, separate for body and header
  const [bodyExamples, setBodyExamples] = useState<Record<number, string>>({});
  const [headerExamples, setHeaderExamples] = useState<Record<number, string>>({});
  // Media header
  const [headerMediaHandle, setHeaderMediaHandle] = useState<string>("");
  const [headerMediaName, setHeaderMediaName] = useState<string>("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  // Buttons (also used as the SHARED buttons for every carousel card)
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  // Carousel cards
  const [cards, setCards] = useState<CarouselCard[]>([emptyCard(), emptyCard()]);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardBodyRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const cardFileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const isCarousel = templateType === "carousel";
  const bodyVars = extractVarNumbers(bodyText);
  const headerVars = headerType === "text" ? extractVarNumbers(headerText) : [];
  const isMediaHeader = headerType in MEDIA_HEADER;

  useEffect(() => {
    if (numbers.length === 0) fetchNumbers();
  }, [numbers.length, fetchNumbers]);

  useEffect(() => {
    if (selectedNumberId && !selectedNumber) {
      setSelectedNumber(selectedNumberId);
    }
  }, [selectedNumberId, selectedNumber]);

  useEffect(() => {
    if (selectedNumber) fetchTemplates();
  }, [selectedNumber]);

  const fetchTemplates = async () => {
    if (!selectedNumber) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-get-templates?whatsappNumberId=${selectedNumber}`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
        }
      );
      const result = await res.json();
      if (result.success) {
        setTemplates(result.templates || []);
      } else {
        toast.error("Erro ao buscar templates");
      }
    } catch (err) {
      console.error("Error fetching templates:", err);
      toast.error("Erro ao buscar templates");
    } finally {
      setIsLoading(false);
    }
  };

  // Insert text at the body textarea cursor position.
  const insertIntoBody = (snippet: string) => {
    const el = bodyRef.current;
    if (!el) {
      setBodyText((prev) => prev + snippet);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    const next = bodyText.slice(0, start) + snippet + bodyText.slice(end);
    setBodyText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Adds the next sequential variable {{N+1}} (variables must be contiguous).
  const handleAddVariable = () => {
    const next = bodyVars.length + 1;
    insertIntoBody(`{{${next}}}`);
  };

  // ── Carousel card helpers ──
  const updateCard = (index: number, patch: Partial<CarouselCard>) => {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addCard = () => {
    if (cards.length >= MAX_CARDS) {
      toast.error(`Máximo de ${MAX_CARDS} cards por carrossel`);
      return;
    }
    setCards((prev) => [...prev, emptyCard()]);
  };

  const removeCard = (index: number) => {
    if (cards.length <= MIN_CARDS) {
      toast.error(`Mínimo de ${MIN_CARDS} cards por carrossel`);
      return;
    }
    setCards((prev) => prev.filter((_, i) => i !== index));
  };

  const insertIntoCardBody = (index: number, snippet: string) => {
    const el = cardBodyRefs.current[index];
    const current = cards[index]?.bodyText || "";
    if (!el) {
      updateCard(index, { bodyText: current + snippet });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    updateCard(index, { bodyText: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleAddCardVariable = (index: number) => {
    const count = extractVarNumbers(cards[index]?.bodyText).length;
    insertIntoCardBody(index, `{{${count + 1}}}`);
  };

  // Generic media upload → returns Meta header handle.
  const uploadHeaderMedia = async (file: File): Promise<string | null> => {
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
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          whatsappNumberId: selectedNumber,
          fileName: file.name,
          fileType: file.type,
          fileBase64: base64,
        }),
      }
    );
    const result = await res.json();
    if (result.success && result.handle) return result.handle as string;
    const msg = result.details?.error?.message || result.error || "Erro ao enviar arquivo";
    toast.error(msg);
    return null;
  };

  const handleCardFileSelect = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    updateCard(index, { isUploading: true, mediaHandle: "", mediaName: file.name });
    try {
      const handle = await uploadHeaderMedia(file);
      if (handle) {
        updateCard(index, { mediaHandle: handle, mediaName: file.name, isUploading: false });
        toast.success(`Imagem do card ${index + 1} enviada`);
      } else {
        updateCard(index, { isUploading: false, mediaName: "" });
      }
    } catch (err) {
      console.error("Error uploading card media:", err);
      updateCard(index, { isUploading: false, mediaName: "" });
      toast.error("Erro ao enviar arquivo");
    }
  };

  const handleHeaderTypeChange = (value: string) => {
    setHeaderType(value);
    // Clear media when switching away
    if (!(value in MEDIA_HEADER)) {
      setHeaderMediaHandle("");
      setHeaderMediaName("");
    }
    if (value !== "text") {
      setHeaderText("");
      setHeaderExamples({});
    }
  };

  const handleTemplateTypeChange = (value: "standard" | "carousel") => {
    setTemplateType(value);
    if (value === "carousel") {
      // Carousel must be MARKETING; clear header/footer (not allowed in carousel).
      setCategory("MARKETING");
      setHeaderType("none");
      setHeaderText("");
      setHeaderExamples({});
      setHeaderMediaHandle("");
      setHeaderMediaName("");
      setFooterText("");
      if (cards.length < MIN_CARDS) setCards([emptyCard(), emptyCard()]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected later
    e.target.value = "";

    setIsUploadingMedia(true);
    setHeaderMediaHandle("");
    setHeaderMediaName(file.name);
    try {
      const handle = await uploadHeaderMedia(file);
      if (handle) {
        setHeaderMediaHandle(handle);
        toast.success("Arquivo enviado com sucesso");
      } else {
        setHeaderMediaName("");
      }
    } catch (err) {
      console.error("Error uploading media:", err);
      setHeaderMediaName("");
      toast.error("Erro ao enviar arquivo");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const addButton = (type: TemplateButton["type"]) => {
    const limit = isCarousel ? 2 : 10;
    if (buttons.length >= limit) {
      toast.error(isCarousel ? "Máximo de 2 botões por card de carrossel" : "Máximo de 10 botões por template");
      return;
    }
    const base: TemplateButton = { type, text: "" };
    if (type === "URL") base.url = "";
    if (type === "PHONE_NUMBER") base.phone_number = "";
    setButtons((prev) => [...prev, base]);
  };

  const updateButton = (index: number, patch: Partial<TemplateButton>) => {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const removeButton = (index: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  };

  // Builds the shared buttons array for a carousel card (with URL example when needed).
  const buildCardButtons = () =>
    buttons.map((b) => {
      if (b.type === "URL") {
        const btn: Record<string, unknown> = { type: "URL", text: b.text, url: b.url };
        if ((b.url || "").includes("{{")) btn.example = [(b.urlExample || "").trim()];
        return btn;
      }
      if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number };
      return { type: "QUICK_REPLY", text: b.text };
    });

  const validateSharedButtons = (): boolean => {
    for (const b of buttons) {
      if (!b.text.trim()) {
        toast.error("Preencha o texto de todos os botões.");
        return false;
      }
      if (b.type === "URL") {
        if (!(b.url || "").trim()) {
          toast.error("Preencha a URL dos botões de link.");
          return false;
        }
        if ((b.url || "").includes("{{") && !(b.urlExample || "").trim()) {
          toast.error("Preencha o exemplo do sufixo da URL (a Meta exige).");
          return false;
        }
      }
      if (b.type === "PHONE_NUMBER" && !(b.phone_number || "").trim()) {
        toast.error("Preencha o telefone dos botões de ligação.");
        return false;
      }
    }
    return true;
  };

  const handleCreateCarousel = async () => {
    if (cards.length < MIN_CARDS || cards.length > MAX_CARDS) {
      toast.error(`O carrossel precisa de ${MIN_CARDS} a ${MAX_CARDS} cards`);
      return;
    }
    if (buttons.length === 0) {
      toast.error("Carrossel exige pelo menos 1 botão (aplicado a todos os cards).");
      return;
    }
    if (buttons.length > 2) {
      toast.error("Cards de carrossel aceitam no máximo 2 botões.");
      return;
    }
    if (!validateSharedButtons()) return;

    // Validate each card
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card.mediaHandle) {
        toast.error(`Envie a imagem de exemplo do card ${i + 1}.`);
        return;
      }
      if (!card.bodyText.trim()) {
        toast.error(`Preencha o texto do card ${i + 1}.`);
        return;
      }
      if (card.bodyText.length > CARD_BODY_MAX) {
        toast.error(`O texto do card ${i + 1} excede ${CARD_BODY_MAX} caracteres.`);
        return;
      }
      const cardVars = extractVarNumbers(card.bodyText);
      if (cardVars.length > 0) {
        if (!isContiguousFromOne(cardVars)) {
          toast.error(`As variáveis do card ${i + 1} devem ser sequenciais a partir de {{1}}.`);
          return;
        }
        if (cardVars.some((n) => !(card.examples[n] || "").trim())) {
          toast.error(`Preencha o exemplo de cada variável do card ${i + 1}.`);
          return;
        }
      }
    }

    setIsCreating(true);
    try {
      const cardButtons = buildCardButtons();
      const components: Array<Record<string, unknown>> = [];

      // Bubble text (BODY above the cards)
      const bubble: Record<string, unknown> = { type: "BODY", text: bodyText };
      if (bodyVars.length > 0) {
        bubble.example = { body_text: [bodyVars.map((n) => (bodyExamples[n] || "").trim())] };
      }
      components.push(bubble);

      // CAROUSEL component
      components.push({
        type: "CAROUSEL",
        cards: cards.map((card) => {
          const cardVars = extractVarNumbers(card.bodyText);
          const cardComps: Array<Record<string, unknown>> = [
            { type: "HEADER", format: "IMAGE", example: { header_handle: [card.mediaHandle] } },
          ];
          const cardBody: Record<string, unknown> = { type: "BODY", text: card.bodyText };
          if (cardVars.length > 0) {
            cardBody.example = { body_text: [cardVars.map((n) => (card.examples[n] || "").trim())] };
          }
          cardComps.push(cardBody);
          cardComps.push({ type: "BUTTONS", buttons: cardButtons });
          return { components: cardComps };
        }),
      });

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-create-template`,
        {
          method: "POST",
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ whatsappNumberId: selectedNumber, name, category: "MARKETING", language, components }),
        }
      );
      const result = await res.json();
      if (result.success) {
        toast.success("Carrossel enviado para aprovação da Meta!");
        resetForm();
        setDialogOpen(false);
        fetchTemplates();
      } else {
        const errorMsg = result.details?.error?.message || "Erro ao criar carrossel";
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error("Error creating carousel:", err);
      toast.error("Erro ao criar carrossel");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Preencha o nome do template");
      return;
    }
    // Validate name format
    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(name)) {
      toast.error("O nome deve conter apenas letras minúsculas, números e underscore, começando com letra");
      return;
    }
    if (!bodyText.trim()) {
      toast.error(isCarousel ? "Preencha o texto de bolha (acima dos cards)" : "Preencha o corpo da mensagem");
      return;
    }

    // Bubble/body: Meta doesn't allow variables at start or end of body
    const trimmedBody = bodyText.trim();
    if (/^\{\{\d+\}\}/.test(trimmedBody) || /\{\{\d+\}\}$/.test(trimmedBody)) {
      toast.error("A Meta não permite variáveis no início ou no final do corpo da mensagem. Adicione texto antes/depois da variável.");
      return;
    }
    if (bodyVars.length > 0 && !isContiguousFromOne(bodyVars)) {
      toast.error(`As variáveis do corpo devem ser sequenciais a partir de {{1}} (sem pular números). Detectado: ${bodyVars.map((n) => `{{${n}}}`).join(", ")}`);
      return;
    }
    const missingBody = bodyVars.some((n) => !(bodyExamples[n] || "").trim());
    if (missingBody) {
      toast.error("Preencha o valor de exemplo de cada variável — a Meta exige isso");
      return;
    }

    if (isCarousel) {
      await handleCreateCarousel();
      return;
    }

    // Validate: header text accepts at most 1 variable
    if (headerVars.length > 1) {
      toast.error("O cabeçalho de texto aceita no máximo 1 variável.");
      return;
    }
    const missingHeader = headerVars.some((n) => !(headerExamples[n] || "").trim());
    if (missingHeader) {
      toast.error("Preencha o valor de exemplo de cada variável — a Meta exige isso");
      return;
    }
    // Validate media header
    if (isMediaHeader && !headerMediaHandle) {
      toast.error("Envie o arquivo do cabeçalho antes de continuar.");
      return;
    }
    // Validate buttons
    for (const b of buttons) {
      if (!b.text.trim()) {
        toast.error("Preencha o texto de todos os botões.");
        return;
      }
      if (b.type === "URL" && !(b.url || "").trim()) {
        toast.error("Preencha a URL dos botões de link.");
        return;
      }
      if (b.type === "PHONE_NUMBER" && !(b.phone_number || "").trim()) {
        toast.error("Preencha o telefone dos botões de ligação.");
        return;
      }
    }

    setIsCreating(true);
    try {
      const components: Array<Record<string, unknown>> = [];

      // HEADER
      if (headerType === "text" && headerText.trim()) {
        const headerComponent: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: headerText };
        if (headerVars.length > 0) {
          headerComponent.example = {
            header_text: headerVars.map((n) => (headerExamples[n] || "").trim()),
          };
        }
        components.push(headerComponent);
      } else if (isMediaHeader && headerMediaHandle) {
        components.push({
          type: "HEADER",
          format: MEDIA_HEADER[headerType as keyof typeof MEDIA_HEADER].format,
          example: { header_handle: [headerMediaHandle] },
        });
      }

      // BODY
      const bodyComponent: Record<string, unknown> = { type: "BODY", text: bodyText };
      if (bodyVars.length > 0) {
        bodyComponent.example = {
          body_text: [bodyVars.map((n) => (bodyExamples[n] || "").trim())],
        };
      }
      components.push(bodyComponent);

      // FOOTER
      if (footerText.trim()) {
        components.push({ type: "FOOTER", text: footerText });
      }

      // BUTTONS
      if (buttons.length > 0) {
        components.push({
          type: "BUTTONS",
          buttons: buttons.map((b) => {
            if (b.type === "URL") return { type: "URL", text: b.text, url: b.url };
            if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number };
            return { type: "QUICK_REPLY", text: b.text };
          }),
        });
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-create-template`,
        {
          method: "POST",
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            whatsappNumberId: selectedNumber,
            name,
            category,
            language,
            components,
          }),
        }
      );

      const result = await res.json();

      if (result.success) {
        toast.success("Template enviado para aprovação da Meta!");
        resetForm();
        setDialogOpen(false);
        fetchTemplates();
      } else {
        const errorMsg = result.details?.error?.message || "Erro ao criar template";
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error("Error creating template:", err);
      toast.error("Erro ao criar template");
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setTemplateType("standard");
    setName("");
    setCategory("MARKETING");
    setLanguage("pt_BR");
    setHeaderType("none");
    setHeaderText("");
    setBodyText("");
    setFooterText("");
    setBodyExamples({});
    setHeaderExamples({});
    setHeaderMediaHandle("");
    setHeaderMediaName("");
    setButtons([]);
    setCards([emptyCard(), emptyCard()]);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return <Badge className="bg-stage-paid/20 text-stage-paid border-stage-paid/30 gap-1"><CheckCircle className="h-3 w-3" />Aprovado</Badge>;
      case "PENDING":
        return <Badge className="bg-stage-awaiting/20 text-stage-awaiting border-stage-awaiting/30 gap-1"><Clock className="h-3 w-3" />Pendente</Badge>;
      case "REJECTED":
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1"><XCircle className="h-3 w-3" />Rejeitado</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" />{status}</Badge>;
    }
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case "MARKETING": return "Marketing";
      case "UTILITY": return "Utilidade";
      case "AUTHENTICATION": return "Autenticação";
      default: return cat;
    }
  };

  const getBodyFromComponents = (components: MetaTemplate["components"]) => {
    const body = components.find(c => c.type === "BODY");
    return body?.text || "";
  };

  const getCarouselComponent = (components: MetaTemplate["components"]) =>
    components.find(c => (c.type || "").toUpperCase() === "CAROUSEL");

  // Renders the carousel cards preview for an existing approved/pending template.
  const renderCarouselPreview = (carousel: NonNullable<MetaTemplate["components"][number]["cards"]>) => (
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {carousel.map((card, idx) => {
        const cardBody = card.components.find(c => (c.type || "").toUpperCase() === "BODY");
        const cardBtns = card.components.find(c => (c.type || "").toUpperCase() === "BUTTONS")?.buttons || [];
        return (
          <div key={idx} className="w-40 shrink-0 rounded-md border bg-background overflow-hidden">
            <div className="h-20 bg-muted flex items-center justify-center text-muted-foreground">
              <ImageIcon className="h-6 w-6" />
            </div>
            <div className="p-2">
              <p className="text-[11px] whitespace-pre-wrap line-clamp-3">{cardBody?.text || ""}</p>
              {cardBtns.length > 0 && (
                <div className="mt-1 space-y-0.5 border-t pt-1">
                  {cardBtns.map((b: any, bi: number) => (
                    <p key={bi} className="text-[10px] text-center text-primary font-medium truncate">{b.text}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">Templates da API Meta</h3>
          {numbers.length > 1 && (
            <Select value={selectedNumber} onValueChange={setSelectedNumber}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="Selecionar número" />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((num) => (
                  <SelectItem key={num.id} value={num.id}>
                    {num.label} - {num.phone_display}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={fetchTemplates} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" className="gap-1" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Criar Template
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Nenhum template encontrado
        </div>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-4">
            {templates.map((template) => {
              const carousel = getCarouselComponent(template.components);
              return (
                <div
                  key={template.id}
                  className="p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm font-mono">{template.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {getStatusBadge(template.status)}
                        <Badge variant="outline" className="text-[10px]">
                          {getCategoryLabel(template.category)}
                        </Badge>
                        {carousel && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <LayoutGrid className="h-3 w-3" />Carrossel
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">{template.language}</span>
                        {template.status === "REJECTED" && template.rejected_reason && (
                          <span className="text-[10px] text-destructive font-medium">
                            — {template.rejected_reason}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2 whitespace-pre-wrap">
                    {getBodyFromComponents(template.components)}
                  </p>
                  {carousel?.cards && renderCarouselPreview(carousel.cards)}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Create Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Criar Template Meta
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Template type */}
            <div className="space-y-2">
              <Label>Tipo de Template</Label>
              <Select value={templateType} onValueChange={(v) => handleTemplateTypeChange(v as "standard" | "carousel")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Padrão (texto/mídia)</SelectItem>
                  <SelectItem value="carousel">Carrossel (cards com imagem)</SelectItem>
                </SelectContent>
              </Select>
              {isCarousel && (
                <p className="text-[10px] text-muted-foreground">
                  Carrossel é sempre categoria Marketing. As imagens enviadas aqui servem só para aprovação — no disparo você troca por imagens da semana.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Nome do Template</Label>
                <Input
                  placeholder="ex: promo_semanal"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Apenas letras minúsculas, números e _</p>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory} disabled={isCarousel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Idioma</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Português (BR)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isCarousel && (
                <div className="space-y-2">
                  <Label>Cabeçalho</Label>
                  <Select value={headerType} onValueChange={handleHeaderTypeChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem cabeçalho</SelectItem>
                      <SelectItem value="text">Texto</SelectItem>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="document">Documento (PDF)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!isCarousel && headerType === "text" && (
              <div className="space-y-2">
                <Label>Texto do Cabeçalho</Label>
                <Input
                  placeholder="Ex: Olá, {{1}}!"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Use {"{{1}}"} para variável (máximo 1 no cabeçalho)
                </p>
                {headerVars.length > 0 && (
                  <div className="space-y-2 rounded-md border border-dashed p-2 mt-1">
                    <p className="text-[10px] font-medium text-muted-foreground">
                      Exemplos para o cabeçalho (a Meta exige):
                    </p>
                    {headerVars.map((n) => (
                      <div key={`h-${n}`} className="flex items-center gap-2">
                        <span className="text-xs font-mono w-12 shrink-0">{`{{${n}}}`}</span>
                        <Input
                          className="h-8 text-xs"
                          placeholder={`Exemplo para {{${n}}}`}
                          value={headerExamples[n] || ""}
                          onChange={(e) =>
                            setHeaderExamples((prev) => ({ ...prev, [n]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!isCarousel && isMediaHeader && (
              <div className="space-y-2">
                <Label>{MEDIA_HEADER[headerType as keyof typeof MEDIA_HEADER].label} do Cabeçalho</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={MEDIA_HEADER[headerType as keyof typeof MEDIA_HEADER].accept}
                  onChange={handleFileSelect}
                />
                {!headerMediaHandle ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingMedia}
                  >
                    {isUploadingMedia ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {isUploadingMedia ? "Enviando..." : "Selecionar arquivo"}
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle className="h-4 w-4 text-stage-paid shrink-0" />
                      <span className="text-xs truncate">{headerMediaName}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => {
                        setHeaderMediaHandle("");
                        setHeaderMediaName("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Este arquivo é o exemplo enviado para aprovação. No envio real você define a mídia por destinatário.
                </p>
              </div>
            )}

            {/* Body / bubble text */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{isCarousel ? "Texto de bolha (acima dos cards) *" : "Corpo da Mensagem *"}</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={handleAddVariable}
                  >
                    <Variable className="h-3.5 w-3.5" />
                    Variável
                  </Button>
                  <EmojiPickerButton
                    className="h-7 w-7"
                    onEmojiSelect={(emoji) => insertIntoBody(emoji)}
                  />
                </div>
              </div>
              <Textarea
                ref={bodyRef}
                placeholder={isCarousel ? "Ex: Confira as novidades da semana! 🛍️" : "Ex: Olá {{1}}, seu pedido {{2}} está confirmado!"}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={isCarousel ? 3 : 5}
                maxLength={1024}
              />
              <p className="text-[10px] text-muted-foreground text-right">{bodyText.length}/1024</p>
              {bodyVars.length > 0 && (
                <div className="space-y-2 rounded-md border border-dashed p-2 mt-1">
                  <p className="text-[10px] font-medium text-muted-foreground">
                    Exemplos para o corpo (a Meta exige um valor por variável):
                  </p>
                  {bodyVars.map((n) => (
                    <div key={`b-${n}`} className="flex items-center gap-2">
                      <span className="text-xs font-mono w-12 shrink-0">{`{{${n}}}`}</span>
                      <Input
                        className="h-8 text-xs"
                        placeholder={`Exemplo para {{${n}}}`}
                        value={bodyExamples[n] || ""}
                        onChange={(e) =>
                          setBodyExamples((prev) => ({ ...prev, [n]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Carousel cards */}
            {isCarousel && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Cards do Carrossel ({cards.length}/{MAX_CARDS})</Label>
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addCard} disabled={cards.length >= MAX_CARDS}>
                    <Plus className="h-3.5 w-3.5" />Card
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Todos os cards usam os MESMOS botões (configurados abaixo). Mínimo {MIN_CARDS}, máximo {MAX_CARDS} cards.
                </p>
                {cards.map((card, idx) => {
                  const cardVars = extractVarNumbers(card.bodyText);
                  return (
                    <div key={idx} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-[10px]">Card {idx + 1}</Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeCard(idx)}
                          disabled={cards.length <= MIN_CARDS}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>

                      {/* Card image (sample for approval) */}
                      <input
                        ref={(el) => { cardFileRefs.current[idx] = el; }}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png"
                        onChange={(e) => handleCardFileSelect(idx, e)}
                      />
                      {!card.mediaHandle ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full gap-2 h-9"
                          onClick={() => cardFileRefs.current[idx]?.click()}
                          disabled={card.isUploading}
                        >
                          {card.isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {card.isUploading ? "Enviando..." : "Imagem de exemplo"}
                        </Button>
                      ) : (
                        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <CheckCircle className="h-4 w-4 text-stage-paid shrink-0" />
                            <span className="text-xs truncate">{card.mediaName}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => updateCard(idx, { mediaHandle: "", mediaName: "" })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      {/* Card body */}
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Texto do card</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 text-[10px]"
                          onClick={() => handleAddCardVariable(idx)}
                        >
                          <Variable className="h-3 w-3" />Variável
                        </Button>
                      </div>
                      <Textarea
                        ref={(el) => { cardBodyRefs.current[idx] = el; }}
                        placeholder="Ex: Tênis a partir de {{1}}"
                        value={card.bodyText}
                        onChange={(e) => updateCard(idx, { bodyText: e.target.value })}
                        rows={2}
                        maxLength={CARD_BODY_MAX}
                      />
                      <p className="text-[10px] text-muted-foreground text-right">{card.bodyText.length}/{CARD_BODY_MAX}</p>
                      {cardVars.length > 0 && (
                        <div className="space-y-1 rounded-md border border-dashed p-2">
                          <p className="text-[10px] font-medium text-muted-foreground">Exemplos das variáveis:</p>
                          {cardVars.map((n) => (
                            <div key={`c-${idx}-${n}`} className="flex items-center gap-2">
                              <span className="text-xs font-mono w-12 shrink-0">{`{{${n}}}`}</span>
                              <Input
                                className="h-8 text-xs"
                                placeholder={`Exemplo para {{${n}}}`}
                                value={card.examples[n] || ""}
                                onChange={(e) => updateCard(idx, { examples: { ...card.examples, [n]: e.target.value } })}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!isCarousel && (
              <div className="space-y-2">
                <Label>Rodapé (opcional)</Label>
                <Input
                  placeholder="Ex: Obrigado pela preferência!"
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                />
              </div>
            )}

            {/* Buttons */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{isCarousel ? "Botões dos cards (aplicados a todos) *" : "Botões (opcional)"}</Label>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => addButton("QUICK_REPLY")}>
                    + Resposta rápida
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => addButton("URL")}>
                    + Link
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => addButton("PHONE_NUMBER")}>
                    + Ligar
                  </Button>
                </div>
              </div>
              {buttons.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  {isCarousel
                    ? "Carrossel exige de 1 a 2 botões — eles são aplicados igualmente a todos os cards."
                    : "Adicione botões de resposta rápida, link ou ligação (máximo 10, padrões da Meta)."}
                </p>
              ) : (
                <div className="space-y-2">
                  {buttons.map((b, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border p-2">
                      <Badge variant="secondary" className="text-[10px] shrink-0 mt-1">
                        {b.type === "QUICK_REPLY" ? "Resposta" : b.type === "URL" ? "Link" : "Ligar"}
                      </Badge>
                      <div className="flex-1 space-y-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Texto do botão (máx 25)"
                          maxLength={25}
                          value={b.text}
                          onChange={(e) => updateButton(i, { text: e.target.value })}
                        />
                        {b.type === "URL" && (
                          <>
                            <Input
                              className="h-8 text-xs"
                              placeholder={isCarousel ? "https://exemplo.com/p/{{1}}" : "https://exemplo.com"}
                              value={b.url || ""}
                              onChange={(e) => updateButton(i, { url: e.target.value })}
                            />
                            {isCarousel && (b.url || "").includes("{{") && (
                              <Input
                                className="h-8 text-xs"
                                placeholder="Exemplo do sufixo da URL (ex: tenis-x)"
                                value={b.urlExample || ""}
                                onChange={(e) => updateButton(i, { urlExample: e.target.value })}
                              />
                            )}
                          </>
                        )}
                        {b.type === "PHONE_NUMBER" && (
                          <Input
                            className="h-8 text-xs"
                            placeholder="+5533999999999"
                            value={b.phone_number || ""}
                            onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                          />
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeButton(i)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Preview */}
            {bodyText && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-[10px] font-medium text-muted-foreground mb-2">Preview:</p>
                {!isCarousel && headerType === "text" && headerText && (
                  <p className="font-bold text-sm mb-1">{headerText}</p>
                )}
                {!isCarousel && isMediaHeader && headerMediaName && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    {(() => {
                      const Icon = MEDIA_HEADER[headerType as keyof typeof MEDIA_HEADER].icon;
                      return <Icon className="h-4 w-4" />;
                    })()}
                    <span className="truncate">{headerMediaName}</span>
                  </div>
                )}
                <p className="text-sm whitespace-pre-wrap">{bodyText}</p>
                {!isCarousel && footerText && (
                  <p className="text-xs text-muted-foreground mt-2">{footerText}</p>
                )}
                {isCarousel ? (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {cards.map((card, idx) => (
                      <div key={idx} className="w-36 shrink-0 rounded-md border bg-background overflow-hidden">
                        <div className="h-16 bg-muted flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                        <div className="p-1.5">
                          <p className="text-[10px] whitespace-pre-wrap line-clamp-3">{card.bodyText || "(texto do card)"}</p>
                          {buttons.length > 0 && (
                            <div className="mt-1 border-t pt-1 space-y-0.5">
                              {buttons.map((b, bi) => (
                                <p key={bi} className="text-[9px] text-center text-primary font-medium truncate">{b.text || "(botão)"}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  buttons.length > 0 && (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      {buttons.map((b, i) => (
                        <p key={i} className="text-xs text-center text-primary font-medium">
                          {b.text || "(botão)"}
                        </p>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleCreate}
                disabled={isCreating || isUploadingMedia || !name.trim() || !bodyText.trim()}
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar para Aprovação
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
