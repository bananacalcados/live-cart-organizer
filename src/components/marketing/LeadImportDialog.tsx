import { useEffect, useState } from "react";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type LeadField = "campaign_tag" | "name" | "phone" | "email" | "instagram" | "source" | "converted";
type MappingState = Record<LeadField, string>;
type RawLeadRow = Record<string, unknown>;

interface LeadImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingCampaignTags: string[];
  onImported: () => Promise<void> | void;
}

const EMPTY_MAPPING: MappingState = {
  campaign_tag: "",
  name: "",
  phone: "",
  email: "",
  instagram: "",
  source: "",
  converted: "",
};

const TARGET_FIELDS: Array<{
  key: LeadField;
  label: string;
  description: string;
  required?: boolean;
}> = [
  { key: "campaign_tag", label: "Campanha", description: "Tag da campanha do lead", required: true },
  { key: "name", label: "Nome", description: "Nome do lead" },
  { key: "phone", label: "Telefone", description: "WhatsApp ou telefone" },
  { key: "email", label: "Email", description: "Email do lead" },
  { key: "instagram", label: "Instagram", description: "Usuário do Instagram" },
  { key: "source", label: "Origem", description: "Origem/canal do lead" },
  { key: "converted", label: "Convertido", description: "Status convertido (sim/não)" },
];

const mappingSchema = z
  .object({
    campaign_tag: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string(),
    instagram: z.string(),
    source: z.string(),
    converted: z.string(),
    manualCampaignTag: z.string().trim().max(120).optional(),
    manualSource: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.campaign_tag && !value.manualCampaignTag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mapeie a coluna de campanha ou informe uma campanha padrão.",
        path: ["campaign_tag"],
      });
    }

    if (!value.name && !value.phone && !value.email && !value.instagram) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mapeie pelo menos um campo de identificação do lead.",
        path: ["name"],
      });
    }
  });

const findMatchingHeader = (headers: string[], matchers: RegExp[]) => {
  return headers.find((header) => matchers.some((matcher) => matcher.test(header))) || "";
};

const inferMapping = (headers: string[]): MappingState => ({
  campaign_tag: findMatchingHeader(headers, [/^campanha$/i, /campaign/i, /tag/i, /origem.*campanha/i]),
  name: findMatchingHeader(headers, [/^nome$/i, /name/i, /cliente/i, /contato/i]),
  phone: findMatchingHeader(headers, [/telefone/i, /whatsapp/i, /celular/i, /phone/i, /fone/i, /tel\b/i]),
  email: findMatchingHeader(headers, [/^email$/i, /e-mail/i, /mail/i]),
  instagram: findMatchingHeader(headers, [/instagram/i, /^ig$/i, /insta/i]),
  source: findMatchingHeader(headers, [/origem/i, /source/i, /canal/i]),
  converted: findMatchingHeader(headers, [/convert/i, /vendeu/i, /comprou/i]),
});

const normalizeText = (value: unknown, maxLength: number) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
};

const normalizePhone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
};

const normalizeEmail = (value: unknown) => {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return null;

  const result = z.string().email().safeParse(email);
  return result.success ? result.data : null;
};

const normalizeInstagram = (value: unknown) => {
  const handle = String(value ?? "").trim().replace(/^@+/, "");
  return handle ? `@${handle.slice(0, 100)}` : null;
};

const normalizeBoolean = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "sim", "yes", "y", "convertido", "pago"].includes(normalized)) return true;
  if (["0", "false", "nao", "não", "no", "n", "aberto", "pendente"].includes(normalized)) return false;
  return null;
};

const getMappedValue = (row: RawLeadRow, header: string) => {
  if (!header) return "";
  return row[header];
};

export function LeadImportDialog({ open, onOpenChange, existingCampaignTags, onImported }: LeadImportDialogProps) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawLeadRow[]>([]);
  const [mapping, setMapping] = useState<MappingState>(EMPTY_MAPPING);
  const [manualCampaignTag, setManualCampaignTag] = useState("");
  const [manualSource, setManualSource] = useState("importacao_manual");
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  useEffect(() => {
    if (open) return;
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping(EMPTY_MAPPING);
    setManualCampaignTag("");
    setManualSource("importacao_manual");
    setLoadingFile(false);
    setImporting(false);
    setResult(null);
  }, [open]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoadingFile(true);
    setResult(null);

    try {
      const xlsxModule = await import("@e965/xlsx");
      const XLSX = xlsxModule.default || xlsxModule;
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsedRows = XLSX.utils.sheet_to_json<RawLeadRow>(worksheet, { defval: "" });

      if (parsedRows.length === 0) {
        toast.error("A planilha está vazia.");
        return;
      }

      const parsedHeaders = Object.keys(parsedRows[0]);
      setFileName(file.name);
      setRows(parsedRows);
      setHeaders(parsedHeaders);
      setMapping(inferMapping(parsedHeaders));
      toast.success("Arquivo carregado. Confira o mapeamento antes de importar.");
    } catch (error: any) {
      toast.error(`Erro ao ler arquivo: ${error?.message || "arquivo inválido"}`);
    } finally {
      setLoadingFile(false);
      event.target.value = "";
    }
  };

  const handleImport = async () => {
    const configValidation = mappingSchema.safeParse({
      ...mapping,
      manualCampaignTag,
      manualSource,
    });

    if (!configValidation.success) {
      toast.error(configValidation.error.issues[0]?.message || "Revise o mapeamento antes de importar.");
      return;
    }

    setImporting(true);

    try {
      const preparedRows = rows
        .map((row, index) => {
          const campaignTag = normalizeText(getMappedValue(row, mapping.campaign_tag) || manualCampaignTag, 120);
          const name = normalizeText(getMappedValue(row, mapping.name), 200);
          const phone = normalizePhone(getMappedValue(row, mapping.phone));
          const email = normalizeEmail(getMappedValue(row, mapping.email));
          const instagram = normalizeInstagram(getMappedValue(row, mapping.instagram));
          const source = normalizeText(getMappedValue(row, mapping.source) || manualSource || "importacao_manual", 120);
          const converted = normalizeBoolean(getMappedValue(row, mapping.converted));

          if (!campaignTag) return null;
          if (!name && !phone && !email && !instagram) return null;

          return {
            campaign_tag: campaignTag,
            name,
            phone,
            email,
            instagram,
            source,
            converted,
            metadata: {
              imported_via: "marketing_leads_upload",
              import_file_name: fileName,
              imported_at: new Date().toISOString(),
              original_row_number: index + 2,
            },
          };
        })
        .filter(Boolean) as Array<{
          campaign_tag: string;
          name: string | null;
          phone: string | null;
          email: string | null;
          instagram: string | null;
          source: string | null;
          converted: boolean | null;
          metadata: Record<string, unknown>;
        }>;

      if (preparedRows.length === 0) {
        toast.error("Nenhuma linha válida encontrada após aplicar o mapeamento.");
        return;
      }

      for (let index = 0; index < preparedRows.length; index += 200) {
        const chunk = preparedRows.slice(index, index + 200);
        const { error } = await supabase.from("lp_leads").insert(chunk as any);
        if (error) throw error;
      }

      const skipped = rows.length - preparedRows.length;
      setResult({ imported: preparedRows.length, skipped });
      await onImported();
      toast.success(`${preparedRows.length} leads importados com sucesso.`);
    } catch (error: any) {
      toast.error(`Erro ao importar leads: ${error?.message || "falha desconhecida"}`);
    } finally {
      setImporting(false);
    }
  };

  const previewHeaders = headers.slice(0, 6);
  const previewRows = rows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !importing && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar leads por planilha
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">Arquivo Excel</p>
                    <p className="text-sm text-muted-foreground">
                      Envie um arquivo .xls ou .xlsx com cabeçalhos na primeira linha.
                    </p>
                  </div>
                  {rows.length > 0 && <Badge variant="secondary">{rows.length} linhas</Badge>}
                </div>

                <div className="border border-dashed border-border rounded-lg p-4 bg-background/50">
                  <Label htmlFor="lead-import-file" className="sr-only">
                    Selecionar planilha
                  </Label>
                  <Input id="lead-import-file" type="file" accept=".xls,.xlsx" onChange={handleFileChange} disabled={loadingFile || importing} />
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    {loadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{fileName || "Nenhum arquivo selecionado"}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-4">
                <div>
                  <p className="font-medium text-foreground">Mapeamento de colunas</p>
                  <p className="text-sm text-muted-foreground">
                    Associe os cabeçalhos do arquivo aos campos de leads do sistema.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {TARGET_FIELDS.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <Label>{field.label}{field.required ? " *" : ""}</Label>
                      <Select
                        value={mapping[field.key] || "__none__"}
                        onValueChange={(value) =>
                          setMapping((current) => ({
                            ...current,
                            [field.key]: value === "__none__" ? "" : value,
                          }))
                        }
                        disabled={headers.length === 0 || importing}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma coluna" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Não mapear</SelectItem>
                          {headers.map((header) => (
                            <SelectItem key={`${field.key}-${header}`} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Campanha padrão</Label>
                    <Input
                      value={manualCampaignTag}
                      onChange={(event) => setManualCampaignTag(event.target.value)}
                      placeholder="Use se o arquivo não tiver coluna de campanha"
                      disabled={importing}
                      maxLength={120}
                    />
                    {existingCampaignTags.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Tags existentes: {existingCampaignTags.slice(0, 5).join(", ")}
                        {existingCampaignTags.length > 5 ? "..." : ""}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Origem padrão</Label>
                    <Input
                      value={manualSource}
                      onChange={(event) => setManualSource(event.target.value)}
                      placeholder="importacao_manual"
                      disabled={importing}
                      maxLength={120}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">Prévia da planilha</p>
                    <p className="text-sm text-muted-foreground">Primeiras linhas detectadas para conferência.</p>
                  </div>
                  {headers.length > 0 && <Badge variant="outline">{headers.length} colunas</Badge>}
                </div>

                {previewRows.length === 0 ? (
                  <div className="rounded-md border border-border bg-background/50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Envie uma planilha para visualizar a prévia e mapear os campos.
                  </div>
                ) : (
                  <div className="max-h-[320px] overflow-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {previewHeaders.map((header) => (
                            <TableHead key={header}>{header}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((row, index) => (
                          <TableRow key={`preview-row-${index}`}>
                            {previewHeaders.map((header) => (
                              <TableCell key={`${header}-${index}`} className="max-w-[180px] truncate text-xs">
                                {String(row[header] ?? "—") || "—"}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="font-medium text-foreground">Importação</p>
                <p className="text-sm text-muted-foreground">
                  O sistema vai salvar os leads importados na base usada pela aba Leads do Marketing.
                </p>

                {result && (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span>
                      {result.imported} importados{result.skipped > 0 ? ` · ${result.skipped} ignorados` : ""}
                    </span>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
                    Cancelar
                  </Button>
                  <Button onClick={handleImport} disabled={headers.length === 0 || importing || loadingFile}>
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Importar leads
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
