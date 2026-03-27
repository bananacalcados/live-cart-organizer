import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FlaskConical, RotateCcw, Phone, Loader2, Power } from "lucide-react";

export function AiTestPanel() {
  const [testMode, setTestMode] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["concierge_test_mode", "concierge_test_phone"]);

      if (data) {
        for (const row of data) {
          if (row.key === "concierge_test_mode") setTestMode(row.value === true || row.value === "true");
          if (row.key === "concierge_test_phone") setTestPhone(String(row.value || "").replace(/"/g, ""));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveSetting = async (key: string, value: any) => {
    await supabase
      .from("app_settings")
      .upsert({ key, value }, { onConflict: "key" });
  };

  const handleToggleTestMode = async (enabled: boolean) => {
    setSaving(true);
    try {
      await saveSetting("concierge_test_mode", enabled);
      setTestMode(enabled);
      toast.success(enabled ? "Modo teste ATIVADO — Bia responde apenas o número de teste" : "Modo teste DESATIVADO — Bia desligada");
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePhone = async () => {
    const clean = testPhone.replace(/\D/g, "");
    if (!clean || clean.length < 10) {
      toast.error("Digite um número válido com DDD");
      return;
    }
    setSaving(true);
    try {
      const phoneWithDDI = clean.startsWith("55") ? clean : "55" + clean;
      await saveSetting("concierge_test_phone", phoneWithDDI);
      setTestPhone(phoneWithDDI);
      toast.success(`Número de teste salvo: ${phoneWithDDI}`);
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleResetConversation = async () => {
    const clean = testPhone.replace(/\D/g, "");
    if (!clean) {
      toast.error("Configure o número de teste primeiro");
      return;
    }
    setResetting(true);
    try {
      const phoneVariants = [clean];
      if (clean.startsWith("55")) phoneVariants.push(clean.slice(2));
      else phoneVariants.push("55" + clean);

      await Promise.all([
        supabase
          .from("automation_ai_sessions")
          .update({ is_active: false })
          .in("phone", phoneVariants),
        supabase
          .from("whatsapp_messages")
          .delete()
          .in("phone", phoneVariants),
        supabase
          .from("ai_conversation_logs")
          .delete()
          .in("phone", phoneVariants),
        supabase
          .from("ai_error_logs")
          .delete()
          .in("phone", phoneVariants)
      ]);

      toast.success("Conversa da Bia resetada por completo! Pode iniciar um novo cenário.");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao resetar");
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed border-2 border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-5 w-5 text-primary" />
          Modo Teste — Concierge (Bia)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            <Power className={`h-5 w-5 ${testMode ? "text-green-500" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {testMode ? "Modo teste ATIVO" : "Bia desligada"}
              </p>
              <p className="text-xs text-muted-foreground">
                {testMode
                  ? "A Bia responde APENAS o número de teste abaixo"
                  : "Ative para testar a Bia com um número específico"}
              </p>
            </div>
          </div>
          <Switch
            checked={testMode}
            onCheckedChange={handleToggleTestMode}
            disabled={saving}
          />
        </div>

        {/* Test phone */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" />
            Número de teste (com DDD)
          </Label>
          <div className="flex gap-2">
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="5513999999999"
              className="flex-1"
            />
            <Button onClick={handleSavePhone} disabled={saving} size="sm">
              Salvar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A Bia só responderá mensagens vindas deste número enquanto o modo teste estiver ativo.
          </p>
        </div>

        {/* Reset button */}
        <div className="pt-2 border-t">
          <Button
            variant="outline"
            onClick={handleResetConversation}
            disabled={resetting || !testPhone}
            className="w-full gap-2"
          >
            {resetting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Resetar Conversa da Bia
          </Button>
          <p className="text-xs text-muted-foreground mt-1.5 text-center">
            Desativa a sessão de IA ativa para o número de teste, permitindo iniciar um novo cenário.
          </p>
        </div>

        {/* Status badges */}
        {testMode && testPhone && (
          <div className="flex items-center gap-2 pt-2">
            <Badge variant="outline" className="text-green-600 border-green-300">
              Teste ativo
            </Badge>
            <Badge variant="secondary">{testPhone}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
