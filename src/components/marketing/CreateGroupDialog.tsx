import { useState } from "react";
import { toast } from "sonner";
import {
  Plus, Loader2, Sparkles, Image, FileText, Pin, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateGroupDialog({ open, onOpenChange, onCreated }: CreateGroupDialogProps) {
  const [groupName, setGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [pinnedMessage, setPinnedMessage] = useState("");
  const [brandContext, setBrandContext] = useState("");
  const [initialPhones, setInitialPhones] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [step, setStep] = useState<"create" | "customize">("create");

  const generateAiContent = async (type: "description" | "pinned_message" | "photo_prompt") => {
    if (!groupName.trim()) {
      toast.error("Digite o nome do grupo primeiro");
      return;
    }
    setAiLoading(type);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-group-content`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type, groupName, brandContext }),
        }
      );
      const data = await res.json();
      if (data.success) {
        if (type === "description") setDescription(data.content);
        else if (type === "pinned_message") setPinnedMessage(data.content);
        toast.success("Conteúdo gerado pela IA!");
      } else {
        toast.error(data.error || "Erro ao gerar conteúdo");
      }
    } catch {
      toast.error("Erro ao conectar com IA");
    } finally {
      setAiLoading(null);
    }
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      toast.error("Nome do grupo é obrigatório");
      return;
    }
    setIsCreating(true);
    try {
      // Step 1: Create group via Z-API
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            action: "create", 
            groupName,
            phones: initialPhones.split(/[,;\n\s]+/).map(p => p.replace(/\D/g, '')).filter(p => p.length >= 10),
          }),
        }
      );
      const data = await res.json();

      if (!data.success || (data.data && data.data.success === false)) {
        toast.error("Erro ao criar grupo: " + (data.data?.message || data.error || "Verifique se adicionou pelo menos 1 participante"));
        return;
      }

      const newGroupId = data.groupId || data.data?.phone || data.data?.groupId;
      if (!newGroupId) {
        toast.error("Grupo criado mas ID não retornado. Sincronize os grupos para ver.");
        setStep("customize");
        return;
      }

      setCreatedGroupId(newGroupId);
      toast.success("Grupo criado com sucesso!");

      // Step 2: Set description if filled
      if (description.trim()) {
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`,
          {
            method: "POST",
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "update-description",
              groupId: newGroupId,
              value: description,
            }),
          }
        );
      }

      // Step 3: Set admins-only messages
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "set-messages-admins-only",
            groupId: newGroupId,
            value: "true",
          }),
        }
      );

      setStep("customize");
    } catch {
      toast.error("Erro ao criar grupo");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendPinnedMessage = async () => {
    if (!pinnedMessage.trim() || !createdGroupId) return;
    setAiLoading("sending_pin");
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-send-message`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: createdGroupId,
            message: pinnedMessage,
          }),
        }
      );
      const data = await res.json();
      if (data.success || data.zapiMessageId) {
        toast.success("Mensagem enviada! Fixe-a manualmente no WhatsApp.");
      } else {
        toast.error("Erro ao enviar mensagem");
      }
    } catch {
      toast.error("Erro ao enviar");
    } finally {
      setAiLoading(null);
    }
  };

  const handleFinish = () => {
    setGroupName("");
    setDescription("");
    setPinnedMessage("");
    setBrandContext("");
    setCreatedGroupId(null);
    setStep("create");
    onOpenChange(false);
    onCreated();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleFinish(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {step === "create" ? "Criar Grupo VIP" : "Personalizar Grupo"}
          </DialogTitle>
        </DialogHeader>

        {step === "create" ? (
          <div className="space-y-4">
            {/* Group name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do grupo *</Label>
              <Input
                placeholder="Ex: 🍌 Banana VIP #1"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>

            {/* Brand context for AI */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Contexto da marca (opcional, para IA)</Label>
              <Input
                placeholder="Ex: loja de moda feminina jovem e descolada"
                value={brandContext}
                onChange={(e) => setBrandContext(e.target.value)}
              />
            </div>

            {/* Initial participants */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Participantes iniciais *</Label>
              <Textarea
                placeholder={"Cole os números (um por linha ou separados por vírgula)\nEx: 5533999999999, 5533988888888"}
                value={initialPhones}
                onChange={(e) => setInitialPhones(e.target.value)}
                rows={3}
              />
              <p className="text-[10px] text-muted-foreground">
                É obrigatório pelo menos 1 participante para criar o grupo. Use o formato com DDI+DDD+número.
              </p>
            </div>

            <Separator />

            {/* Description */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> Descrição do grupo
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => generateAiContent("description")}
                  disabled={aiLoading === "description"}
                >
                  {aiLoading === "description" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Gerar com IA
                </Button>
              </div>
              <Textarea
                placeholder="Descrição do grupo (até 512 caracteres)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={512}
              />
              <p className="text-[10px] text-muted-foreground text-right">
                {description.length}/512
              </p>
            </div>

            {/* Pinned message */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Pin className="h-3.5 w-3.5" /> Mensagem fixada
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => generateAiContent("pinned_message")}
                  disabled={aiLoading === "pinned_message"}
                >
                  {aiLoading === "pinned_message" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Gerar com IA
                </Button>
              </div>
              <Textarea
                placeholder="Mensagem que será enviada e fixada no grupo"
                value={pinnedMessage}
                onChange={(e) => setPinnedMessage(e.target.value)}
                rows={4}
              />
            </div>

            {/* Cover photo AI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Image className="h-3.5 w-3.5" /> Foto de capa (IA)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => generateAiContent("photo_prompt")}
                  disabled={aiLoading === "photo_prompt"}
                >
                  {aiLoading === "photo_prompt" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Gerar prompt
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                A foto de capa poderá ser configurada após a criação do grupo.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={isCreating} className="gap-1">
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Criar Grupo
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-emerald-500/10 border-emerald-500/30 p-3">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                ✅ Grupo "{groupName}" criado com sucesso!
              </p>
              {createdGroupId && (
                <p className="text-xs text-muted-foreground mt-1">
                  ID: {createdGroupId}
                </p>
              )}
            </div>

            {/* Send pinned message */}
            {pinnedMessage.trim() && (
              <div className="space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Pin className="h-3.5 w-3.5" /> Enviar mensagem fixada
                </Label>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="text-xs whitespace-pre-wrap">{pinnedMessage}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => copyToClipboard(pinnedMessage)}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copiar
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={handleSendPinnedMessage}
                    disabled={aiLoading === "sending_pin"}
                  >
                    {aiLoading === "sending_pin" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                    Enviar no grupo
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  💡 Após enviar, fixe a mensagem manualmente no WhatsApp (segurar a mensagem → Fixar).
                </p>
              </div>
            )}

            <Separator />

            <p className="text-xs text-muted-foreground">
              Sincronize os grupos para ver o novo grupo na lista. Depois, use as configurações (⚙️) para adicionar foto de capa.
            </p>

            <DialogFooter>
              <Button onClick={handleFinish} className="gap-1">
                Concluir e Sincronizar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
