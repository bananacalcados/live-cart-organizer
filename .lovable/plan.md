# Enviar mensagens de grupo VIP sem a miniatura do link

## Resposta curta
Sim, é possível. A uazapi aceita o campo `linkPreview: false` no `POST /send/text` — é exatamente o mesmo efeito do "X" que remove a prévia no app oficial. A Z-API também aceita `linkPreview`. O WaSender não tem esse controle documentado, então lá continua como está (sem quebrar nada).

Hoje nenhuma das nossas funções envia esse campo, então a API usa o padrão (`true`) e a miniatura sempre aparece.

## O que muda (por camadas)

### 1. Banco
Nova coluna opcional em `group_campaign_scheduled_messages`:
- `disable_link_preview boolean NOT NULL DEFAULT false`

Default `false` = comportamento atual preservado para tudo que já existe.

### 2. Edge functions (retrocompatíveis)
Em todas, o parâmetro é opcional; se não vier, nada muda.
- `uazapi-send-message`: aceitar `linkPreview?: boolean` no body e repassar `linkPreview: false` ao `/send/text` quando pedido.
- `uazapi-groups` (action `sendMessage`, usado quando "mencionar todos" está ligado): mesmo tratamento.
- `zapi-send-group-message` / `zapi-send-message`: repassar `linkPreview: false` no payload da Z-API.
- `group-dispatch-worker`: ler `block.disable_link_preview` e propagar no `sendBlock` para uazapi e zapi. Para WaSender, ignora silenciosamente.

### 3. Interface
No editor de blocos de mensagem da campanha VIP (Marketing > Grupos VIP > campanha), adicionar um switch por bloco de texto:
- Rótulo: "Sem miniatura do link"
- Só aparece quando o bloco é do tipo texto e o conteúdo contém uma URL.
- Preview do bloco mostra um aviso discreto quando ativo.

## Detalhes técnicos
- `linkPreview` só afeta mensagens de texto; blocos de mídia (imagem/vídeo) não têm prévia de link e ficam de fora.
- Nenhum envio existente muda de comportamento: quem não passar o campo continua com prévia.
- Sem alteração no motor de fila/anti-ban (`claim_group_dispatch_job`, delays, seq) — só o corpo do payload de envio.

## Riscos
Baixos. A mudança é aditiva (coluna com default, parâmetro opcional). Pior caso: a instância uazapi ignora o campo e a prévia continua aparecendo — nada quebra.
