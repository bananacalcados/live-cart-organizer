import { useState, useEffect } from 'react';
import { Plus, Pencil, Copy, Trash2, Mail, Calendar, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EmailBuilder } from './EmailBuilder';
import { EmailBlock } from './types';
import { generateEmailHTML } from './generateEmailHTML';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  blocks: EmailBlock[] | null;
  html_content: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export function EmailTemplateManager() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmailTemplate | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<600 | 375>(600);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar templates');
    } else {
      setTemplates((data as any[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleCreate = () => {
    setEditingTemplate(null);
    setIsCreating(true);
  };

  const handleEdit = (t: EmailTemplate) => {
    setEditingTemplate(t);
    setIsCreating(true);
  };

  const handleDuplicate = async (t: EmailTemplate) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('email_templates').insert({
      name: `Cópia de ${t.name}`,
      subject: t.subject,
      blocks: t.blocks as any,
      html_content: t.html_content,
      thumbnail_url: t.thumbnail_url,
      user_id: user.id,
    });

    if (error) {
      toast.error('Erro ao duplicar: ' + error.message);
    } else {
      toast.success('Template duplicado!');
      fetchTemplates();
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    // Check if linked to a campaign
    const { data: linked } = await supabase
      .from('email_campaigns')
      .select('id')
      .eq('template_id', deleteTarget.id)
      .limit(1);

    if (linked && linked.length > 0) {
      toast.error('Este template está vinculado a uma campanha e não pode ser excluído.');
      setDeleteTarget(null);
      return;
    }

    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Erro ao excluir: ' + error.message);
    } else {
      toast.success('Template excluído!');
      fetchTemplates();
    }
    setDeleteTarget(null);
  };

  const handleSave = async (name: string, subject: string, blocks: EmailBlock[], html: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Faça login para salvar'); return; }

    if (editingTemplate) {
      const { error } = await supabase
        .from('email_templates')
        .update({
          name,
          subject,
          blocks: blocks as any,
          html_content: html,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingTemplate.id);

      if (error) { toast.error('Erro ao salvar: ' + error.message); return; }
      toast.success('Template atualizado!');
    } else {
      const { error } = await supabase
        .from('email_templates')
        .insert({
          name,
          subject,
          blocks: blocks as any,
          html_content: html,
          user_id: user.id,
        });

      if (error) { toast.error('Erro ao salvar: ' + error.message); return; }
      toast.success('Template criado!');
    }

    setIsCreating(false);
    setEditingTemplate(null);
    fetchTemplates();
  };

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.subject && t.subject.toLowerCase().includes(search.toLowerCase()))
  );

  if (isCreating) {
    return (
      <EmailBuilder
        initialBlocks={editingTemplate?.blocks as EmailBlock[] || undefined}
        initialName={editingTemplate?.name || ''}
        initialSubject={editingTemplate?.subject || ''}
        onSave={handleSave}
        onBack={() => { setIsCreating(false); setEditingTemplate(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Template
        </Button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-32 bg-muted rounded mb-3" />
                <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Mail className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-medium">Nenhum template encontrado</p>
            <p className="text-sm mt-1">Crie seu primeiro template de email</p>
            <Button onClick={handleCreate} variant="outline" className="mt-4 gap-2">
              <Plus className="h-4 w-4" />
              Criar Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <Card key={t.id} className="group hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                {/* Thumbnail / Preview */}
                <div className="h-36 bg-muted rounded overflow-hidden relative">
                  {t.html_content ? (
                    <iframe
                      srcDoc={t.html_content}
                      title={t.name}
                      className="w-full h-full pointer-events-none"
                      sandbox=""
                      style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%' }}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Mail className="h-8 w-8 opacity-30" />
                    </div>
                  )}
                  {/* Overlay actions */}
                  <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button size="sm" variant="secondary" className="gap-1 text-xs" onClick={() => handleEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1 text-xs"
                      onClick={() => {
                        if (t.html_content) {
                          setPreviewHtml(t.html_content);
                          setPreviewWidth(600);
                        }
                      }}
                    >
                      Visualizar
                    </Button>
                  </div>
                </div>

                {/* Info */}
                <div>
                  <h4 className="font-semibold text-sm truncate">{t.name}</h4>
                  {t.subject && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">Assunto: {t.subject}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(t.created_at), "dd 'de' MMM, yyyy", { locale: ptBR })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 pt-1 border-t">
                  <Button size="sm" variant="ghost" className="gap-1 text-xs flex-1" onClick={() => handleEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-xs flex-1" onClick={() => handleDuplicate(t)}>
                    <Copy className="h-3.5 w-3.5" /> Duplicar
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-xs text-destructive hover:text-destructive" onClick={() => setDeleteTarget(t)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewHtml} onOpenChange={() => setPreviewHtml(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Preview do Email</h3>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={previewWidth === 600 ? 'default' : 'outline'}
                className="text-xs"
                onClick={() => setPreviewWidth(600)}
              >
                Desktop
              </Button>
              <Button
                size="sm"
                variant={previewWidth === 375 ? 'default' : 'outline'}
                className="text-xs"
                onClick={() => setPreviewWidth(375)}
              >
                Mobile
              </Button>
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 overflow-auto max-h-[70vh] flex justify-center">
            <iframe
              srcDoc={previewHtml || ''}
              title="Email Preview"
              className="border rounded bg-white transition-all"
              style={{ width: previewWidth, minHeight: 500 }}
              sandbox=""
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o template "{deleteTarget?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
