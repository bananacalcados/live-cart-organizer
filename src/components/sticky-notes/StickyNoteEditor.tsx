import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListChecks, Type, Pilcrow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// FontSize is provided by @tiptap/extension-text-style v3

const FONTS = [
  { label: "Padrão", value: "" },
  { label: "Serifa", value: "Georgia, serif" },
  { label: "Mono", value: "ui-monospace, monospace" },
  { label: "Manuscrita", value: "'Comic Sans MS', cursive" },
  { label: "Sans", value: "Inter, sans-serif" },
];
const SIZES = ["12px", "14px", "16px", "18px", "22px", "28px", "36px"];

interface Props {
  value: any;
  onChange: (json: any) => void;
  textColor: string;
}

export function StickyNoteEditor({ value, onChange, textColor }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize,
      Placeholder.configure({ placeholder: "Escreva sua tarefa..." }),
    ],
    content: value && Object.keys(value).length ? value : "<p></p>",
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[80px] [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]_p]:my-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:gap-2 [&_ul[data-type=taskList]_li>label]:mt-1",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    dom.style.color = textColor;
  }, [editor, textColor]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `h-7 w-7 p-0 ${active ? "bg-black/10" : ""}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 border-b border-black/10 pb-1.5">
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("taskList"))}
          onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <ListChecks className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().setParagraph().run()}>
          <Pilcrow className="h-3.5 w-3.5" />
        </Button>
        <Select onValueChange={(v) => v === "__reset__"
          ? editor.chain().focus().unsetFontFamily().run()
          : editor.chain().focus().setFontFamily(v).run()
        }>
          <SelectTrigger className="h-7 w-[80px] text-xs px-2"><Type className="h-3 w-3" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__reset__">Padrão</SelectItem>
            {FONTS.filter(f => f.value).map(f => (
              <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={(v) => editor.chain().focus().setMark("textStyle", { fontSize: v }).run()}>
          <SelectTrigger className="h-7 w-[60px] text-xs px-2"><SelectValue placeholder="Aa" /></SelectTrigger>
          <SelectContent>
            {SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="relative h-7 w-7 rounded hover:bg-black/10 cursor-pointer flex items-center justify-center" title="Cor do texto">
          <span className="text-[10px] font-bold" style={{ color: editor.getAttributes("textStyle").color || textColor }}>A</span>
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
            value={editor.getAttributes("textStyle").color || textColor}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
