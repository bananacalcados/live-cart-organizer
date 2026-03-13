import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUp, ArrowDown, Copy, Trash2, GripVertical,
  Type, Image, MousePointerClick, Minus, Space,
  LayoutTemplate, FileText, ArrowLeft, Eye, Code, Plus,
  Bold, Italic, Link, AlignLeft, AlignCenter, AlignRight,
  ChevronLeft, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  EmailBlock,
  EmailBlockType,
  EmailBlockProps,
  HeaderBlockProps,
  TextBlockProps,
  ImageBlockProps,
  ButtonBlockProps,
  DividerBlockProps,
  SpacerBlockProps,
  FooterBlockProps,
  DEFAULT_BLOCK_PROPS,
  BLOCK_LABELS,
  PERSONALIZATION_VARS,
} from './types';
import { generateEmailHTML } from './generateEmailHTML';

// ─── Block Icons ───
const BLOCK_ICONS: Record<EmailBlockType, React.ReactNode> = {
  header: <LayoutTemplate className="h-5 w-5" />,
  text: <Type className="h-5 w-5" />,
  image: <Image className="h-5 w-5" />,
  button: <MousePointerClick className="h-5 w-5" />,
  divider: <Minus className="h-5 w-5" />,
  spacer: <Space className="h-5 w-5" />,
  footer: <FileText className="h-5 w-5" />,
};

// ─── Highlight personalization variables ───
function highlightVars(text: string): string {
  return text.replace(
    /\{\{(nome|email|empresa)\}\}/gi,
    '<span style="background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;font-weight:600;">{{$1}}</span>'
  );
}

// ─── Sortable Block Wrapper ───
function SortableBlock({
  block,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  isFirst,
  isLast,
}: {
  block: EmailBlock;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative border-2 rounded-lg transition-colors cursor-pointer ${
        isSelected ? 'border-primary shadow-md' : 'border-transparent hover:border-muted-foreground/20'
      }`}
      onClick={onSelect}
    >
      {/* Toolbar */}
      <div className={`absolute -top-3 right-2 flex items-center gap-0.5 bg-card border rounded-md shadow-sm px-1 py-0.5 z-10 ${
        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      } transition-opacity`}>
        <button {...attributes} {...listeners} className="p-1 hover:bg-muted rounded cursor-grab">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} className="p-1 hover:bg-muted rounded disabled:opacity-30">
          <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} className="p-1 hover:bg-muted rounded disabled:opacity-30">
          <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-1 hover:bg-muted rounded">
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 hover:bg-destructive/10 rounded">
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </button>
      </div>

      {/* Block Preview */}
      <div className="p-1">
        <BlockPreview block={block} />
      </div>
    </div>
  );
}

// ─── Block Preview (in canvas) ───
function BlockPreview({ block }: { block: EmailBlock }) {
  const p = block.props;

  switch (block.type) {
    case 'header': {
      const hp = p as HeaderBlockProps;
      return (
        <div style={{ backgroundColor: hp.backgroundColor, textAlign: hp.alignment as any }} className="p-5 rounded">
          {hp.logoUrl ? (
            <img src={hp.logoUrl} alt={hp.logoAlt} style={{ width: hp.logoWidth }} className="inline-block" />
          ) : (
            <span className="text-xl font-bold text-muted-foreground">{hp.logoAlt || 'Adicione um logo'}</span>
          )}
        </div>
      );
    }
    case 'text': {
      const tp = p as TextBlockProps;
      return (
        <div
          style={{
            fontSize: tp.fontSize,
            color: tp.color,
            textAlign: tp.alignment as any,
            backgroundColor: tp.backgroundColor,
            padding: `${tp.paddingY}px ${tp.paddingX}px`,
          }}
          className="rounded"
          dangerouslySetInnerHTML={{ __html: highlightVars(tp.content) }}
        />
      );
    }
    case 'image': {
      const ip = p as ImageBlockProps;
      return (
        <div style={{ textAlign: ip.alignment as any }} className="p-2">
          {ip.src ? (
            <img src={ip.src} alt={ip.alt} style={{ width: ip.width, maxWidth: '100%' }} className="inline-block rounded" />
          ) : (
            <div className="h-32 bg-muted rounded flex items-center justify-center text-muted-foreground">
              <Image className="h-8 w-8" />
            </div>
          )}
        </div>
      );
    }
    case 'button': {
      const bp = p as ButtonBlockProps;
      return (
        <div style={{ textAlign: bp.alignment as any }} className="p-4">
          <span
            style={{
              display: 'inline-block',
              backgroundColor: bp.backgroundColor,
              color: bp.textColor,
              fontSize: bp.fontSize,
              fontWeight: 600,
              padding: `${bp.paddingY}px ${bp.paddingX}px`,
              borderRadius: bp.borderRadius,
              textDecoration: 'none',
            }}
          >
            {highlightVars(bp.text)}
          </span>
        </div>
      );
    }
    case 'divider': {
      const dp = p as DividerBlockProps;
      return (
        <div className="px-5 py-2">
          <hr style={{ borderTop: `${dp.thickness}px ${dp.style} ${dp.color}`, width: dp.width }} className="mx-auto" />
        </div>
      );
    }
    case 'spacer': {
      const sp = p as SpacerBlockProps;
      return <div style={{ height: sp.height }} className="bg-muted/20 rounded flex items-center justify-center text-xs text-muted-foreground">{sp.height}px</div>;
    }
    case 'footer': {
      const fp = p as FooterBlockProps;
      return (
        <div style={{ backgroundColor: fp.backgroundColor, color: fp.color, fontSize: fp.fontSize }} className="p-4 text-center rounded">
          <span dangerouslySetInnerHTML={{ __html: highlightVars(fp.content) }} />
          {fp.showUnsubscribe && (
            <div className="mt-2 underline">{fp.unsubscribeText}</div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

// ─── Properties Panel ───
function BlockPropertiesPanel({
  block,
  onChange,
  onClose,
}: {
  block: EmailBlock;
  onChange: (props: EmailBlockProps) => void;
  onClose: () => void;
}) {
  const p = block.props;
  const label = BLOCK_LABELS[block.type];

  const update = (partial: Partial<EmailBlockProps>) => {
    onChange({ ...p, ...partial } as EmailBlockProps);
  };

  const AlignmentButtons = ({ value, onSet }: { value: string; onSet: (v: string) => void }) => (
    <div className="flex gap-1">
      {['left', 'center', 'right'].map((a) => (
        <Button key={a} size="icon" variant={value === a ? 'default' : 'outline'} className="h-8 w-8" onClick={() => onSet(a)}>
          {a === 'left' ? <AlignLeft className="h-3.5 w-3.5" /> : a === 'center' ? <AlignCenter className="h-3.5 w-3.5" /> : <AlignRight className="h-3.5 w-3.5" />}
        </Button>
      ))}
    </div>
  );

  const VarsInsert = ({ onInsert }: { onInsert: (v: string) => void }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3" /> Variáveis</Label>
      <div className="flex flex-wrap gap-1">
        {PERSONALIZATION_VARS.map((v) => (
          <Badge key={v.key} variant="secondary" className="cursor-pointer text-xs hover:bg-primary/20" onClick={() => onInsert(v.key)}>
            {v.label}
          </Badge>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <h3 className="font-semibold text-sm">{label.label}</h3>
          <p className="text-xs text-muted-foreground">{label.description}</p>
        </div>
      </div>

      <div className="space-y-3">
        {block.type === 'header' && (() => {
          const hp = p as HeaderBlockProps;
          return (
            <>
              <div><Label className="text-xs">URL do Logo</Label><Input value={hp.logoUrl} onChange={(e) => update({ logoUrl: e.target.value })} placeholder="https://..." className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Alt Text</Label><Input value={hp.logoAlt} onChange={(e) => update({ logoAlt: e.target.value })} className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Largura do Logo ({hp.logoWidth}px)</Label><Slider value={[hp.logoWidth]} onValueChange={([v]) => update({ logoWidth: v })} min={50} max={400} step={10} /></div>
              <div><Label className="text-xs">Cor de Fundo</Label><Input type="color" value={hp.backgroundColor} onChange={(e) => update({ backgroundColor: e.target.value })} className="h-8 w-full" /></div>
              <div><Label className="text-xs">Alinhamento</Label><AlignmentButtons value={hp.alignment} onSet={(v) => update({ alignment: v as any })} /></div>
            </>
          );
        })()}

        {block.type === 'text' && (() => {
          const tp = p as TextBlockProps;
          return (
            <>
              <div>
                <Label className="text-xs">Conteúdo</Label>
                <Textarea value={tp.content.replace(/<[^>]+>/g, '')} onChange={(e) => update({ content: `<p>${e.target.value}</p>` })} rows={4} className="text-sm" />
              </div>
              <VarsInsert onInsert={(v) => update({ content: tp.content.replace('</p>', `${v}</p>`) })} />
              <div><Label className="text-xs">Tamanho ({tp.fontSize}px)</Label><Slider value={[tp.fontSize]} onValueChange={([v]) => update({ fontSize: v })} min={10} max={48} /></div>
              <div><Label className="text-xs">Cor do Texto</Label><Input type="color" value={tp.color} onChange={(e) => update({ color: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Cor de Fundo</Label><Input type="color" value={tp.backgroundColor === 'transparent' ? '#ffffff' : tp.backgroundColor} onChange={(e) => update({ backgroundColor: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Alinhamento</Label><AlignmentButtons value={tp.alignment} onSet={(v) => update({ alignment: v as any })} /></div>
              <div><Label className="text-xs">Padding Vertical ({tp.paddingY}px)</Label><Slider value={[tp.paddingY]} onValueChange={([v]) => update({ paddingY: v })} min={0} max={60} /></div>
              <div><Label className="text-xs">Padding Horizontal ({tp.paddingX}px)</Label><Slider value={[tp.paddingX]} onValueChange={([v]) => update({ paddingX: v })} min={0} max={60} /></div>
            </>
          );
        })()}

        {block.type === 'image' && (() => {
          const ip = p as ImageBlockProps;
          return (
            <>
              <div><Label className="text-xs">URL da Imagem</Label><Input value={ip.src} onChange={(e) => update({ src: e.target.value })} placeholder="https://..." className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Alt Text</Label><Input value={ip.alt} onChange={(e) => update({ alt: e.target.value })} className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Link (ao clicar)</Label><Input value={ip.linkUrl} onChange={(e) => update({ linkUrl: e.target.value })} placeholder="https://..." className="h-8 text-sm" /></div>
              <div>
                <Label className="text-xs">Largura</Label>
                <Select value={ip.width} onValueChange={(v) => update({ width: v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100%">100%</SelectItem>
                    <SelectItem value="75%">75%</SelectItem>
                    <SelectItem value="50%">50%</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Alinhamento</Label><AlignmentButtons value={ip.alignment} onSet={(v) => update({ alignment: v as any })} /></div>
            </>
          );
        })()}

        {block.type === 'button' && (() => {
          const bp = p as ButtonBlockProps;
          return (
            <>
              <div><Label className="text-xs">Texto do Botão</Label><Input value={bp.text} onChange={(e) => update({ text: e.target.value })} className="h-8 text-sm" /></div>
              <VarsInsert onInsert={(v) => update({ text: bp.text + v })} />
              <div><Label className="text-xs">URL</Label><Input value={bp.url} onChange={(e) => update({ url: e.target.value })} className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Cor de Fundo</Label><Input type="color" value={bp.backgroundColor} onChange={(e) => update({ backgroundColor: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Cor do Texto</Label><Input type="color" value={bp.textColor} onChange={(e) => update({ textColor: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Alinhamento</Label><AlignmentButtons value={bp.alignment} onSet={(v) => update({ alignment: v as any })} /></div>
              <div><Label className="text-xs">Raio da Borda ({bp.borderRadius}px)</Label><Slider value={[bp.borderRadius]} onValueChange={([v]) => update({ borderRadius: v })} min={0} max={30} /></div>
              <div><Label className="text-xs">Tamanho da Fonte ({bp.fontSize}px)</Label><Slider value={[bp.fontSize]} onValueChange={([v]) => update({ fontSize: v })} min={12} max={24} /></div>
            </>
          );
        })()}

        {block.type === 'divider' && (() => {
          const dp = p as DividerBlockProps;
          return (
            <>
              <div><Label className="text-xs">Cor</Label><Input type="color" value={dp.color} onChange={(e) => update({ color: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Espessura ({dp.thickness}px)</Label><Slider value={[dp.thickness]} onValueChange={([v]) => update({ thickness: v })} min={1} max={8} /></div>
              <div>
                <Label className="text-xs">Estilo</Label>
                <Select value={dp.style} onValueChange={(v) => update({ style: v as any })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">Sólido</SelectItem>
                    <SelectItem value="dashed">Tracejado</SelectItem>
                    <SelectItem value="dotted">Pontilhado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          );
        })()}

        {block.type === 'spacer' && (() => {
          const sp = p as SpacerBlockProps;
          return (
            <div><Label className="text-xs">Altura ({sp.height}px)</Label><Slider value={[sp.height]} onValueChange={([v]) => update({ height: v })} min={5} max={100} /></div>
          );
        })()}

        {block.type === 'footer' && (() => {
          const fp = p as FooterBlockProps;
          return (
            <>
              <div><Label className="text-xs">Conteúdo</Label><Textarea value={fp.content} onChange={(e) => update({ content: e.target.value })} rows={3} className="text-sm" /></div>
              <VarsInsert onInsert={(v) => update({ content: fp.content + v })} />
              <div><Label className="text-xs">Cor do Texto</Label><Input type="color" value={fp.color} onChange={(e) => update({ color: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Cor de Fundo</Label><Input type="color" value={fp.backgroundColor} onChange={(e) => update({ backgroundColor: e.target.value })} className="h-8" /></div>
              <div><Label className="text-xs">Tamanho ({fp.fontSize}px)</Label><Slider value={[fp.fontSize]} onValueChange={([v]) => update({ fontSize: v })} min={8} max={18} /></div>
              <div className="flex items-center gap-2">
                <Switch checked={fp.showUnsubscribe} onCheckedChange={(v) => update({ showUnsubscribe: v })} />
                <Label className="text-xs">Link de Descadastro</Label>
              </div>
              {fp.showUnsubscribe && (
                <div><Label className="text-xs">Texto do Link</Label><Input value={fp.unsubscribeText} onChange={(e) => update({ unsubscribeText: e.target.value })} className="h-8 text-sm" /></div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Main EmailBuilder Component ───
interface EmailBuilderProps {
  initialBlocks?: EmailBlock[];
  initialName?: string;
  initialSubject?: string;
  onSave?: (name: string, subject: string, blocks: EmailBlock[], html: string) => void;
  onBack?: () => void;
}

export function EmailBuilder({ initialBlocks, initialName = '', initialSubject = '', onSave, onBack }: EmailBuilderProps) {
  const [blocks, setBlocks] = useState<EmailBlock[]>(initialBlocks || []);
  const [templateName, setTemplateName] = useState(initialName);
  const [templateSubject, setTemplateSubject] = useState(initialSubject);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId);

  const addBlock = useCallback((type: EmailBlockType) => {
    const newBlock: EmailBlock = {
      id: crypto.randomUUID(),
      type,
      props: JSON.parse(JSON.stringify(DEFAULT_BLOCK_PROPS[type])),
    };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedBlockId(newBlock.id);
  }, []);

  const updateBlockProps = useCallback((id: string, props: EmailBlockProps) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, props } : b)));
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  }, [selectedBlockId]);

  const duplicateBlock = useCallback((id: string) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return prev;
      const dup = { ...prev[idx], id: crypto.randomUUID(), props: JSON.parse(JSON.stringify(prev[idx].props)) };
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });
  }, []);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      return arrayMove(prev, idx, newIdx);
    });
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setBlocks((prev) => {
        const oldIndex = prev.findIndex((b) => b.id === active.id);
        const newIndex = prev.findIndex((b) => b.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const html = generateEmailHTML(blocks);

  const handleSave = () => {
    if (!templateName.trim()) {
      toast.error('Digite um nome para o template');
      return;
    }
    onSave?.(templateName, templateSubject, blocks, html);
  };

  const blockTypes: EmailBlockType[] = ['header', 'text', 'image', 'button', 'divider', 'spacer', 'footer'];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[500px] bg-background rounded-lg border overflow-hidden">
      {/* Name & Subject bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-card">
        {onBack && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <Input
          placeholder="Nome do template *"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="h-8 text-sm max-w-[220px]"
        />
        <Input
          placeholder="Assunto do email"
          value={templateSubject}
          onChange={(e) => setTemplateSubject(e.target.value)}
          className="h-8 text-sm flex-1 min-w-[180px]"
        />
      </div>
      <div className="flex flex-1 overflow-hidden">
      {/* ── Left Panel ── */}
      <div className="w-[280px] border-r bg-card flex flex-col">
        <div className="p-3 border-b">
          <h3 className="font-semibold text-sm">
            {selectedBlock ? 'Propriedades' : 'Blocos'}
          </h3>
        </div>
        <ScrollArea className="flex-1 p-3">
          {selectedBlock ? (
            <BlockPropertiesPanel
              block={selectedBlock}
              onChange={(props) => updateBlockProps(selectedBlock.id, props)}
              onClose={() => setSelectedBlockId(null)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {blockTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-colors text-center"
                >
                  <div className="text-muted-foreground">{BLOCK_ICONS[type]}</div>
                  <span className="text-xs font-medium">{BLOCK_LABELS[type].label}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Personalization Variables */}
        {!selectedBlock && (
          <div className="p-3 border-t space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Variáveis disponíveis
            </Label>
            <div className="flex flex-wrap gap-1">
              {PERSONALIZATION_VARS.map((v) => (
                <Badge key={v.key} variant="outline" className="text-xs">
                  {v.key}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
          <span className="text-sm text-muted-foreground">{blocks.length} blocos</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setCodeOpen(true)}>
              <Code className="h-3.5 w-3.5" /> HTML
            </Button>
            <Button size="sm" className="gap-1 text-xs" onClick={handleSave}>
              Salvar Template
            </Button>
          </div>
        </div>

        {/* Canvas Area */}
        <ScrollArea className="flex-1 bg-muted/30">
          <div className="max-w-[620px] mx-auto py-6 px-4">
            <div className="bg-card rounded-lg shadow-sm overflow-hidden min-h-[300px]">
              {blocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Plus className="h-10 w-10 mb-3 opacity-30" />
                  <p className="font-medium">Canvas vazio</p>
                  <p className="text-sm mt-1">Clique nos blocos à esquerda para começar</p>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1 p-2">
                      {blocks.map((block, idx) => (
                        <SortableBlock
                          key={block.id}
                          block={block}
                          isSelected={selectedBlockId === block.id}
                          onSelect={() => setSelectedBlockId(block.id)}
                          onMoveUp={() => moveBlock(block.id, -1)}
                          onMoveDown={() => moveBlock(block.id, 1)}
                          onDuplicate={() => duplicateBlock(block.id)}
                          onDelete={() => deleteBlock(block.id)}
                          isFirst={idx === 0}
                          isLast={idx === blocks.length - 1}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
      </div>{/* close flex row */}

      {/* ── Preview Dialog ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Preview do Email</DialogTitle>
          </DialogHeader>
          <div className="bg-muted/30 rounded-lg p-4 overflow-auto max-h-[65vh]">
            <div className="max-w-[600px] mx-auto">
              <iframe
                srcDoc={html}
                title="Email Preview"
                className="w-full min-h-[400px] border rounded bg-white"
                sandbox=""
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Code Dialog ── */}
      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              HTML do Email
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1"
                onClick={() => {
                  navigator.clipboard.writeText(html);
                  toast.success('HTML copiado!');
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copiar
              </Button>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh]">
            <pre className="text-xs font-mono bg-muted p-4 rounded-lg whitespace-pre-wrap break-all">
              {html}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
