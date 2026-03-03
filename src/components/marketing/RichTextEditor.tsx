import { useState, useRef, useCallback } from "react";
import { Bold, Italic, Heading1, Heading2, Heading3, List, CheckSquare, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}

/**
 * A simple rich-text-like editor that stores markdown-style content.
 * Supports: headings (#, ##, ###), bold (**), italic (*), bullet lists (-), task checkboxes ([ ] / [x]).
 * Renders a live preview below the textarea.
 */
export function RichTextEditor({ value, onChange, placeholder = "Escreva aqui...", minRows = 4, className }: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = useCallback((prefix: string, suffix = "") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    const newText = value.substring(0, start) + prefix + selected + suffix + value.substring(end);
    onChange(newText);
    setTimeout(() => {
      ta.focus();
      const pos = start + prefix.length + selected.length + suffix.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }, [value, onChange]);

  const wrapSelection = useCallback((wrapper: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    if (selected) {
      const newText = value.substring(0, start) + wrapper + selected + wrapper + value.substring(end);
      onChange(newText);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(start, end + wrapper.length * 2); }, 0);
    } else {
      insertAtCursor(wrapper, wrapper);
    }
  }, [value, onChange, insertAtCursor]);

  const insertNewLine = useCallback((prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    // Find line start
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const before = value.substring(0, lineStart);
    const after = value.substring(lineStart);
    const needsNewline = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const newText = before + needsNewline + prefix + after;
    onChange(newText);
    setTimeout(() => { ta.focus(); const pos = lineStart + needsNewline.length + prefix.length; ta.setSelectionRange(pos, pos); }, 0);
  }, [value, onChange]);

  const insertEmoji = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) { onChange(value + emoji); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = value.substring(0, start) + emoji + value.substring(end);
    onChange(newText);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + emoji.length, start + emoji.length); }, 0);
  }, [value, onChange]);

  return (
    <div className={cn("space-y-1", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap border rounded-md p-1 bg-muted/30">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Título"
          onClick={() => insertNewLine("# ")}>
          <Heading1 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Subtítulo"
          onClick={() => insertNewLine("## ")}>
          <Heading2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Sub-subtítulo"
          onClick={() => insertNewLine("### ")}>
          <Heading3 className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-5 bg-border mx-0.5" />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Negrito"
          onClick={() => wrapSelection("**")}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Itálico"
          onClick={() => wrapSelection("*")}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-5 bg-border mx-0.5" />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Lista"
          onClick={() => insertNewLine("- ")}>
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Tarefa"
          onClick={() => insertNewLine("[ ] ")}>
          <CheckSquare className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-5 bg-border mx-0.5" />
        <EmojiPickerButton onEmojiSelect={insertEmoji} className="h-7 w-7" />
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={minRows}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
      />
    </div>
  );
}

/**
 * Renders markdown-like content with formatting, supporting task checkboxes that can be toggled.
 */
export function RichTextPreview({ content, onToggleTask, className }: { content: string; onToggleTask?: (lineIndex: number) => void; className?: string }) {
  if (!content) return null;

  const lines = content.split('\n');

  return (
    <div className={cn("space-y-0.5 text-sm", className)}>
      {lines.map((line, i) => {
        const trimmed = line.trimStart();

        // Task checkbox
        if (trimmed.startsWith('[x] ') || trimmed.startsWith('[ ] ')) {
          const done = trimmed.startsWith('[x]');
          const text = trimmed.substring(4);
          return (
            <label key={i} className="flex items-start gap-2 cursor-pointer group py-0.5" onClick={() => onToggleTask?.(i)}>
              <input type="checkbox" checked={done} readOnly className="mt-0.5 h-4 w-4 rounded border-input accent-primary cursor-pointer" />
              <span className={cn("flex-1", done && "line-through text-muted-foreground")}>{renderInline(text)}</span>
            </label>
          );
        }

        // Headings
        if (trimmed.startsWith('### ')) return <h4 key={i} className="font-semibold text-sm mt-2">{renderInline(trimmed.substring(4))}</h4>;
        if (trimmed.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-2">{renderInline(trimmed.substring(3))}</h3>;
        if (trimmed.startsWith('# ')) return <h2 key={i} className="font-bold text-lg mt-2">{renderInline(trimmed.substring(2))}</h2>;

        // Bullet list
        if (trimmed.startsWith('- ')) return <div key={i} className="flex gap-2 py-0.5"><span>•</span><span>{renderInline(trimmed.substring(2))}</span></div>;

        // Empty line
        if (!trimmed) return <div key={i} className="h-2" />;

        // Regular paragraph
        return <p key={i} className="py-0.5">{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Simple bold/italic parser
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Italic
    const italicMatch = remaining.match(/\*(.+?)\*/);

    const match = boldMatch && (!italicMatch || (boldMatch.index ?? 999) <= (italicMatch.index ?? 999)) ? boldMatch : italicMatch;

    if (match && match.index !== undefined) {
      if (match.index > 0) {
        parts.push(<span key={key++}>{remaining.substring(0, match.index)}</span>);
      }
      if (match[0].startsWith('**')) {
        parts.push(<strong key={key++}>{match[1]}</strong>);
      } else {
        parts.push(<em key={key++}>{match[1]}</em>);
      }
      remaining = remaining.substring(match.index + match[0].length);
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
