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

## Atualização 11/11/2026 — proteção de tentativas e validação

**Situação:** proteção própria por IP e por link implantada; as páginas continuam **FECHADAS** (`central_public_enabled = false`). As funções agora obedecem a essa chave (antes o bloqueio era fixo no código); só um admin ligando a chave abre o atendimento.

### Proteção de tentativas
- Tabela de contadores só do servidor (`central_rate_limits`), com IP e link guardados apenas em hash; função `central_rate_guard` só para o servidor.
- Janela de 10 minutos: até 60 acessos por IP e 30 por link. Tentativas inválidas (link inexistente, vencido, revogado, já usado, tipo errado ou formato inválido): 10 por IP ou 5 por link → bloqueio de 30 minutos.
- Respostas genéricas: o mesmo aviso para link inexistente, vencido, revogado, usado ou de outro tipo; o bloqueio mostra só "Muitas tentativas. Aguarde alguns minutos".
- Se o contador falhar, a central fica fechada para aquela tentativa (não libera).
- Limpeza automática dentro da própria função (registros parados há mais de 1 dia, em lotes de 500), sem cron novo.
- Link já usado agora também responde genérico (migração `0188`). Reenvio pelo mesmo link não cria nada; um link novo do mesmo item mostra o andamento da solicitação existente.

### Tela "Produtos para troca sem estoque"
- A aba existia só para administradores e não abria por endereço. Agora: botão "Produtos para troca" no topo da Administração, aba abre por `/admin?tab=central-restock` e página própria `/admin/produtos-troca` (rota protegida, módulo admin). Busca, seleção da página e Permitir/Não oferecer em lote, gravação conferida no servidor (somente admin).

### Resultados da validação (banco, transações desfeitas no final, sem chamadas externas, sem NF)
| Teste | Resultado |
|---|---|
| Troca: gerar link, abrir, ver opções, enviar com produto em estoque | Passou (aprovado, reserva lógica 1) |
| Devolução: gerar link, abrir, enviar | Passou (fora do prazo → escalado) |
| Devolução com produto de reposição | Passou (recusado) |
| Link de troca não abre devolução / de devolução não abre troca | Passou |
| Link vencido, revogado, inexistente, já usado → genérico | Passou |
| Item com solicitação aberta mostra andamento e não duplica | Passou (1 solicitação) |
| Fora do prazo → escalado | Passou |
| Entrega sem confirmação da transportadora → escalado | Passou |
| Limite: link bloqueia na 5ª inválida, IP na 10ª, excesso de acessos no 61º | Passou |
| Função do servidor (testes locais, 6) incluindo bloqueio após excesso e limitador indisponível | Passou |
| Concorrência: 3 envios (mesmo link 2x + outro link) para o mesmo item | Passou: 1 solicitação. A ferramenta executou os envios em sequência rápida, sem sobreposição real; a garantia vem da trava do link e da venda. Registros de teste apagados. |
| Estoque | Passou: nenhum estoque alterado, nenhum ajuste de estoque; produto reservado sai da lista dos próximos (reserva só lógica). |

### Estoque legado
Nenhuma função das Centrais grava estoque ou ajustes. A reserva é só um número na solicitação, descontado da disponibilidade mostrada. O fluxo antigo de trocas continua sendo o único que dá baixa/entrada, na finalização pela equipe.

### Pendências
1. Abrir ao público: um admin liga a chave quando o dono pedir.
2. Concorrência com sobreposição real não pôde ser forçada pela ferramenta.
3. Interação da tela administrativa não aberta no navegador nesta rodada (confirmada por leitura do código/rota).
4. Produto original fora do cadastro da loja: troca sem opções (cliente pede ajuda).
