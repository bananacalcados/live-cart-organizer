import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Edit2, Trash2, Users, UserCheck, Mic } from "lucide-react";

export interface TeamMember {
  id: string;
  name: string;
  role: "vendedora" | "apresentadora";
  whatsapp: string | null;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

export function EventTeamManager() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"vendedora" | "apresentadora">("vendedora");
  const [whatsapp, setWhatsapp] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const fetchMembers = async () => {
    const { data } = await supabase
      .from("event_team_members")
      .select("*")
      .eq("is_active", true)
      .order("name");
    setMembers((data as unknown as TeamMember[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchMembers(); }, []);

  const resetForm = () => {
    setName(""); setRole("vendedora"); setWhatsapp(""); setPhotoUrl(""); setEditingId(null);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const payload = { name: name.trim(), role, whatsapp: whatsapp || null, photo_url: photoUrl || null };

    if (editingId) {
      const { error } = await supabase.from("event_team_members").update(payload).eq("id", editingId);
      if (error) { toast.error("Erro ao atualizar"); return; }
      toast.success("Membro atualizado!");
    } else {
      const { error } = await supabase.from("event_team_members").insert(payload);
      if (error) { toast.error("Erro ao cadastrar"); return; }
      toast.success("Membro cadastrado!");
    }
    setDialogOpen(false);
    resetForm();
    fetchMembers();
  };

  const handleEdit = (m: TeamMember) => {
    setEditingId(m.id);
    setName(m.name);
    setRole(m.role);
    setWhatsapp(m.whatsapp || "");
    setPhotoUrl(m.photo_url || "");
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("event_team_members").update({ is_active: false }).eq("id", id);
    toast.success("Membro removido!");
    fetchMembers();
  };

  const vendedoras = members.filter((m) => m.role === "vendedora");
  const apresentadoras = members.filter((m) => m.role === "apresentadora");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-bold">Equipe</h2>
          <Badge variant="secondary">{members.length} membros</Badge>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="btn-accent" size="sm">
              <Plus className="h-4 w-4 mr-1" /> Novo Membro
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Membro" : "Novo Membro"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Nome *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
              </div>
              <div className="space-y-1">
                <Label>Cargo *</Label>
                <Select value={role} onValueChange={(v) => setRole(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vendedora">Vendedora</SelectItem>
                    <SelectItem value="apresentadora">Apresentadora</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>WhatsApp</Label>
                <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5531999999999" />
              </div>
              <div className="space-y-1">
                <Label>URL da Foto (opcional)</Label>
                <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => { setDialogOpen(false); resetForm(); }}>
                  Cancelar
                </Button>
                <Button className="flex-1 btn-accent" onClick={handleSave} disabled={!name.trim()}>
                  {editingId ? "Salvar" : "Cadastrar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Carregando...</p>
      ) : (
        <div className="space-y-4">
          {/* Apresentadoras */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <Mic className="h-4 w-4" /> Apresentadoras ({apresentadoras.length})
            </h3>
            {apresentadoras.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma apresentadora cadastrada.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {apresentadoras.map((m) => (
                  <MemberCard key={m.id} member={m} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>
          {/* Vendedoras */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <UserCheck className="h-4 w-4" /> Vendedoras ({vendedoras.length})
            </h3>
            {vendedoras.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma vendedora cadastrada.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {vendedoras.map((m) => (
                  <MemberCard key={m.id} member={m} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MemberCard({ member, onEdit, onDelete }: { member: TeamMember; onEdit: (m: TeamMember) => void; onDelete: (id: string) => void }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={member.photo_url || undefined} />
          <AvatarFallback className="bg-accent/20 text-accent text-sm font-bold">
            {member.name.substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{member.name}</p>
          <p className="text-xs text-muted-foreground">{member.whatsapp || "Sem WhatsApp"}</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(member)}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover {member.name}?</AlertDialogTitle>
                <AlertDialogDescription>O membro será desativado da equipe.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => onDelete(member.id)}>
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
