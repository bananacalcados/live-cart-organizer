# Centrais de Trocas e Devoluções — Fase 2

## Situação: entrega parcial, preparada mas NÃO aberta ao público

As duas páginas foram construídas, com o mesmo motor e tipos separados. As funções públicas estão implantadas, porém respondem que a central está em preparação. **Não envie os links às clientes ainda.**

Motivo: o ambiente não oferece um limite padrão de acessos por IP/token. A implementação de uma proteção própria depende da confirmação solicitada ao dono. Não foi criada uma proteção improvisada sem essa confirmação, nem aberto o serviço sem ela. O bloqueio atual é explícito nas duas funções; mudar somente a configuração salva não o remove.

## Implementado
- `/central/troca/:token` e `/central/devolucao/:token`, marca Banana Calçados e textos separados.
- Motivo antes das opções; troca começa pelas variantes do mesmo produto e depois permite busca paginada. Devolução não permite reposição.
- Informação clara de que reposição/reembolso dependem do recebimento e conferência na loja; sem promessa de valor/prazo de reembolso.
- Hash de token, isolamento por tipo, vencimento, revogação e consumo na submissão, sem acesso anônimo às tabelas.
- Submissão transacional: trava o link, a venda e o produto escolhido; valida item/quantidade e disponibilidade; consulta solicitações abertas e trocas antigas; devolve andamento em caso de sobreposição.
- Reserva **lógica** na solicitação, sem baixa de estoque ou compromisso fiscal. Soma reservas desta central para impedir duas reservas concorrentes da mesma disponibilidade.
- Aprovação conservadora: entrega com origem explicitamente `carrier`, não futura, elegibilidade existente dentro do prazo, condição declarada sem uso e motivo elegível. Defeito/dúvida/fora do prazo/sem evidência/diferença de produto/sem estoque vão para `escalado`. Nunca nega automaticamente.
- Sem registro em reposição agora significa `nao_oferecer`. Não havia registros existentes; nenhuma marcação foi apagada. Novas marcações são `sob_consulta`.
- Administração → Produtos para troca: busca por nome, 50 linhas por página, seleção da página e permitir/não oferecer em lote. Um carregamento por abertura/página/busca, sem repetição automática.
- No detalhe do pedido do PDV: gerar mensagem pronta de troca/devolução e revogar o último link gerado. Não envia mensagem automaticamente.
- `central_auto_reverse=false`; nenhuma geração automática de reversa.

## Arquivos criados
- `supabase/functions/_shared/central-rules.ts`
- `supabase/functions/_shared/central-handler.ts`
- `supabase/functions/central-resolve/index.ts`
- `supabase/functions/central-submit/index.ts`
- `supabase/functions/central-submit/index.test.ts`
- `src/lib/centralApi.ts`
- `src/pages/CentralPublicPage.tsx`
- `src/components/pos/CentralLinkButtons.tsx`
- `src/components/admin/CentralRestockPanel.tsx`
- `src/test/centralRules.test.ts`
- Este relatório.

## Arquivos atualizados
- `src/App.tsx`
- `src/pages/Admin.tsx`
- `src/components/pos/POSSaleDetailDialog.tsx`
- `src/components/TeamChat.tsx`
- `src/components/sticky-notes/StickyNotesFloatingButton.tsx`
- `roadmap.md`
- Tipos e histórico de alterações do banco regenerados pela ferramenta.
- Memória do projeto: regras permanentes das duas centrais.

O registro em `AGENTS.md` não foi salvo: o arquivo está no limite permitido; não encurtei regras anteriores.

## Migrações aplicadas
1. `0166_central_selfservice_phase2`: campos de itens/quantidade/reserva, referência da submissão no link, configurações desligadas, opção de reposição, índices e funções compartilhadas de consulta/submissão/configuração.
2. `0167_central_staff_links_guard`: geração de links restrita à equipe com acesso PDV/Expedição/admin, pedido existente e endereço separado por tipo; função de revogação.

Campos/configurações/funções foram confirmados por leitura do banco. Todas as novas funções `central_*` têm execução anônima revogada. Consulta de reservas usa `exchange_requests_central_reserve_idx` conforme EXPLAIN. Nenhuma tabela nova.

## Funções implantadas
- `central-resolve`
- `central-submit`

Ambas com CORS, validação e registro de acesso, sem registrar token em corpo/query. Ambas fechadas para atendimento público enquanto falta a proteção por IP/token.

## Testes e limites de verificação
- 11 testes das regras: sete dias exatos, fora do prazo, origem incerta, condição incerta, tipos isolados, vencimento/revogação e sobreposição.
- 4 testes locais dos handlers com dependências simuladas: hash, submissão atômica, devolução sem reposição, token inexistente e bloqueio enquanto não liberado. Nenhuma chamada a provedores.
- 2 testes existentes da ação de despacho passaram.
- Navegador em 360 px: duas páginas sem rolagem horizontal; formulários e envio/retorno simulados conferidos; nenhum erro de execução.
- Compilação registrada como OK.
- A sessão da equipe foi preparada, mas a página administrativa não apresentou a nova aba na conferência. Portanto a interação real de configuração e geração de links **não foi validada**.
- Não houve submissão real a pedido, nem teste transacional concorrente contra o banco. Os testes locais das regras não substituem essa conferência.

## Pendências e riscos antes de abrir
1. Dono autorizar proteção própria por IP/token; implementar, testar e somente depois remover o bloqueio público.
2. Validar o caminho administrativo com sessão funcional e um pedido controlado, sem fiscal.
3. Testar transação/repetição/concorrência com dados controlados. Reserva atual coordena somente solicitações desta central: vendas e reservas do fluxo antigo não foram alteradas; a equipe deve reconferir estoque antes de separar/enviar.
4. Quando produto original não estiver no cadastro da loja da venda, opções ficam vazias e a cliente pode pedir ajuda. Nenhum vínculo de produto é adivinhado.
5. Conferir consulta das trocas antigas com IDs/itens reais antes de abrir: a nova transação não modifica o fluxo antigo.
6. A revogação na tela cobre o último link gerado naquela sessão; não foi criado painel de todos os links (fora desta fase).

## Fora desta entrega
Fila/painel novo do atendente (Parte 3), respostas automáticas e migração de canais (Parte 4), IA (Parte 5), integração fiscal/reversa automática. Nenhuma alteração em finalizeExchange, NF de saída, live, estornos ou devolucao-guard.

**Nada foi publicado no front. Nenhuma NF-e foi emitida, cancelada, inutilizada ou alterada. Nenhuma chamada SEFAZ/BrasilNFe nos testes. Nenhum plano foi alterado. Nenhum candidato foi apagado.**