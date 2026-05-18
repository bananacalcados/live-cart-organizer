import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { StickyNote } from "./StickyNoteCard";

export function useStickyNotes(enabled: boolean, currentUserId: string | null) {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<Map<string, any>>(new Map());

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("sticky_notes")
      .select("*")
      .order("z_index", { ascending: true });
    if (!error) setNotes((data || []) as StickyNote[]);
    setLoading(false);
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!currentUserId) return;
    const maxZ = notes.reduce((m, n) => Math.max(m, n.z_index), 0);
    const { data, error } = await supabase.from("sticky_notes").insert({
      user_id: currentUserId,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      position_x: 40 + (notes.length % 5) * 30,
      position_y: 120 + (notes.length % 5) * 30,
      z_index: maxZ + 1,
    }).select("*").single();
    if (!error && data) setNotes((p) => [...p, data as StickyNote]);
  }, [currentUserId, notes]);

  const update = useCallback((id: string, patch: Partial<StickyNote>) => {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
    const key = id + ":" + Object.keys(patch).join(",");
    if (debounceRef.current.get(key)) clearTimeout(debounceRef.current.get(key));
    const t = setTimeout(async () => {
      await supabase.from("sticky_notes").update(patch as any).eq("id", id);
    }, 400);
    debounceRef.current.set(key, t);
  }, []);

  const remove = useCallback(async (id: string) => {
    setNotes((p) => p.filter((n) => n.id !== id));
    await supabase.from("sticky_notes").delete().eq("id", id);
  }, []);

  const focus = useCallback((id: string) => {
    setNotes((prev) => {
      const maxZ = prev.reduce((m, n) => Math.max(m, n.z_index), 0);
      const target = prev.find((n) => n.id === id);
      if (!target || target.z_index === maxZ) return prev;
      const next = prev.map((n) => n.id === id ? { ...n, z_index: maxZ + 1 } : n);
      supabase.from("sticky_notes").update({ z_index: maxZ + 1 }).eq("id", id);
      return next;
    });
  }, []);

  return { notes, loading, create, update, remove, focus, reload: load };
}
