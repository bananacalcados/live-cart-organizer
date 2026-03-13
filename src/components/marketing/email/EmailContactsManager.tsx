import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Users, Plus, Search, Upload, Download, Trash2, X, List,
  ChevronLeft, ChevronRight, UserPlus, FileSpreadsheet, Check,
  MailX, Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface EmailList {
  id: string;
  name: string;
  description: string | null;
  contact_count: number;
  created_at: string;
  user_id: string;
}

interface EmailContact {
  id: string;
  email: string;
  name: string | null;
  tags: string[] | null;
  subscribed: boolean;
  unsubscribed_at: string | null;
  list_id: string;
  created_at: string;
  custom_fields: Record<string, any> | null;
}

const PAGE_SIZE = 50;

export function EmailContactsManager() {
  // Lists
  const [lists, setLists] = useState<EmailList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [creatingList, setCreatingList] = useState(false);

  // Contacts
  const [contacts, setContacts] = useState<EmailContact[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'subscribed' | 'unsubscribed'>('all');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Add contact
  const [showAddContact, setShowAddContact] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newTags, setNewTags] = useState('');
  const [addingContact, setAddingContact] = useState(false);

  // CSV Import
  const [showImport, setShowImport] = useState(false);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [emailCol, setEmailCol] = useState<string>('');
  const [nameCol, setNameCol] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ─── Load lists ─────────────────────────────────
  const loadLists = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('email_lists')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setLists(data);
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  // ─── Load contacts ──────────────────────────────
  const loadContacts = useCallback(async () => {
    if (!selectedListId) { setContacts([]); setTotalContacts(0); return; }
    setLoadingContacts(true);
    try {
      let q = supabase
        .from('email_contacts')
        .select('*', { count: 'exact' })
        .eq('list_id', selectedListId);

      if (statusFilter === 'subscribed') q = q.eq('subscribed', true);
      if (statusFilter === 'unsubscribed') q = q.eq('subscribed', false);
      if (search.trim()) {
        q = q.or(`email.ilike.%${search.trim()}%,name.ilike.%${search.trim()}%`);
      }

      const { data, count, error } = await q
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      setContacts((data || []) as EmailContact[]);
      setTotalContacts(count || 0);
    } finally {
      setLoadingContacts(false);
    }
  }, [selectedListId, page, search, statusFilter]);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [selectedListId, search, statusFilter]);

  // ─── Create list ────────────────────────────────
  const createList = async () => {
    if (!newListName.trim()) return;
    setCreatingList(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Faça login'); return; }
      const { error } = await supabase.from('email_lists').insert({
        name: newListName.trim(),
        description: newListDesc.trim() || null,
        user_id: user.id,
      });
      if (error) throw error;
      toast.success('Lista criada!');
      setShowNewList(false);
      setNewListName('');
      setNewListDesc('');
      loadLists();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingList(false);
    }
  };

  // ─── Add contact ────────────────────────────────
  const addContact = async () => {
    if (!newEmail.trim() || !selectedListId) return;
    setAddingContact(true);
    try {
      const { error } = await supabase.from('email_contacts').insert({
        email: newEmail.trim().toLowerCase(),
        name: newName.trim() || null,
        tags: newTags.trim() ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        list_id: selectedListId,
      });
      if (error) {
        if (error.message.includes('duplicate') || error.code === '23505') {
          toast.error('Este email já existe nesta lista');
        } else throw error;
        return;
      }
      toast.success('Contato adicionado!');
      setShowAddContact(false);
      setNewEmail(''); setNewName(''); setNewTags('');
      loadContacts();
      updateListCount(selectedListId);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAddingContact(false);
    }
  };

  // ─── Toggle subscribe ───────────────────────────
  const toggleSubscription = async (contact: EmailContact) => {
    const newSub = !contact.subscribed;
    const { error } = await supabase.from('email_contacts').update({
      subscribed: newSub,
      unsubscribed_at: newSub ? null : new Date().toISOString(),
    }).eq('id', contact.id);
    if (error) { toast.error(error.message); return; }
    toast.success(newSub ? 'Contato re-inscrito' : 'Contato descadastrado');
    loadContacts();
  };

  // ─── Delete selected ───────────────────────────
  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const { error } = await supabase.from('email_contacts').delete().in('id', ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} contato(s) excluído(s)`);
    setSelected(new Set());
    setShowDeleteConfirm(false);
    loadContacts();
    if (selectedListId) updateListCount(selectedListId);
  };

  // ─── Export selected ───────────────────────────
  const exportSelected = () => {
    const rows = selected.size > 0
      ? contacts.filter(c => selected.has(c.id))
      : contacts;
    if (!rows.length) { toast.error('Nenhum contato para exportar'); return; }
    const csv = [
      'email,nome,tags,status,data_cadastro',
      ...rows.map(c =>
        `${c.email},"${c.name || ''}","${(c.tags || []).join(';')}",${c.subscribed ? 'inscrito' : 'descadastrado'},${c.created_at}`
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'contatos.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Exportação concluída');
  };

  // ─── CSV Import ─────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      if (lines.length < 2) { toast.error('CSV vazio ou inválido'); return; }
      setCsvHeaders(lines[0]);
      setCsvData(lines.slice(1).filter(l => l.some(c => c)));
      setEmailCol('');
      setNameCol('');
      setImportResult(null);
      setShowImport(true);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const executeImport = async () => {
    if (!emailCol || !selectedListId) return;
    setImporting(true);
    try {
      const emailIdx = csvHeaders.indexOf(emailCol);
      const nameIdx = nameCol ? csvHeaders.indexOf(nameCol) : -1;
      const rows = csvData
        .map(row => ({
          email: (row[emailIdx] || '').toLowerCase().trim(),
          name: nameIdx >= 0 ? row[nameIdx]?.trim() || null : null,
          list_id: selectedListId,
          tags: [] as string[],
        }))
        .filter(r => r.email && r.email.includes('@'));

      // check existing
      const { data: existing } = await supabase
        .from('email_contacts')
        .select('email')
        .eq('list_id', selectedListId)
        .in('email', rows.map(r => r.email));

      const existingEmails = new Set((existing || []).map(e => e.email));
      const toInsert = rows.filter(r => !existingEmails.has(r.email));
      const duplicates = rows.length - toInsert.length;

      if (toInsert.length > 0) {
        // batch insert in chunks of 500
        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = await supabase.from('email_contacts').insert(chunk);
          if (error) throw error;
        }
      }

      setImportResult({ imported: toInsert.length, duplicates });
      toast.success(`${toInsert.length} importados, ${duplicates} duplicados ignorados`);
      loadContacts();
      updateListCount(selectedListId);
    } catch (e: any) {
      toast.error('Erro na importação: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const updateListCount = async (listId: string) => {
    const { count } = await supabase
      .from('email_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', listId);
    await supabase.from('email_lists').update({ contact_count: count || 0 }).eq('id', listId);
    loadLists();
  };

  // ─── Selection helpers ──────────────────────────
  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map(c => c.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);
  const selectedList = lists.find(l => l.id === selectedListId);

  return (
    <div className="flex gap-4 min-h-[500px]">
      {/* ── Sidebar: Lists ────────────────────── */}
      <div className="w-64 shrink-0 border rounded-lg bg-card">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <List className="h-4 w-4" /> Listas
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShowNewList(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="h-[440px]">
          <div className="p-2 space-y-1">
            {lists.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma lista criada</p>
            )}
            {lists.map(list => (
              <button
                key={list.id}
                onClick={() => setSelectedListId(list.id)}
                className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                  selectedListId === list.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <div className="truncate">{list.name}</div>
                <div className="text-xs text-muted-foreground">{list.contact_count} contatos</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Main area ─────────────────────────── */}
      <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
        {!selectedListId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <Users className="h-10 w-10 mx-auto opacity-40" />
              <p>Selecione uma lista para ver os contatos</p>
            </div>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="p-3 border-b space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold text-foreground text-sm">{selectedList?.name}</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" onClick={() => setShowAddContact(true)}>
                    <UserPlus className="h-4 w-4 mr-1" /> Adicionar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> Importar CSV
                  </Button>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                  <Button size="sm" variant="outline" onClick={exportSelected}>
                    <Download className="h-4 w-4 mr-1" /> Exportar
                  </Button>
                  {selected.size > 0 && (
                    <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                      <Trash2 className="h-4 w-4 mr-1" /> Excluir ({selected.size})
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por email ou nome..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
                  <SelectTrigger className="w-[160px] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="subscribed">Inscritos</SelectItem>
                    <SelectItem value="unsubscribed">Descadastrados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={contacts.length > 0 && selected.size === contacts.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingContacts ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : contacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum contato encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    contacts.map(contact => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(contact.id)}
                            onCheckedChange={() => toggleOne(contact.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium text-sm">{contact.email}</TableCell>
                        <TableCell className="text-sm">{contact.name || '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {(contact.tags || []).map(tag => (
                              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {contact.subscribed ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs">
                              <Mail className="h-3 w-3 mr-1" /> Inscrito
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <MailX className="h-3 w-3 mr-1" /> Descadastrado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(contact.created_at), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleSubscription(contact)}
                            title={contact.subscribed ? 'Descadastrar' : 'Re-inscrever'}
                          >
                            {contact.subscribed ? <MailX className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-3 border-t flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {totalContacts} contato(s) — Página {page + 1} de {totalPages}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── New List Dialog ────────────────────── */}
      <Dialog open={showNewList} onOpenChange={setShowNewList}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Lista</DialogTitle>
            <DialogDescription>Crie uma lista para organizar seus contatos de email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome *</Label>
              <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Ex: Newsletter" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={newListDesc} onChange={e => setNewListDesc(e.target.value)} placeholder="Descrição opcional..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewList(false)}>Cancelar</Button>
            <Button onClick={createList} disabled={creatingList || !newListName.trim()}>
              {creatingList ? 'Criando...' : 'Criar Lista'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Contact Dialog ─────────────────── */}
      <Dialog open={showAddContact} onOpenChange={setShowAddContact}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Contato</DialogTitle>
            <DialogDescription>Adicione um contato manualmente à lista.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Email *</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@exemplo.com" />
            </div>
            <div>
              <Label>Nome</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome do contato" />
            </div>
            <div>
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={newTags} onChange={e => setNewTags(e.target.value)} placeholder="vip, cliente, lead" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddContact(false)}>Cancelar</Button>
            <Button onClick={addContact} disabled={addingContact || !newEmail.trim()}>
              {addingContact ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CSV Import Dialog ──────────────────── */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Importar CSV
            </DialogTitle>
            <DialogDescription>Mapeie as colunas do seu arquivo e confirme a importação.</DialogDescription>
          </DialogHeader>

          {importResult ? (
            <div className="space-y-3 py-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span className="font-medium">{importResult.imported} contato(s) importado(s)</span>
                </div>
                {importResult.duplicates > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <X className="h-4 w-4" />
                    <span>{importResult.duplicates} duplicado(s) ignorado(s)</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowImport(false); setImportResult(null); }}>Fechar</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Coluna de Email *</Label>
                  <Select value={emailCol} onValueChange={setEmailCol}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Coluna de Nome</Label>
                  <Select value={nameCol} onValueChange={setNameCol}>
                    <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhuma</SelectItem>
                      {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Preview */}
              {csvData.length > 0 && (
                <div className="border rounded-lg overflow-auto max-h-48">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {csvHeaders.map(h => (
                          <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvData.slice(0, 5).map((row, i) => (
                        <TableRow key={i}>
                          {row.map((cell, j) => (
                            <TableCell key={j} className="text-xs py-1">{cell}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="text-xs text-muted-foreground p-2 text-center">
                    Mostrando 5 de {csvData.length} linhas
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowImport(false)}>Cancelar</Button>
                <Button onClick={executeImport} disabled={importing || !emailCol}>
                  {importing ? 'Importando...' : `Importar ${csvData.length} contatos`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contatos?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected.size} contato(s) serão excluídos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
