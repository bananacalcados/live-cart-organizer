# Centrais — Fase 3: Painel do Atendente

Centrais públicas continuam FECHADAS (central_public_enabled=false). Nada publicado, nenhuma NF emitida.

## Criado
- Tela `/atendimento/trocas` (card "Trocas e Devoluções" no menu inicial com contador do que precisa de atenção). Acesso: admin, PDV, Expedição ou Gestão.
- Abas: Precisa de você (escalado + aprovado sem reversa), Em andamento, Concluídas. Mais antigo primeiro, destaque >24h e >48h, filtros tipo/motivo/atendente, busca nome/telefone/pedido, 50 por página.
- Cartão: pedido, itens, entrega e fonte, prazo/dias, elegibilidade, motivo, histórico de outras trocas (alerta), NF de devolução, WhatsApp com mensagem pronta.
- Ações (todas no histórico com quem/quando + observação): atribuir/reatribuir, oferecer numeração (só mostra estoque e mensagem), pedir informação, aprovar (motivo obrigatório), negar (só pessoa logada, motivo obrigatório), abrir registro de troca/devolução pelo fluxo existente (trava de item repetido; aguarda retorno por padrão; antecipado exige motivo), gerar reversa (só aprovada, uma vez; usa a janela de reversa existente e a trava de NF duplicada).
- Mensagens prontas editáveis (só admin salva).

## Banco
Migração `0189_exchange_desk_phase3`: colunas de atribuição/decisão, tabelas de histórico e mensagens (RLS, sem acesso público), funções `exchange_desk_list/count/detail/sizes/action/staff_list`. A tabela de solicitações deixou de aceitar qualquer usuário logado: agora só equipe.

## Testes
- 11 testes de regras (só humano nega, reversa só aprovada e sem duplicar, motivos obrigatórios, abas, idade, mensagens): passou.
- Simulação no banco desfeita (escalado→aprovado→reversa): todas as travas passaram.
- Simulação da reversa em modo teste pelo servidor: não executada (sessão de teste não vale neste ambiente).

## Pendências / riscos
- Condição do produto não é gravada pela central; o cartão pede para confirmar com a cliente.
- Reversa pela tela é real (não há modo teste na janela); usar só em solicitação verdadeira.
- "Abrir no PDV" leva ao PDV; o registro aparece pelo código.
