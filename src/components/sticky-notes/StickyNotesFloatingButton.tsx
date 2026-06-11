import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { StickyNote as StickyIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppViewStore } from "@/stores/whatsappViewStore";
import { useStickyNotes } from "./useStickyNotes";
import { StickyNoteCard } from "./StickyNoteCard";

const HIDE_ON = ["/login", "/checkout", "/register", "/lp/", "/live", "/cat/", "/evento/", "/vip/", "/r/", "/typebot/", "/l/", "/banana-verao", "/dose-tripla", "/checkout-loja", "/livete-anotador"];

export function StickyNotesFloatingButton() {
  const location = useLocation();
  const whatsAppActive = useWhatsAppViewStore((s) => s.activeCount > 0);
  const shouldHide = location.pathname === "/" || whatsAppActive || HIDE_ON.some((p) => location.pathname === p || location.pathname.startsWith(p + "/") || location.pathname.startsWith(p));
  const { isAdmin, ready } = useIsAdmin(!shouldHide);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (shouldHide) return;
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
  }, [shouldHide]);

  const { notes, create, update, remove, focus } = useStickyNotes(!!userId && isAdmin && open, userId);

  if (!ready || !isAdmin) return null;
  if (shouldHide) {
    return null;
  }

  const pendingCount = notes.filter((n) => !n.is_done).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition"
          style={{ background: "hsl(48 95% 50%)", color: "hsl(0 0% 5%)" }}
          title="Tarefas"
        >
          <StickyIcon className="h-5 w-5" />
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full h-5 min-w-[20px] px-1 flex items-center justify-center font-bold">
              {pendingCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[420px] sm:w-[460px] overflow-y-auto p-4">
        <SheetHeader className="mb-3">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <StickyIcon className="h-5 w-5" /> Tarefas
            </SheetTitle>
            <Button size="sm" onClick={create}>
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          </div>
        </SheetHeader>
        <div className="space-y-3">
          {notes.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Sem tarefas. Clique em "Novo" para criar.
            </div>
          )}
          {userId && notes.map((n) => (
            <StickyNoteCard key={n.id} note={n} currentUserId={userId}
              containerMode="floating"
              onUpdate={(p) => update(n.id, p)} onDelete={() => remove(n.id)} onFocus={() => focus(n.id)} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
