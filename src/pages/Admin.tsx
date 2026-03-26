import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ZApiInstanceManager } from "@/components/admin/ZApiInstanceManager";
import { AiKnowledgeBase } from "@/components/admin/AiKnowledgeBase";
import { SecretaryChat } from "@/components/admin/SecretaryChat";
import {
  Banana, Home, Plus, Pencil, Trash2, Shield, ArrowLeft, Brain, Sparkles,
  LayoutDashboard, Calendar, MessageSquare, Megaphone, Truck, Store, Package, BarChart3, Smartphone,
} from "lucide-react";

const ALL_MODULES = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "events", label: "Eventos", icon: Calendar },
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "expedition", label: "Expedição", icon: Truck },
  { key: "pos", label: "Frente de Caixa", icon: Store },
  { key: "inventory", label: "Estoque", icon: Package },
  { key: "management", label: "Gestão", icon: BarChart3 },
];

interface UserData {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  roles: string[];
  modules: string[];
}

export default function Admin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserData | null>(null);

  // Create form
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newModules, setNewModules] = useState<string[]>([]);

  // Edit form
  const [editRole, setEditRole] = useState("user");
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await supabase.functions.invoke("admin-list-users", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (res.error) {
      toast({ title: "Erro", description: "Não foi possível carregar usuários", variant: "destructive" });
    } else {
      setUsers(res.data.users || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: newEmail,
          password: newPassword,
          display_name: newDisplayName || newEmail,
          role: newRole,
          modules: newRole === "admin" ? [] : newModules,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error || res.data?.error) {
        toast({ title: "Erro", description: res.data?.error || "Erro ao criar usuário", variant: "destructive" });
      } else {
        toast({ title: "Usuário criado com sucesso!" });
        setCreateOpen(false);
        setNewEmail(""); setNewPassword(""); setNewDisplayName(""); setNewRole("user"); setNewModules([]);
        fetchUsers();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async () => {
    if (!editUser || updating) return;
    setUpdating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await supabase.functions.invoke("admin-update-user", {
        body: {
          user_id: editUser.id,
          role: editRole,
          modules: editRole === "admin" ? [] : editModules,
          display_name: editDisplayName,
          password: editPassword || undefined,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error || res.data?.error) {
        toast({ title: "Erro", description: res.data?.error || "Erro ao atualizar", variant: "destructive" });
      } else {
        toast({ title: "Usuário atualizado!" });
        setEditUser(null);
        setEditPassword("");
        fetchUsers();
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`Tem certeza que deseja excluir o usuário ${email}?`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await supabase.functions.invoke("admin-delete-user", {
      body: { user_id: userId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (res.error || res.data?.error) {
      toast({ title: "Erro", description: res.data?.error || "Erro ao excluir", variant: "destructive" });
    } else {
      toast({ title: "Usuário excluído!" });
      fetchUsers();
    }
  };

  const openEdit = (user: UserData) => {
    setEditUser(user);
    setEditRole(user.roles[0] || "user");
    setEditModules(user.modules);
    setEditDisplayName(user.display_name);
    setEditPassword("");
  };

  const toggleModule = (mod: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(mod) ? list.filter(m => m !== mod) : [...list, mod]);
  };

  const getRoleBadge = (roles: string[]) => {
    if (roles.includes("admin")) return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Admin</Badge>;
    if (roles.includes("manager")) return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Gerente</Badge>;
    return <Badge variant="secondary">Usuário</Badge>;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Administração</h1>
              <p className="text-xs text-muted-foreground">Usuários e Permissões</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Início
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container py-6 space-y-6">
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Usuários</TabsTrigger>
            <TabsTrigger value="zapi" className="gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Instâncias Z-API</TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-1.5"><Brain className="h-3.5 w-3.5" /> Livete IA</TabsTrigger>
            <TabsTrigger value="secretary" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Secretária IA</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6 mt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground">Usuários</h2>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2"><Plus className="h-4 w-4" /> Novo Usuário</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Criar Usuário</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Nome</Label>
                      <Input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="Nome do usuário" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@empresa.com" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Senha</Label>
                      <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mín. 6 caracteres" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Papel</Label>
                      <Select value={newRole} onValueChange={setNewRole}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin (acesso total)</SelectItem>
                          <SelectItem value="manager">Gerente (visualiza admin)</SelectItem>
                          <SelectItem value="user">Usuário (módulos selecionados)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {newRole !== "admin" && (
                      <div className="space-y-2">
                        <Label>Módulos permitidos</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {ALL_MODULES.map(mod => (
                            <label key={mod.key} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={newModules.includes(mod.key)}
                                onCheckedChange={() => toggleModule(mod.key, newModules, setNewModules)}
                              />
                              <mod.icon className="h-3.5 w-3.5 text-muted-foreground" />
                              {mod.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <Button onClick={handleCreate} className="w-full" disabled={creating}>
                      {creating ? "Criando..." : "Criar Usuário"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Papel</TableHead>
                        <TableHead className="hidden md:table-cell">Módulos</TableHead>
                        <TableHead className="hidden md:table-cell">Último acesso</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map(user => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-foreground">{user.display_name}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>{getRoleBadge(user.roles)}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {user.roles.includes("admin") ? (
                                <Badge variant="outline" className="text-xs">Todos</Badge>
                              ) : user.modules.length > 0 ? (
                                user.modules.map(m => (
                                  <Badge key={m} variant="outline" className="text-xs">
                                    {ALL_MODULES.find(mod => mod.key === m)?.label || m}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">Nenhum</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {user.last_sign_in_at
                              ? new Date(user.last_sign_in_at).toLocaleDateString("pt-BR")
                              : "Nunca"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openEdit(user)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(user.id, user.email || "")}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Editar Usuário</DialogTitle>
                </DialogHeader>
                {editUser && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Nome</Label>
                      <Input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input value={editUser.email} disabled className="opacity-60" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Nova Senha (opcional)</Label>
                      <Input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="Deixe em branco para manter" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Papel</Label>
                      <Select value={editRole} onValueChange={setEditRole}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="manager">Gerente</SelectItem>
                          <SelectItem value="user">Usuário</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {editRole !== "admin" && (
                      <div className="space-y-2">
                        <Label>Módulos permitidos</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {ALL_MODULES.map(mod => (
                            <label key={mod.key} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={editModules.includes(mod.key)}
                                onCheckedChange={() => toggleModule(mod.key, editModules, setEditModules)}
                              />
                              <mod.icon className="h-3.5 w-3.5 text-muted-foreground" />
                              {mod.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <Button onClick={handleUpdate} className="w-full">Salvar Alterações</Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="zapi" className="mt-4">
            <ZApiInstanceManager />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-4">
            <AiKnowledgeBase />
          </TabsContent>

          <TabsContent value="secretary" className="mt-4">
            <SecretaryChat />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
