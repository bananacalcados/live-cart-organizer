# Crossell e Pagos — entrega de 29/10

## Atendimento nos Pagos
- `src/components/events/EventPaymentCardsBar.tsx`: atividade de todos os pedidos agrupados, não lidas à esquerda, abertura do WhatsApp e ações de pedido/unificação separadas.
- `src/lib/livePaidActivity.ts`: prioridade/leitura e reutilização do marcador da live.
- `src/hooks/useWaMessageBroadcast.ts`: sinal de interesse no aviso existente.
- `src/test/livePaidActivity.test.ts`: leitura, nova mensagem, agrupamento, prioridade e DDD.

## Editor e execução
- `src/components/events/CrossellBlocksEditor.tsx`: seis tipos de bloco, fotos do catálogo, prévia, ofertas salvas, envio manual, cancelamento e histórico.
- `src/components/events/EventCrossellDialog.tsx`: opções Blocos e Template Meta.
- `src/components/WhatsAppChat.tsx`, `src/components/WhatsAppChatDialog.tsx`: instância efetivamente selecionada passada ao editor.
- `supabase/functions/live-crossell-blocks/index.ts`: autorização, identidade exata do pedido/conversa, supressão, janela Meta, validação de arquivos, reservas, progresso e revisão explícita.
- `supabase/functions/_shared/crossell-blocks.ts`, `_shared/phone-utils.ts`: validação, intervalo independente e normalização.
- `supabase/functions/event-bulk-send-worker/index.ts`: exclui execuções manuais dos caminhos genéricos de retentativa.
- `supabase/functions/uazapi-webhook/index.ts`, `meta-whatsapp-webhook/index.ts`: preservam identificação da resposta de botão.
- `drizzle/migrations/0088_live_manual_crossell_blocks.sql` a `0091_manual_crossell_dispatch_gate.sql`: extensão das estruturas existentes, reservas e interesse.
- `src/test/crossellBlocks.test.ts`: intervalo 4.000–15.000 ms, sorteio independente, retomada, janela 24h, providers e botões.
- `AGENTS.md`, `supabase/functions/AGENTS.md`, `roadmap.md`: regras e situação da entrega.

## Verificado
19 testes passaram. Teste transacional desfeito confirmou execução única por chave, reserva exclusiva, review sem retentativa, horário, cancelamento e reconhecimento de interesse.
Na live real, com sessão da equipe: Pagos exibiram NÃO LIDA; clique abriu WhatsApp; editor mostrou a instância atual; montagem dos seis tipos e prévia; salvar e reabrir texto/botões com leitura do conteúdo salvo. Oferta temporária removida.
Consultas de janela/CRM/resposta usam índices existentes, conferidos com EXPLAIN. Nenhuma consulta adicional por card; editor faz lista e histórico ao abrir, histórico a cada 30s enquanto visível e ao voltar à aba.

## Limitações de verificação
- Nenhuma oferta real foi enviada: entrega, clique real e mídias reais não foram validados.
- Nova mensagem após leitura foi testada em unidade; não provocada com mensagem real.
- Recuperação após interrupção deixa resultados incertos sem repetição automática; retomada/reenvio exigem intervenção. Cancelamento não desfaz mensagem já em despacho.
- Tag de interesse chega pelo aviso durante a sessão; o histórico do editor persiste o interesse, mas restauração da tag do card após recarga não foi validada.
- uazapi não preserva o ID personalizado no formato atual de quick-reply; associação depende do ID citado da mensagem e título exato. Necessário validar com clique real autorizado.
- As funções foram atualizadas; o site não foi publicado. Fase C dos grupos não iniciada.