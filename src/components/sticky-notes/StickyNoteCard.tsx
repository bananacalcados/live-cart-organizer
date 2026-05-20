import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StickyNoteEditor } from "./StickyNoteEditor";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Trash2, X, Calendar as CalendarIcon, Palette, Users, Lock, Check, GripVertical } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export interface StickyNote {
  id: string;
  user_id: string;
  content: any;
  bg_color: string;
  text_color: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  z_index: number;
  deadline: string | null;
  is_shared: boolean;
  is_done: boolean;
  created_at?: string;
}

const PRESET_BG = ["#FEF3C7", "#FCA5A5", "#A7F3D0", "#BFDBFE", "#DDD6FE", "#FBCFE8", "#FDE68A", "#E5E7EB"];
const PRESET_TEXT = ["#1F2937", "#7F1D1D", "#064E3B", "#1E3A8A", "#4C1D95", "#831843", "#000000", "#FFFFFF"];

interface Props {
  note: StickyNote;
  currentUserId: string;
  onUpdate: (patch: Partial<StickyNote>) => void;
  onDelete: () => void;
  onFocus: () => void;
  containerMode?: "home" | "floating";
}

export function StickyNoteCard({ note, currentUserId, onUpdate, onDelete, onFocus, containerMode = "home" }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const [local, setLocal] = useState({ x: note.position_x, y: note.position_y, w: note.width, h: note.height });
  const isOwner = note.user_id === currentUserId;

  useEffect(() => {
    setLocal({ x: note.position_x, y: note.position_y, w: note.width, h: note.height });
  }, [note.position_x, note.position_y, note.width, note.height]);

  const onDragStart = (e: React.PointerEvent) => {
    if (!isOwner) return;
    onFocus();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: local.x, origY: local.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragState.current) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setLocal((p) => ({ ...p, x: Math.max(0, dragState.current!.origX + dx), y: Math.max(0, dragState.current!.origY + dy) }));
    } else if (resizeState.current) {
      const dx = e.clientX - resizeState.current.startX;
      const dy = e.clientY - resizeState.current.startY;
      setLocal((p) => ({ ...p, w: Math.max(220, resizeState.current!.origW + dx), h: Math.max(180, resizeState.current!.origH + dy) }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragState.current) {
      onUpdate({ position_x: Math.round(local.x), position_y: Math.round(local.y) });
      dragState.current = null;
    }
    if (resizeState.current) {
      onUpdate({ width: Math.round(local.w), height: Math.round(local.h) });
      resizeState.current = null;
    }
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };
  const onResizeStart = (e: React.PointerEvent) => {
    if (!isOwner) return;
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: local.w, origH: local.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const overdue = note.deadline && new Date(note.deadline) < new Date() && !note.is_done;

  return (
    <div
      ref={cardRef}
      className={cn(
        "absolute rounded-md shadow-lg flex flex-col select-none",
        containerMode === "floating" ? "!relative !left-0 !top-0 mb-3 w-full" : "",
        note.is_done && "opacity-60"
      )}
      style={containerMode === "home" ? {
        left: local.x, top: local.y, width: local.w, height: local.h,
        background: note.bg_color, color: note.text_color, zIndex: note.z_index,
        boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
        transform: "rotate(-0.4deg)",
      } : {
        background: note.bg_color, color: note.text_color, minHeight: 200,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseDown={onFocus}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b border-black/10"
        onPointerDown={containerMode === "home" ? onDragStart : undefined}
        style={{ cursor: containerMode === "home" && isOwner ? "grab" : "default" }}
      >
        <div className="flex items-center gap-1 text-xs opacity-70">
          <GripVertical className="h-3 w-3" />
          {!isOwner && <span className="italic">compartilhado</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {isOwner && (
            <>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-black/10"
                onClick={() => onUpdate({ is_done: !note.is_done })} title="Marcar concluído">
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-black/10"
                onClick={() => onUpdate({ is_shared: !note.is_shared })}
                title={note.is_shared ? "Tornar privada" : "Compartilhar com admins"}>
                {note.is_shared ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-black/10" title="Cores">
                    <Palette className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3 space-y-2">
                  <div>
                    <div className="text-xs font-medium mb-1.5">Fundo</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_BG.map(c => (
                        <button key={c} onClick={() => onUpdate({ bg_color: c })}
                          className="w-6 h-6 rounded border border-border" style={{ background: c }} />
                      ))}
                      <input type="color" value={note.bg_color}
                        onChange={(e) => onUpdate({ bg_color: e.target.value })}
                        className="w-6 h-6 rounded border border-border cursor-pointer" />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-1.5">Texto (padrão)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_TEXT.map(c => (
                        <button key={c} onClick={() => onUpdate({ text_color: c })}
                          className="w-6 h-6 rounded border border-border" style={{ background: c }} />
                      ))}
                      <input type="color" value={note.text_color}
                        onChange={(e) => onUpdate({ text_color: e.target.value })}
                        className="w-6 h-6 rounded border border-border cursor-pointer" />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className={cn("h-6 w-6 p-0 hover:bg-black/10", overdue && "text-red-700")} title="Prazo">
                    <CalendarIcon className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single"
                    selected={note.deadline ? new Date(note.deadline) : undefined}
                    onSelect={(d) => onUpdate({ deadline: d ? d.toISOString() : null })}
                    initialFocus className="p-3 pointer-events-auto" />
                  {note.deadline && (
                    <div className="p-2 border-t flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => onUpdate({ deadline: null })}>Remover</Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-black/10 text-red-700"
                onClick={onDelete} title="Excluir">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-2">
        {isOwner ? (
          <StickyNoteEditor
            value={note.content}
            onChange={(json) => onUpdate({ content: json })}
            textColor={note.text_color}
          />
        ) : (
          <div className="prose prose-sm max-w-none" style={{ color: note.text_color }}
            dangerouslySetInnerHTML={{ __html: contentToReadOnlyHtml(note.content) }} />
        )}
      </div>

      {/* Footer */}
      {note.deadline && (
        <div className={cn("px-2 py-1 text-xs border-t border-black/10", overdue ? "bg-red-200 text-red-900" : "")}>
          Prazo: {format(new Date(note.deadline), "dd/MM/yyyy", { locale: ptBR })}
          {overdue && " (atrasado)"}
        </div>
      )}

      {/* Resize handle */}
      {containerMode === "home" && isOwner && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize opacity-50 hover:opacity-100"
          style={{ background: "linear-gradient(135deg, transparent 50%, currentColor 50%)" }}
          onPointerDown={onResizeStart}
        />
      )}
    </div>
  );
}

// Very simple TipTap JSON → HTML for read-only rendering of shared notes
function contentToReadOnlyHtml(json: any): string {
  if (!json || !json.content) return "";
  const renderNode = (n: any): string => {
    if (n.type === "text") {
      let t = escapeHtml(n.text || "");
      const marks = n.marks || [];
      for (const m of marks) {
        if (m.type === "bold") t = `<strong>${t}</strong>`;
        else if (m.type === "italic") t = `<em>${t}</em>`;
        else if (m.type === "underline") t = `<u>${t}</u>`;
        else if (m.type === "textStyle") {
          const style: string[] = [];
          if (m.attrs?.color) style.push(`color:${m.attrs.color}`);
          if (m.attrs?.fontFamily) style.push(`font-family:${m.attrs.fontFamily}`);
          if (m.attrs?.fontSize) style.push(`font-size:${m.attrs.fontSize}`);
          if (style.length) t = `<span style="${style.join(";")}">${t}</span>`;
        }
      }
      return t;
    }
    const inner = (n.content || []).map(renderNode).join("");
    switch (n.type) {
      case "paragraph": return `<p>${inner || "<br/>"}</p>`;
      case "bulletList": return `<ul>${inner}</ul>`;
      case "orderedList": return `<ol>${inner}</ol>`;
      case "listItem": return `<li>${inner}</li>`;
      case "taskList": return `<ul style="list-style:none;padding-left:0">${inner}</ul>`;
      case "taskItem": return `<li style="display:flex;gap:.5rem"><input type="checkbox" disabled ${n.attrs?.checked ? "checked" : ""}/> <span>${inner}</span></li>`;
      case "heading": return `<h${n.attrs?.level || 2}>${inner}</h${n.attrs?.level || 2}>`;
      default: return inner;
    }
  };
  return (json.content || []).map(renderNode).join("");
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
