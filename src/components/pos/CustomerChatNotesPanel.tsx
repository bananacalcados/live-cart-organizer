import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, Plus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { toast } from "sonner";

interface NoteRow {
  id: string;
  note: string;
  author_name: string | null;
  created_at: string;
}

interface CustomerChatNotesPanelProps {
  phone: string;
  storeId: string;
  authorName?: string | null;
  queueSummary?: ReactNode;
}

export function CustomerChatNotesPanel({ phone, storeId, authorName, queueSummary }: CustomerChatNotesPanelProps) {
  const currentUserId = useCurrentUserId();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const suffix8 = phone.replace(/\D/g, "").slice(-8);

  const load = useCallback(async () => {
    if (!suffix8 || !storeId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("customer_chat_notes")
      .select("id,note,author_name,created_at")
      .eq("phone_suffix8", suffix8)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (error) console.error("[CustomerChatNotes] load", error);
    setNotes((data || []) as NoteRow[]);
    setLoading(false);
  }, [storeId, suffix8]);

  useEffect(() => {
    setDraft("");
    setEditing(false);
    void load();
  }, [load]);

  const save = async () => {
    const text = draft.trim();
    if (!text || !currentUserId) return;
    setSaving(true);
    const { data: store, error: storeError } = await supabase
      .from("pos_stores")
      .select("company_id")
      .eq("id", storeId)
      .maybeSingle();
    if (storeError || !store?.company_id) {
      toast.error("A loja precisa estar vinculada à empresa para salvar notas.");
      setSaving(false);
      return;
    }
    const { error } = await supabase.from("customer_chat_notes").insert({
      phone: phone.replace(/\D/g, ""),
      phone_suffix8: suffix8,
      company_id: store.company_id,
      store_id: storeId,
      note: text,
      author_user_id: currentUserId,
      author_name: authorName || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar a nota.");
      return;
    }
    setDraft("");
    setEditing(false);
    await load();
  };

  return (
    <aside className="hidden h-full w-52 shrink-0 flex-col border-r border-border/60 bg-card lg:flex">
      {queueSummary}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <StickyNote className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-bold uppercase">Notas</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {loading ? (
          <Loader2 className="mx-auto mt-4 h-4 w-4 animate-spin text-muted-foreground" />
        ) : notes.length > 0 ? (
          notes.map((item) => (
            <article key={item.id} className="rounded-md border border-amber-300/50 bg-amber-50/80 p-2 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{item.note}</p>
              <p className="mt-2 text-[10px] opacity-65">
                {item.author_name || "Equipe"} · {new Date(item.created_at).toLocaleDateString("pt-BR")}
              </p>
            </article>
          ))
        ) : null}
      </div>
      <div className="shrink-0 border-t border-border/60 p-2">
        {editing ? (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={500} placeholder="Contexto importante sobre este cliente..." autoFocus />
            <div className="flex gap-1">
              <Button size="sm" className="flex-1" onClick={save} disabled={saving || !draft.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(""); }}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => setEditing(true)}>
            <Plus className="h-3.5 w-3.5" /> Adicionar nota
          </Button>
        )}
      </div>
    </aside>
  );
}