import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, Save, Plus, UserCheck, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface StoreRow {
  id: string;
  name: string;
}

interface UserProfile {
  id: string;
  user_id: string;
  display_name: string;
  seller_id: string | null;
  store_id: string | null;
  is_active: boolean;
}

interface Seller {
  id: string;
  name: string;
  store_id: string;
  is_active: boolean;
}

interface Props {
  stores: StoreRow[];
}

export function TeamProfilesManager({ stores }: Props) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // New profile form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newSellerId, setNewSellerId] = useState("");
  const [newStoreId, setNewStoreId] = useState("");

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSellerId, setEditSellerId] = useState("");
  const [editStoreId, setEditStoreId] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [{ data: profilesData }, { data: sellersData }] = await Promise.all([
      supabase.from('user_profiles').select('*').order('display_name'),
      supabase.from('pos_sellers').select('*').order('name'),
    ]);
    setProfiles((profilesData || []) as UserProfile[]);
    setSellers((sellersData || []) as Seller[]);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newName.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      // If email is provided, try to find user by email
      let userId: string = crypto.randomUUID();
      if (newEmail.trim()) {
        userId = `email:${newEmail.trim().toLowerCase()}`;
      }

      const { error } = await supabase.from('user_profiles').insert({
        user_id: userId,
        display_name: newName.trim(),
        seller_id: newSellerId || null,
        store_id: newStoreId || null,
      } as any);
      if (error) throw error;
      toast.success("Perfil adicionado!");
      setNewName(""); setNewEmail(""); setNewSellerId(""); setNewStoreId("");
      setShowAdd(false);
      loadData();
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao adicionar perfil");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (profileId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('user_profiles').update({
        display_name: editName.trim(),
        seller_id: editSellerId || null,
        store_id: editStoreId || null,
      } as any).eq('id', profileId);
      if (error) throw error;
      toast.success("Perfil atualizado!");
      setEditingId(null);
      loadData();
    } catch {
      toast.error("Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    const { error } = await supabase.from('user_profiles').delete().eq('id', profileId);
    if (error) { toast.error("Erro ao remover"); return; }
    toast.success("Perfil removido");
    loadData();
  };

  const getSellerName = (sellerId: string | null) => sellers.find(s => s.id === sellerId)?.name || "—";
  const getStoreName = (storeId: string | null) => stores.find(s => s.id === storeId)?.name || "—";

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Perfis da Equipe</h3>
          <p className="text-xs text-muted-foreground mt-1">Configure os nomes para o chat e associe vendedoras às contas de login</p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setShowAdd(true)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar Perfil
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {profiles.map(p => (
          <Card key={p.id}>
            <CardContent className="pt-4 pb-3 px-4 space-y-3">
              {editingId === p.id ? (
                <>
                  <div>
                    <Label className="text-xs">Nome no Chat</Label>
                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Vendedora Associada</Label>
                    <Select value={editSellerId} onValueChange={setEditSellerId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {sellers.filter(s => s.is_active).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name} ({getStoreName(s.store_id)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Loja Padrão</Label>
                    <Select value={editStoreId} onValueChange={setEditStoreId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 gap-1" onClick={() => handleUpdate(p.id)} disabled={saving}>
                      <Save className="h-3 w-3" /> Salvar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancelar</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {p.display_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{p.display_name}</p>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{p.user_id.startsWith('email:') ? p.user_id.replace('email:', '') : 'ID vinculado'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingId(p.id); setEditName(p.display_name); setEditSellerId(p.seller_id || "none"); setEditStoreId(p.store_id || "none"); }}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.seller_id && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <UserCheck className="h-3 w-3" /> {getSellerName(p.seller_id)}
                      </Badge>
                    )}
                    {p.store_id && (
                      <Badge variant="secondary" className="text-[10px]">{getStoreName(p.store_id)}</Badge>
                    )}
                    {!p.seller_id && !p.store_id && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Sem vínculo</Badge>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}

        {profiles.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum perfil configurado</p>
              <p className="text-xs mt-1">Adicione perfis para identificar sua equipe no chat</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Profile Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Adicionar Perfil</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome para o Chat *</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Maria, João, Gerente" className="h-9" />
              <p className="text-[10px] text-muted-foreground mt-1">Este nome será exibido nas mensagens do chat da equipe</p>
            </div>
            <div>
              <Label className="text-xs">E-mail da conta (Gmail/login)</Label>
              <Input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="pessoa@gmail.com" className="h-9" />
              <p className="text-[10px] text-muted-foreground mt-1">O e-mail usado para fazer login no sistema</p>
            </div>
            <div>
              <Label className="text-xs">Vendedora Associada (opcional)</Label>
              <Select value={newSellerId} onValueChange={setNewSellerId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma (não é vendedora)</SelectItem>
                  {sellers.filter(s => s.is_active).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name} ({getStoreName(s.store_id)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Vincule a uma vendedora do PDV para rastrear performance</p>
            </div>
            <div>
              <Label className="text-xs">Loja Padrão (opcional)</Label>
              <Select value={newStoreId} onValueChange={setNewStoreId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={saving}>
              {saving ? "Salvando..." : "Adicionar Perfil"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
