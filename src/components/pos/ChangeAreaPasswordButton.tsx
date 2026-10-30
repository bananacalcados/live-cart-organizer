import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { changeAreaPassword, type ProtectedArea } from "@/lib/areaPassword";

export function ChangeAreaPasswordButton({ area, label }: { area: ProtectedArea; label: string }) {
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(""); const [a, setA] = useState(""); const [b, setB] = useState("");
  const [saving, setSaving] = useState(false);
  if (!isAdmin) return null;
  const save = async () => {
    if (a !== b) return toast.error("As duas novas senhas não conferem");
    if (a.length < 6) return toast.error("A nova senha precisa ter pelo menos 6 caracteres");
    setSaving(true);
    try { await changeAreaPassword(area, cur, a); toast.success("Senha alterada"); setOpen(false); setCur(""); setA(""); setB(""); }
    catch (e: any) { toast.error(e.message || "Não foi possível alterar a senha"); }
    finally { setSaving(false); }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><KeyRound className="h-4 w-4 mr-1" />{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input type="password" placeholder="Senha atual" value={cur} onChange={(e) => setCur(e.target.value)} />
            <Input type="password" placeholder="Nova senha" value={a} onChange={(e) => setA(e.target.value)} />
            <Input type="password" placeholder="Repita a nova senha" value={b} onChange={(e) => setB(e.target.value)} />
          </div>
          <DialogFooter><Button onClick={save} disabled={saving || !cur || !a}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
