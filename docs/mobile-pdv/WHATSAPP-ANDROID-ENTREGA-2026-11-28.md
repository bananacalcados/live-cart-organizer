# WhatsApp mobile — entrega após teste Android

## Resultado por item

1. Parar a gravação abre áudio local com play/pausa, duração e progresso. Lixeira descarta. Só o toque posterior em Enviar chama o envio existente.
2/10. Cores exatas e fonte do sistema centralizadas em tokens do WhatsApp mobile. Lista/cabeçalhos/barra inferior brancos, conversa #EFEAE2, rabiscos sutis #E4DDD3 e balões #FFFFFF/#D9FDD3. O restante do PDV e o desktop não mudaram.
3. Câmera no clipe oferece Tirar foto e Gravar vídeo; captura do aparelho, prévia e legenda opcional. Vídeo passa como vídeo ao mesmo envio de mídia do desktop.
4. Galeria aceita imagem/vídeo, com a mesma prévia e envio. Limite compartilhado de vídeo: 64MB. Não encontrei limite de duração numérico no desktop; não inventei regra. Imagens continuam sendo normalizadas pelo upload existente.
5. Citação tocável procura a original por ID real, telefone e instância. Se não estiver carregada, busca trecho limitado (até duas procuras e duas páginas, máximo 101 mensagens), destaca por 1,8 segundo e permite voltar às recentes. Original inexistente tem aviso. Direct continua excluindo comentários no servidor.
6. Arrastar para direita e toque longo com Responder/Copiar. Faixa Respondendo a... e X; envio mantém quotedMessageId real. O código anterior não reservava o gesto horizontal ao navegador, dependia de estado visual para medir deslocamento e tratava cancelamento como final de gesto. No Chrome, o gesto podia ser cancelado pela rolagem/seleção nativa. Agora usa captura de ponteiro, pan-y, deslocamento em referência e cancelamento sem resposta. Não foi reproduzido no aparelho físico do Matthews; o tratamento e os dois gestos foram verificados em Chromium com toque.
7. Escolha de vendedor com a mesma lista ativa/não virtual, chaves por loja e duração de sessão do desktop, inclusive Pular. Nome no topo com Trocar, etiqueta na conversa e Sem vendedor. Minhas filtra no servidor antes de paginar pela identidade vinculada ou ID do vendedor; atribuição/envio existentes preservados.
8. Interrompido: abertura de nova conversa do desktop tem envio próprio sem confirmação incerta/trava síncrona, ignora alguns erros e não filtra a instância de disparos. Corrigir/compartilhar exige autorização para alterar desktop/envio. Detalhes em NOVA-CONVERSA-LIMITE-2026-11-28.md. Nenhum botão inseguro foi liberado.
9. Somente proposta em ORGANIZACAO-ATENDIMENTO-PROPOSTA.md, com sinais existentes, desktop atual e números por hora/instância dos dias 25, 27 e 28/11 (hoje parcial). Separação por vínculo identificado ao pedido e duas réguas de resposta, com limitações explícitas. Nenhuma organização nova ativada.

## Validação

- Suíte: **1.344 testes, 202 arquivos**, todos passaram. Após o último ajuste de identidade do histórico, mais 14 testes focados passaram.
- Testes isolados: gravação não envia ao parar; vídeo/legenda só após confirmação; 64MB aceito e excesso rejeitado; ID real de citação preservado; arrastar/toque longo/cancelamento; arquivo e original ausente; Minhas em 180 conversas e vendedores com/sem usuário vinculado; Direct e permissões existentes.
- Navegador autenticado em 360, 390 e 412 pixels; lista, escolha do vendedor, Minhas, conversa, faixa de resposta e menu. Arrastar selecionou resposta e toque longo abriu menu usando eventos de toque do Chromium.
- A revisão encontrou identidades iguais entre histórico e compositor causando repetição visual; corrigidas. Nova abertura confirmou um único histórico e um único botão de mensagens anteriores, com captura final conferida.
- Sem erro de execução observado; compilação automática OK. Nenhuma mensagem, nota, etiqueta, pedido ou pagamento de teste real.
- Procuras de original: índices existentes, 3,50ms na tabela atual e 3,21ms no arquivo em consultas de ausência; isso não representa custo de uma conversa antiga grande.
- Leituras do WhatsApp: escolha de vendedor acrescenta uma leitura na abertura; após escolha, duas para instâncias/loja, uma do vendedor e uma página de conversas. Conversa acrescenta página de mensagens e, se aberta por URL sem linha conhecida, procura da conversa. Repetições só por eventos, busca/filtro, histórico, visibilidade ou Atualizar; sem polling novo. Tempos de rede observados para páginas: 310–811ms, não são tempos puros do banco nem comparação controlada antes/depois.

## Não homologado em aparelho real

- Gravação/prévia real, permissões da câmera, vídeo com áudio, galeria e formatos entregues pelo Android.
- Envio real de vídeo/resposta e recebimento da citação no WhatsApp pessoal; não autorizado como teste.
- Busca de original fora do trecho carregado na UI real permitida, destaque e retorno; cobertos por testes isolados, não homologados no aparelho.
- Efeito real da atribuição após envio e concorrência entre vendedores; gravação existente não foi exercitada com cliente real.
- Não há medição controlada de desempenho antes/depois ou validação de todos os formatos e limites individuais dos provedores.

## Publicação e pendências

- Consulta Minhas aplicada, somente leitura; nenhuma fila, função de envio, pagamento/checkout ou interruptor foi alterado.
- **Telas dependem da publicação pelo Matthews. Não publiquei.**
- Item 8 aguarda autorização específica para revisar a abertura existente do desktop.
- As três entregas de follow-up continuam na ordem e com a trava anterior; não foram iniciadas neste pedido.