import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { useEffect } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const SIZES = ["12px", "14px", "16px", "18px", "22px", "28px", "36px"];

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function RichTextEditor({ value, onChange, minHeight = 100 }: Props) {
  const editor = useEditor({
    extensions: [StarterKit, Underline, TextStyle, FontSize],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none px-3 py-2",
        style: `min-height:${minHeight}px`,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!editor) return null;

  const btn = (active: boolean) => `h-7 w-7 p-0 ${active ? "bg-muted" : ""}`;

  return (
    <div className="border rounded-md bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito">
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico">
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado">
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("strike"))}
          onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado">
          <Strikethrough className="h-3.5 w-3.5" />
        </Button>
        <Select onValueChange={(v) => (editor.chain().focus() as any).setFontSize(v).run()}>
          <SelectTrigger className="h-7 w-[72px] text-xs px-2"><SelectValue placeholder="Aa" /></SelectTrigger>
          <SelectContent>
            {SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
