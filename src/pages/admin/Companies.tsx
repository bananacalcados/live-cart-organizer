import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { Building2, ArrowLeft, Plus, Pencil, Trash2, Link as LinkIcon, KeyRound, ShieldCheck, AlertTriangle, Upload, Hash } from "lucide-react";

type Regime = "simples_nacional" | "lucro_presumido" | "lucro_real" | "mei";
type Ambiente = "homologacao" | "producao";

interface Company {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  ie: string | null;
  ie_isento: boolean;
  im: string | null;
  regime_tributario: Regime;
  crt: number;
  cnae_principal: string | null;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_city_ibge: string | null;
  address_state: string | null;
  email: string | null;
  phone: string | null;
  ambiente_nfe: Ambiente;
  is_active: boolean;
  is_pilot: boolean;
  notes: string | null;
  brasilnfe_token: string | null;
  certificate_path: string | null;
  certificate_password: string | null;
  certificate_valid_until: string | null;
  certificate_filename: string | null;
  certificate_uploaded_at: string | null;
}

interface Store {
  id: string;
  name: string;
  company_id: string | null;
}

const emptyForm: Partial<Company> = {
  legal_name: "",
  trade_name: "",
  cnpj: "",
  ie: "",
  ie_isento: false,
  im: "",
  regime_tributario: "simples_nacional",
  crt: 1,
  cnae_principal: "",
  address_cep: "",
  address_street: "",
  address_number: "",
  address_complement: "",
  address_neighborhood: "",
  address_city: "",
  address_city_ibge: "",
  address_state: "",
  email: "",
  phone: "",
  ambiente_nfe: "homologacao",
  is_active: true,
  is_pilot: false,
  notes: "",
};

export default function Companies() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [credCompany, setCredCompany] = useState<Company | null>(null);
  const [credToken, setCredToken] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credFile, setCredFile] = useState<File | null>(null);
  const [credSaving, setCredSaving] = useState(false);
  const [form, setForm] = useState<Partial<Company>>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [c, s] = await Promise.all([
      (supabase as any).from("companies").select(
        "id, legal_name, trade_name, cnpj, ie, ie_isento, im, regime_tributario, crt, cnae_principal, address_cep, address_street, address_number, address_complement, address_neighborhood, address_city, address_city_ibge, address_state, address_country, email, phone, ambiente_nfe, brasilnfe_token, certificate_uploaded_at, certificate_expires_at, is_active, is_pilot, notes, created_at, updated_at, certificate_path, certificate_valid_until, certificate_filename"
      ).order("legal_name"),
      supabase.from("pos_stores").select("id,name,company_id").order("name"),
    ]);
    if (c.error) toast({ title: "Erro ao carregar empresas", description: c.error.message, variant: "destructive" });
    else setCompanies(c.data || []);
    if (s.error) toast({ title: "Erro ao carregar lojas", description: s.error.message, variant: "destructive" });
    else setStores((s.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setOpenDialog(true);
  };

  const openEdit = (c: Company) => {
    setForm(c);
    setEditingId(c.id);
    setOpenDialog(true);
  };

  const handleSave = async () => {
    if (!form.legal_name || !form.cnpj) {
      toast({ title: "Campos obrigatórios", description: "Razão social e CNPJ", variant: "destructive" });
      return;
    }
    setSaving(true);
    const cleaned: any = { ...form, cnpj: String(form.cnpj).replace(/\D/g, "") };
    const { error } = editingId
      ? await (supabase as any).from("companies").update(cleaned).eq("id", editingId)
      : await (supabase as any).from("companies").insert(cleaned);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Empresa atualizada" : "Empresa criada" });
    setOpenDialog(false);
    load();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir ${name}?`)) return;
    const { error } = await (supabase as any).from("companies").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Empresa excluída" });
    load();
  };

  const openCredentials = (c: Company) => {
    setCredCompany(c);
    setCredToken(c.brasilnfe_token || "");
    setCredPassword("");
    setCredFile(null);
    setCredOpen(true);
  };

  const handleSaveCredentials = async () => {
    if (!credCompany) return;
    setCredSaving(true);
    try {
      const updates: any = { brasilnfe_token: credToken || null };

      // Upload certificate if provided
      if (credFile) {
        if (!credPassword) {
          toast({ title: "Senha obrigatória", description: "Informe a senha do certificado A1", variant: "destructive" });
          setCredSaving(false);
          return;
        }
        const path = `${credCompany.id}/${Date.now()}-${credFile.name}`;
        const { error: upErr } = await supabase.storage
          .from("fiscal-certificates")
          .upload(path, credFile, { upsert: true, contentType: "application/x-pkcs12" });
        if (upErr) throw upErr;

        updates.certificate_path = path;
        updates.certificate_password = credPassword;
        updates.certificate_filename = credFile.name;
        updates.certificate_uploaded_at = new Date().toISOString();
      } else if (credPassword && credCompany.certificate_path) {
        // Updating only the password
        updates.certificate_password = credPassword;
      }

      const { error } = await (supabase as any).from("companies").update(updates).eq("id", credCompany.id);
      if (error) throw error;
      toast({ title: "Credenciais atualizadas" });
      setCredOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setCredSaving(false);
    }
  };

  const handleLinkStore = async (storeId: string, companyId: string | null) => {
    const { error } = await supabase.from("pos_stores").update({ company_id: companyId } as any).eq("id", storeId);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Vínculo atualizado" });
    load();
  };

  const fmtCnpj = (s: string) =>
    s.replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, "$1.$2.$3/$4-$5") || s;

  const set = (k: keyof Company, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Empresas Fiscais</h1>
              <p className="text-xs text-muted-foreground">CNPJs emissores de NFe / NFC-e</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Admin
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Entidades Fiscais</h2>
            <p className="text-sm text-muted-foreground">Cada CNPJ que emite documento fiscal pela operação.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/fiscal-numbering")} className="gap-2">
              <Hash className="h-4 w-4" /> Numeração Fiscal
            </Button>
            <Button variant="outline" onClick={() => setLinkOpen(true)} className="gap-2">
              <LinkIcon className="h-4 w-4" /> Vincular Lojas ↔ CNPJs
            </Button>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Empresa
            </Button>
          </div>
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
                    <TableHead>Razão Social</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Regime</TableHead>
                    <TableHead>Ambiente</TableHead>
                    <TableHead>Lojas vinculadas</TableHead>
                    <TableHead>Credenciais Fiscais</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((c) => {
                    const linked = stores.filter((s) => s.company_id === c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">{c.legal_name}</p>
                            {c.trade_name && <p className="text-xs text-muted-foreground">{c.trade_name}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{fmtCnpj(c.cnpj)}</TableCell>
                        <TableCell className="text-xs">{c.regime_tributario.replace(/_/g, " ")}</TableCell>
                        <TableCell>
                          {c.ambiente_nfe === "producao" ? (
                            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Produção</Badge>
                          ) : (
                            <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">Homologação</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {linked.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              linked.map((s) => (
                                <Badge key={s.id} variant="outline" className="text-xs">{s.name}</Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {c.brasilnfe_token ? (
                              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs gap-1">
                                <KeyRound className="h-3 w-3" /> Token OK
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                                <KeyRound className="h-3 w-3" /> Sem token
                              </Badge>
                            )}
                            {c.certificate_path ? (
                              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs gap-1">
                                <ShieldCheck className="h-3 w-3" /> A1 OK
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                                <AlertTriangle className="h-3 w-3" /> Sem A1
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {c.is_pilot && <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 text-xs">Piloto</Badge>}
                            {!c.is_active && <Badge variant="secondary" className="text-xs">Inativa</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openCredentials(c)} title="Credenciais Fiscais">
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id, c.legal_name)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Empresa" : "Nova Empresa Fiscal"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Razão Social *</Label>
                <Input value={form.legal_name || ""} onChange={(e) => set("legal_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Nome Fantasia</Label>
                <Input value={form.trade_name || ""} onChange={(e) => set("trade_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>CNPJ * (apenas números)</Label>
                <Input value={form.cnpj || ""} onChange={(e) => set("cnpj", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Inscrição Estadual</Label>
                <Input value={form.ie || ""} onChange={(e) => set("ie", e.target.value)} disabled={form.ie_isento} />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <Switch checked={!!form.ie_isento} onCheckedChange={(v) => set("ie_isento", v)} />
                <Label>IE Isento</Label>
              </div>
              <div className="space-y-1.5">
                <Label>Inscrição Municipal</Label>
                <Input value={form.im || ""} onChange={(e) => set("im", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>CNAE Principal</Label>
                <Input value={form.cnae_principal || ""} onChange={(e) => set("cnae_principal", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Regime Tributário</Label>
                <Select value={form.regime_tributario} onValueChange={(v) => set("regime_tributario", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simples_nacional">Simples Nacional</SelectItem>
                    <SelectItem value="lucro_presumido">Lucro Presumido</SelectItem>
                    <SelectItem value="lucro_real">Lucro Real</SelectItem>
                    <SelectItem value="mei">MEI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CRT</Label>
                <Select value={String(form.crt ?? 1)} onValueChange={(v) => set("crt", Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 - Simples Nacional</SelectItem>
                    <SelectItem value="2">2 - Simples (excesso sublimite)</SelectItem>
                    <SelectItem value="3">3 - Regime Normal</SelectItem>
                    <SelectItem value="4">4 - MEI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ambiente NFe</Label>
                <Select value={form.ambiente_nfe} onValueChange={(v) => set("ambiente_nfe", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="homologacao">Homologação (testes)</SelectItem>
                    <SelectItem value="producao">Produção (real)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 pt-2 border-t border-border">
                <p className="text-sm font-medium text-foreground mb-2">Endereço Fiscal</p>
              </div>
              <div className="space-y-1.5">
                <Label>CEP</Label>
                <Input value={form.address_cep || ""} onChange={(e) => set("address_cep", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Logradouro</Label>
                <Input value={form.address_street || ""} onChange={(e) => set("address_street", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Número</Label>
                <Input value={form.address_number || ""} onChange={(e) => set("address_number", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Complemento</Label>
                <Input value={form.address_complement || ""} onChange={(e) => set("address_complement", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Bairro</Label>
                <Input value={form.address_neighborhood || ""} onChange={(e) => set("address_neighborhood", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Input value={form.address_city || ""} onChange={(e) => set("address_city", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>UF</Label>
                <Input value={form.address_state || ""} onChange={(e) => set("address_state", e.target.value.toUpperCase())} maxLength={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Código IBGE Município</Label>
                <Input value={form.address_city_ibge || ""} onChange={(e) => set("address_city_ibge", e.target.value)} />
              </div>

              <div className="col-span-2 pt-2 border-t border-border">
                <p className="text-sm font-medium text-foreground mb-2">Contato & Controle</p>
              </div>
              <div className="space-y-1.5">
                <Label>Email Fiscal</Label>
                <Input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={!!form.is_active} onCheckedChange={(v) => set("is_active", v)} />
                <Label>Ativa</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={!!form.is_pilot} onCheckedChange={(v) => set("is_pilot", v)} />
                <Label>Piloto BrasilNFe</Label>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notas internas</Label>
                <Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={2} />
              </div>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Salvando..." : editingId ? "Salvar Alterações" : "Criar Empresa"}
            </Button>
          </DialogContent>
        </Dialog>

        {/* Link Stores Dialog */}
        <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Vincular Lojas ↔ CNPJ</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Define qual CNPJ cada loja física emite hoje. Pode ser alterado a qualquer momento durante a migração.
              </p>
              {stores.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
                  <span className="text-sm font-medium text-foreground">{s.name}</span>
                  <Select
                    value={s.company_id || "none"}
                    onValueChange={(v) => handleLinkStore(s.id, v === "none" ? null : v)}
                  >
                    <SelectTrigger className="w-56"><SelectValue placeholder="Sem CNPJ" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Sem CNPJ —</SelectItem>
                      {companies.filter(c => c.is_active).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.trade_name || c.legal_name} {c.is_pilot && "(piloto)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Credentials Dialog */}
        <Dialog open={credOpen} onOpenChange={setCredOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Credenciais Fiscais — {credCompany?.trade_name || credCompany?.legal_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <strong>Atenção:</strong> Token e senha do certificado A1 ficam armazenados criptografados. Apenas administradores podem visualizar/alterar. O .pfx é guardado em bucket privado.
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" /> Token Brasil NFe</Label>
                <Input
                  type="password"
                  value={credToken}
                  onChange={(e) => setCredToken(e.target.value)}
                  placeholder="Cole o token da API Brasil NFe"
                />
                <p className="text-xs text-muted-foreground">Obtido no painel da Brasil NFe (api.brasilnfe.com.br).</p>
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <Label className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Certificado Digital A1 (.pfx)</Label>

                {credCompany?.certificate_filename && (
                  <div className="text-xs p-2 rounded border border-border bg-muted/40">
                    <p className="text-foreground font-medium">📎 {credCompany.certificate_filename}</p>
                    {credCompany.certificate_uploaded_at && (
                      <p className="text-muted-foreground mt-0.5">
                        Enviado em {new Date(credCompany.certificate_uploaded_at).toLocaleString("pt-BR")}
                      </p>
                    )}
                    {credCompany.certificate_valid_until && (
                      <p className="text-muted-foreground">
                        Válido até {new Date(credCompany.certificate_valid_until).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Novo arquivo .pfx (opcional)</Label>
                  <Input
                    type="file"
                    accept=".pfx,.p12,application/x-pkcs12"
                    onChange={(e) => setCredFile(e.target.files?.[0] || null)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Senha do Certificado</Label>
                  <Input
                    type="password"
                    value={credPassword}
                    onChange={(e) => setCredPassword(e.target.value)}
                    placeholder={credCompany?.certificate_path ? "Deixe em branco para manter" : "Senha do .pfx"}
                  />
                </div>
              </div>

              <Button onClick={handleSaveCredentials} disabled={credSaving} className="w-full gap-2">
                <Upload className="h-4 w-4" />
                {credSaving ? "Salvando..." : "Salvar Credenciais"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
