import { useRef, useCallback } from "react";
import { Bold, Italic, Strikethrough } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";

interface WhatsAppFormattingToolbarProps {
  value: string;
  onChange: (value: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  className?: string;
}

export function WhatsAppFormattingToolbar({ value, onChange, textareaRef, className }: WhatsAppFormattingToolbarProps) {
  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    const textarea = textareaRef?.current;
    if (!textarea) {
      // If no ref, just append
      onChange(value + prefix + suffix);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);

    if (selectedText) {
      // Wrap selected text
      const newText = value.substring(0, start) + prefix + selectedText + suffix + value.substring(end);
      onChange(newText);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, end + prefix.length);
      }, 0);
    } else {
      // Insert markers at cursor
      const newText = value.substring(0, start) + prefix + suffix + value.substring(end);
      onChange(newText);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, start + prefix.length);
      }, 0);
    }
  }, [value, onChange, textareaRef]);

  const insertEmoji = useCallback((emoji: string) => {
    const textarea = textareaRef?.current;
    if (!textarea) {
      onChange(value + emoji);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = value.substring(0, start) + emoji + value.substring(end);
    onChange(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }, [value, onChange, textareaRef]);

  return (
    <div className={`flex items-center gap-0.5 ${className || ''}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Negrito"
        onClick={() => wrapSelection("*", "*")}
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Itálico"
        onClick={() => wrapSelection("_", "_")}
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Tachado"
        onClick={() => wrapSelection("~", "~")}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Button>
      <EmojiPickerButton onEmojiSelect={insertEmoji} className="h-7 w-7" />
    </div>
  );
}
