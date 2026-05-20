import { Plus } from "lucide-react";
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
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="pointer-events-auto absolute right-0 top-0">
        <Button onClick={create} size="sm" style={{ background: "hsl(48 95% 50%)", color: "hsl(0 0% 5%)" }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Post-it
        </Button>
      </div>

      {notes.length === 0 && (
        <div className="pointer-events-none absolute right-0 top-12 text-xs" style={{ color: "hsl(0 0% 55%)" }}>
          Crie post-its e arraste sobre os módulos
        </div>
      )}

      {userId && notes.map((n) => (
        <StickyNoteCard
          key={n.id}
          note={n}
          currentUserId={userId}
          onUpdate={(p) => update(n.id, p)}
          onDelete={() => remove(n.id)}
          onFocus={() => focus(n.id)}
        />
      ))}
    </div>
  );
}
