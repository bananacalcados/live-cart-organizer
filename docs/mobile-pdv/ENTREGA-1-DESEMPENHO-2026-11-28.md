# Entrega 1 — desempenho desktop (28/11/2026)

Sem publicação. Fontes permanecem ERP; convite mobile permanece off. Nenhuma venda/mensagem real gravada.

## Envios
- Antes: 12 recargas/minuto × 3 a 6 pedidos HTTP = 36–72 consultas/minuto, mesmo oculto. **Não era literalmente N+1**: o código já enriquecia em lotes; baixava até 200 vendas e todos os itens. Corrigida a descrição da Fase 0.
- Agora: 1 RPC na abertura/página/busca/Atualizar; zero recargas por minuto ocioso. Avisos por loja agrupados em janelas de 1 segundo, sem timer periódico; voltar à aba recarrega. Custo variável por alterações reais, não um número fixo por minuto.
- Mesmos dados, critérios, ordem e contadores do recorte legado das últimas 200 vendas. Páginas de 50; busca e filtros no servidor. Não ampliamos a contagem histórica silenciosamente.
- RPC autenticada medida em três leituras: 162, 182 e 143 ms, incluindo rede (mediana 162 ms). EXPLAIN do caminho indexado principal: 6,248 ms; não é o tempo total da RPC. O executor de leitura não tem EXECUTE na RPC; não foi aberto grant para medir.
- Índices existentes: pos_sales_store_created_idx, idx_pos_sale_items_sale_id, pos_customers_pkey, idx_pos_checkout_attempts_sale. Nenhum índice novo.

## Cartões da live no WhatsApp
- Antes: 1 recarga/minuto visível = 2 consultas (eventos+instâncias) ou 3 (com pedidos), mais enriquecimentos já existentes.
- Agora: zero recargas periódicas dessa projeção. Mesmas 2–3 consultas apenas ao abrir/voltar ou receber aviso relevante. Conferência leve de 60 s não foi alterada; enriquecimentos/mensagens continuam independentes.
- Projeção/grupo por telefone, prioridade ao pedido não pago e ordem mantidos; teste executa trechos congelados antes/depois com entradas iguais.

## Banco/custo
- 0317: RPC somente leitura e avisos privados sem dados de clientes, por loja; uma vez por loja em cada instrução em lote; updates idênticos não avisam.
- 0318: avisos de itens/tentativas/notas também refletem na fila sem polling.
- Não adicionamos sales/orders à publicação de linhas completas; não criamos cron ou índice. Custo: pequena publicação por loja afetada + recarga agrupada dos clientes abertos. Compartilha uma assinatura por loja/aba e remove ao desmontar.
- Os novos gatilhos só avisam; gatilhos de vendas/estoque/mensagens existentes não foram alterados. Foram listados antes da criação.

## Testes e limitações
- 18 testes específicos passaram: paginação/busca/contadores/fallback em PostgreSQL descartável, projeção live antes/depois, ausência de polling, oculto/retorno, rajada, reconexão e canal compartilhado.
- Envios aberto com sessão da equipe: RPC real de leitura, canal privado joined, Atualizar funcionando, zero exceções JS e zero HTTP de erro. Sem escritas.
- Evento real de venda não produzido: testes de emissão/recepção não gravam nem enviam mensagens reais. Alterações exclusivamente cadastrais (nome de cliente, nome/instância de evento) aparecem ao Atualizar/voltar; dados transacionais avisam automaticamente.
- Tipos/build: verificação automática da prévia, sem comando manual vedado pelo ambiente.

## Roteiro Matthews
1. Na loja, abrir Envios, conferir mesmos contadores e ordem; Próxima/Anterior e buscar nome/SKU.
2. Em duas abas, uma operação legítima em envio deve atualizar a outra; ocultar/voltar e usar Atualizar.
3. No WhatsApp, conferir pedido da live, pagamento/etapa em operação legítima e mensagem nova em conversa existente.
4. Confirmar que não há mensagens automáticas adicionais nem mudança no saldo.
