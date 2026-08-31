# Recuperar os XMLs das NFC-e e corrigir a emissão

Objetivo: fazer as 146 notas de julho/agosto voltarem a aparecer no arquivo da contabilidade, e garantir que isso não volte a acontecer nas próximas emissões.

## Etapa 1 — Recuperar as notas de julho e agosto (backfill)

O texto XML de todas as notas afetadas já está guardado no sistema, dentro da resposta bruta da BrasilNFe. Nada precisa ser pedido à SEFAZ.

- Criar uma rotina única de recuperação que percorre as notas modelo 65 autorizadas sem XML gravado.
- Para cada nota: decodificar o XML da resposta guardada e gravá-lo no campo próprio.
- Quando a resposta também trouxer o arquivo da DANFE, salvá-lo no armazenamento e preencher o link — as mesmas 81 notas de julho estão sem DANFE.
- Rodar em lotes, com relatório final: quantas recuperadas, quantas sem dado aproveitável.
- Verificação: contar quantas notas modelo 65 autorizadas de julho ainda ficam sem XML. O esperado é zero.

Resultado: você reexporta julho pelo mesmo botão de sempre e o arquivo sai completo.

## Etapa 2 — Corrigir a emissão de NFC-e

- Ajustar a função de emissão de NFC-e (`nfce-emitir`) para decodificar e gravar o XML no momento da autorização, exatamente como a função de NF-e já faz hoje.
- Aplicar o mesmo tratamento nas duas funções que autorizam notas depois (consulta de status na SEFAZ e reprocessamento da fila de pendentes), para que uma nota que autoriza em contingência também salve o XML.
- Manter tudo o que já funciona intacto: nada muda no payload enviado à SEFAZ, na numeração, nem no fluxo do PDV. A alteração é só de gravação após a resposta.

## Etapa 3 — Conferência

- Emitir uma NFC-e de teste (ou usar a primeira venda real após o ajuste) e confirmar que ela nasce com XML e DANFE gravados.
- Rodar novamente a análise de sequência de notas de julho para confirmar que nenhuma consta como "não lançada".

## Detalhes técnicos

- Nova edge function de backfill, no mesmo padrão da já existente `fiscal-backfill-danfe`: lê `fiscal_documents.brasilnfe_response`, decodifica `Base64Xml` para `xml_content` e `Base64File` para o bucket `fiscal-documents`, com filtro por modelo 65, status autorizado e período.
- `supabase/functions/nfce-emitir/index.ts`: adicionar o bloco de decodificação de `Base64Xml`/`Base64File` no mesmo update que hoje só grava `danfe_url` (linha ~333).
- `supabase/functions/nfce-poll-sefaz/index.ts` e `supabase/functions/nfce-retry-pending/index.ts`: mesmo bloco no ponto em que marcam a nota como autorizada.
- Nenhuma mudança de schema e nenhuma alteração em `exportFiscalXml.ts` — ele volta a funcionar sozinho assim que o campo estiver preenchido.
