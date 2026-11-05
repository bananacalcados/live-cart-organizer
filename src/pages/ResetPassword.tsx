import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") setReady(true); });
    if (window.location.hash.includes("type=recovery")) setReady(true);
    return () => data.subscription.unsubscribe();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast({ title: "Senha curta", description: "Use pelo menos 8 caracteres.", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) { toast({ title: "Não foi possível salvar", description: "O link pode ter expirado. Peça outro.", variant: "destructive" }); return; }
    toast({ title: "Senha alterada" });
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="text-xl text-center">Nova senha</CardTitle></CardHeader>
        <CardContent>
          {!ready ? <p className="text-sm text-muted-foreground text-center">Abra esta página pelo link enviado ao seu e-mail.</p> : (
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="np">Nova senha</Label><Input id="np" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
