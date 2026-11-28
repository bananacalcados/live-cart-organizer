# Entrega 2 — Expedição do celular

Sem publicar, sem mudar fontes ERP/convite off, sem mover pedido, baixar estoque ou enviar mensagem real.

## Construído
- /m/pdv/expedicao, loja escolhida, filtro de etapa com mesmos contadores da RPC do computador, nome/prefixo de pedido, páginas de 50 no servidor, prioridade e fotos por pos_item_photos.
- Telas separadas do desktop; modelo/enriquecimento e efeitos compartilhados em lib/pos. Re-export mantém os imports antigos.
- Conferência por câmera (html5-qrcode CODE128/EAN/SKU) e campo de leitor focado; unidades X de Y, checklist, som/vibração, rejeição de item errado/a mais, desfazer auditado.
- Fila local por usuário/pedido: persiste antes do feedback, conserva UUID do bipe, sincroniza ao conectar/abrir, sem timer. Etiqueta ainda não resolvida fica pendente até conectar. Pendências/erros/versão antiga/internet ausente bloqueiam concluir. Armazenamento negado gera erro, não finge que salvou.
- Conclusão usa dados de envio já preenchidos; não edita frete. Dados ausentes levam à versão completa. Editar/cancelar/frete/etiquetas/DANFE/compras/estornos/chamados continuam na versão completa.
- Computador: avanço simples/em massa, volta, movimentação de produtos e conclusão usam a nova função com bloqueio antes de qualquer gravação. Conflito avisa e recarrega; mesmo fluxo sem disputa.
- Os dois leem avisos privados por loja, incluindo alterações de itens. Nenhum polling mobile.

## Migrações aditivas
- 0319: pos_expedition_transition (INVOKER, mesmas RLS e equipe) e pos_expedition_scan_batch (UUID no log existente; retry não insere duas vezes).
- 0320: seleção paginada dos IDs elegíveis (INVOKER, máximo 100, usado com 50), mesmos critérios das quantidades/contadores.
- 0321: correção de alias ambíguo encontrada no teste isolado da função nova, antes de uso real. Sem dados alterados.
- Sem tabela, coluna, índice ou cron novo nesta entrega. Índices existentes de loja/etapa e itens por venda. EXPLAIN da busca de nome na etapa: 2,193 ms; não é a duração completa do carregamento. Busca usa o recorte indexado por loja/etapa; não varre todas as vendas.

## Efeitos de avanço preservados
- Avanço simples altera expedition_stage; concluído também altera expedition_finished_at. Itens/checks/flag de faltantes mantêm fórmulas anteriores; parcial não libera venda inteira.
- Gatilhos existentes NÃO foram alterados: release/shipped, sync do pedido da live, guard de troca, rastreio, automações e estoque continuam nos mesmos caminhos.
- Achado importante: o gatilho de estoque consultado baixa na venda paga/condicional e devolve no cancelamento; não há nova baixa no simples avanço de etapa. Não inventamos uma segunda baixa ao concluir.
- Efeitos que estavam no navegador: (1) attachRealTracking, depois (2) saveExpeditionShippingCost, inclusive registro delivery_costs. Continuam nessa ordem após confirmar a transação, compartilhados com o celular. Conflito não executa nenhum deles. Envio de mensagem de rastreio continua botão separado; não adicionamos mensagem automática.
- Melhora de atomicidade: antes checks/itens podiam ficar escritos mesmo se avanço falhasse; agora a operação inteira falha sem escrita parcial. Colunas/gatilhos em sucesso mantidos.

## Evidências e limites
- 1.245 testes do app + 21 AustPay + 295 Deno passaram (1.561 no total). Deno executado sem typecheck, dependências isoladas e permissão de escrita apenas para o teste antigo que cria/apaga um módulo temporário. Tentativas com executor/permissão errados não são falhas da aplicação.
- 10 testes SQL em PostgreSQL descartável: avanço, produtos, aguardando, conclusão total/parcial, mesmas colunas e gatilhos por UPDATE OF, trigger real versionado de release/shipped; segundo operador com snapshot antigo rejeitado; replay de mesmo UUID insere uma vez; anon bloqueado.
- 14 testes de reconhecimento/fila: SKU mobile, barcode desktop intacto, etiqueta pelo resolver existente, errado/a mais, ACK, desfazer, teto, versão antiga.
- 390×844, sessão da equipe e pedido SIMULADO interceptado: barcode, 2 unidades, offline com concluir bloqueado, reconexão automática, desfazer, código errado, SKU, checklist e concluir; zero escrita real, zero exceção JS. Dados simulados existiram apenas no navegador descartado, nada para apagar no banco.
- Fila real somente leitura: 12 Novos, 58 Separação, 6 Conferência, 2306 Concluídos na Pérola; sem rolagem lateral, desktop abriu sem exceção. Fotos usam o cache existente; sem foto mostra bloco neutro.
- NÃO verificado: leitura óptica em câmera física, leitor Bluetooth real, som/vibração no aparelho, dois aparelhos simultâneos numa operação real, estoque/mensagens/rastreio externos ponta a ponta. Concorrência foi testada por snapshot obsoleto em banco isolado, não por pedidos reais; não alegamos prova integral de efeitos externos.
- Tipos/build de produção separados: comandos manuais vedados pelo ambiente. Log automático: build OK; não é evidência separada de ambos.

## Roteiro Matthews no aparelho
1. Sem convite, abrir /m/pdv/expedicao; escolher Pérola e conferir contadores, nome/pedido, etapas e foto/cor/SEDEX.
2. Num pedido de teste autorizado, usar câmera e leitor: dois pares iguais devem contar 1/2 e 2/2; errado/a mais deve alertar.
3. Desligar internet, bipar, fechar/voltar; conferir fila guardada e conclusão bloqueada. Reconectar: sincroniza uma vez; desfazer também deixa registro.
4. Em dois aparelhos, abrir o mesmo pedido de teste; o segundo avanço deve avisar que outra pessoa já moveu e atualizar a fila.
5. Conferir dados de envio existentes, concluir só o pedido de teste, comparar liberação, quantidade e rastreio com computador; não testar em pedido de cliente sem autorização.
6. Conferir retorno à versão completa para etiquetas/frete/troca/chamados. Impressão fica fora desta fase.

Não publicar automaticamente. A validação de aparelho/efeitos reais e a evidência separada de tipos/build permanecem pendentes.