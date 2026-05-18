import { Plus, StickyNote as StickyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStickyNotes } from "./useStickyNotes";
import { StickyNoteCard } from "./StickyNoteCard";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function StickyNotesBoard() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, []);
  const { notes, create, update, remove, focus } = useStickyNotes(!!userId, userId);

  return (
    <div className="relative w-full" style={{ minHeight: 520 }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2" style={{ color: "hsl(0 0% 95%)" }}>
          <StickyIcon className="h-5 w-5" style={{ color: "hsl(48 95% 50%)" }} />
          Quadro de Tarefas
        </h3>
        <Button onClick={create} size="sm" style={{ background: "hsl(48 95% 50%)", color: "hsl(0 0% 5%)" }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Post-it
        </Button>
      </div>
      <div
        className="relative rounded-lg border border-white/10 overflow-hidden"
        style={{
          minHeight: 520,
          background:
            "repeating-linear-gradient(45deg, hsl(0 0% 8%) 0 12px, hsl(0 0% 9%) 12px 24px)",
        }}
      >
        {notes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm pointer-events-none">
            Clique em "Novo Post-it" para criar sua primeira tarefa
          </div>
        )}
        {userId && notes.map((n) => (
          <StickyNoteCard key={n.id} note={n} currentUserId={userId}
            onUpdate={(p) => update(n.id, p)} onDelete={() => remove(n.id)} onFocus={() => focus(n.id)} />
        ))}
      </div>
    </div>
  );
}
