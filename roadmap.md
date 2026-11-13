# Condições da vaga de vendedor(a) — RH (13/11)
- [x] Montar a pergunta a partir do resumo atual da vaga, sem alterar pontuação ou avaliação
- [x] Gravar a versão somente nos novos envios; antigos permanecem nulos e identificados como condição anterior
- [x] Mostrar o selo na lista e no detalhe do RH
- [x] Rodar testes da pergunta, do registro e das regras existentes; preservar todos os dados de candidatos

# Comprovante autorizado da Fabiane (12/11)
- [x] Enviado uma única vez pelo Whats Pérola, última instância de atendimento, às 23:16:07 UTC; documento entregue e campos de envio preenchidos
- [x] Vera Lúcia Pinheiro, Vera Lúcia Santos e Josiane Azevedo marcadas como antigas que não devem ser enviadas, por decisão do dono
- [x] Conferidos horário, documento, idempotência e ausência de envios não autorizados

# Vínculo do cadastro da live ao pedido (12/11 — urgente)
- [x] Confirmar e corrigir a busca por Instagram e a reutilização da ficha com pedido
- [x] Impedir que a confirmação zere vínculos válidos; resolver divergência por Instagram sem afrouxar conflitos
- [x] Recuperar cinco cadastros e nove pedidos, realinhar a duplicata da Maria Elisa, sem apagar pedidos nem enviar mensagens
- [x] Testar as duas causas e regressões; conferir os casos recuperados e listar os 41 cadastros sem pedido compatível

# Ajustes aprovados — suporte, trocas e comprovantes (12/11)
- [x] Resposta vazia sem pendência vira "nada"; retirar Jaqueline da fila sem apagar histórico
- [x] Sugerir numeração +1/−1 nas trocas abertas e mostrar no cartão e na separação
- [x] Enviar automaticamente comprovantes novos, com idempotência e erro visível; enviar somente o autorizado da Vânia e listar os antigos
- [x] Criar consulta de estorno para o agente, preservando travas e roteiro enxuto
- [x] Testar cada regra, conferir envio/horário da Vânia, modo automático e ausência de envios antigos

# Falhas da IA do suporte (12/11)
- [x] Diagnosticar as cinco respostas vazias: falha local, sem chamada válida registrada para os cinco IDs; respostas completas do lote eram de outras conversas
- [x] Corrigir histórico/mídia e conclusão da IA, com até duas tentativas registradas e modelo alternativo na última; vazio sem ferramenta também tenta de novo
- [x] Reprocessar as cinco sem duplicar resposta humana/automática: Eloisa enviada; Lídia e Vânia para humano; Cida ignorada; Jaqueline na reserva após os dois modelos
- [x] Alertar no painel acima de 10% em uma hora, contando apenas chamadas reais e não decisões locais
- [x] Testar e verificar o painel logado; 28 testes Deno e 25 Vitest; front não publicado

# Trocas e Devoluções dentro da Expedição (12/11)
- [x] Mover o módulo completo para uma nova aba da Expedição, manter sub-abas/permissões e redirecionar a rota antiga
- [x] Criar "Em suporte" com 29 conversas reais da linha SUPORTE, vínculos, busca inclusive por pedido curto, espera e atualização de 30 s
- [x] Reutilizar o chat do PDV na instância correta, sem janela duplicada nem corte no celular, atualizando ao fechar
- [x] 28 testes e navegador em computador/celular; todas as sub-abas e rota antiga conferidas, sem envios, notas, estornos ou publicação

# Teste completo da Central
- [x] Quatro links em 360px: troca/devolução da Dayse, Ana fora do prazo e Leila sem entrega confirmada
- [x] Dry-runs fiscal/Correios com código fictício, destinatário do XML e WhatsApp somente montado; clique duplo idempotente
- [x] Links inválido/tipo errado/vencido genéricos; equipe gera TESTE enquanto fechada; painel etiqueta e exclusão conferidos
- [x] Solicitações e links auxiliares apagados; 66 testes; nenhuma NF-e/reversa/mensagem real, Central fechada e front não publicado

# Central automática e caixa de saída do assistente
- [x] Central: registro/troca, simulação fiscal, reversa idempotente, código na página e mensagem; falhas escaladas, sem nota/reversa real nos testes
- [x] Assistente: outbox restrito às 4 instâncias, 30/hora, 1.000 caracteres, janela Meta e histórico; rotina existente por minuto reutilizada, sem cron novo
- [x] Painel: aba conferida logada; 41 testes; envio real não feito porque nenhum admin tem telefone cadastrado
- [x] Central pública permanece fechada, front não publicado e nenhuma NF-e/reversa real gerada
- [ ] Abertura pública: aguarda piloto real autorizado com NF-e/reversa, telefone admin para teste de WhatsApp e autorização para publicar/ligar a Central

# AustPay — duplicidade de NF-e
- [x] Suporte ao vivo: sombra e 4 instâncias preservadas, filtro 60 dias/palavras/humano, reservas diárias de 2 milhões, quadro conferido e 43 testes; sem envio/movimento/publicação
- [ ] Suporte: habilitar silêncio de 2 minutos após disponibilidade do agendamento HTTP gerenciado; fila preparada e desligada, gatilho imediato preservado
- [x] Trava de estorno: registro/conferência/nota, exceção admin auditada, lista com 54 pendências (R$ 19.939,63), 46 testes e simulação autenticada somente leitura; sem estornar/emitir/cancelar/publicar
- [x] Suporte: histórico multi-instância e sugestão única; roteiro v2, CPF protegida; 58 comparações preservadas, 29 testes e tela conferida sem envio/publicação
- [x] Suporte rodada 3: resolvido=nada, prazo pelo envio, escalada silenciosa, CPF/comentário, consolidação restrita, sugestão única, tom; 58 reprocessadas, 37 testes, tela conferida
- [x] Diagnosticar rejeições 539: numeração reiniciada apesar da sequência do CNPJ já configurada em 2767
- [x] Criar reserva atômica por venda/modelo e trava contra tentativas simultâneas, sem apagar notas autorizadas
- [x] Ligar NF-e/NFC-e/devoluções à numeração reservada, preservar retry com o mesmo número e implantar
- [x] Validar duas chamadas na mesma venda: mesmo documento 2768, uma só reserva, rollback sem consumir número; 43 testes, sem emitir nota real

# Prioridade do produto no overlay
- [x] Corrigir escolha manual escondida pela opção de códigos automáticos e impedir que comentários derrubem o produto atual; E017 visível no overlay, prioridade transacional e 18 testes, sem publicar

# Fila da apresentadora — filtro dos preparados
- [x] Filtrar somente os produtos já separados por código, nome ou cor, sem novas consultas; testado na live, sem publicar

# Fila da apresentadora — tamanhos, promoções e edição em grupo
- [x] Mostrar numerações grandes por código, salvar liberação manual e impedir tamanho bloqueado no pedido por código
- [x] Vincular promoção progressiva ativa da live ao produto preparado, preservando o cálculo e os pedidos existentes
- [x] Selecionar vários produtos e aplicar preço especial/frete grátis em uma única ação
- [x] Testar regras, edição individual/em grupo, cálculo do carrinho e leiaute; 25 testes, T130 restaurado, sem publicar
 
# Enviar cor para a Shopify
- [x] Criar envio por código com dry-run, confirmação, proteção de duplicidade e sem sincronização completa
- [x] Integrar botão nos códigos pendentes e ao de-para existente
- [x] Bloqueio Por código já correto; 17 testes e dry-run T235 com seis tamanhos, sem escrita; nenhuma bolsa pendente

# Fila de produtos da apresentadora
- [x] Auditar seleção/overlay, ofertas, carrinho e etiquetas sem alterar comportamento atual
- [x] Preparar produtos da live com preço/condição/frete específicos e pausa sem remoção
- [x] Aplicar a configuração vigente ao anotar o carrinho, preservando preços manuais e demais modos
- [x] Imprimir etiquetas da fila com preço cheio e preço da oferta
- [x] Testar busca/edição, apresentar/parar, overlay, PDF e cálculo; 30 testes, build limpo, sem publicar
- [x] Foto do produto na busca da fila: cor do espelho Shopify com reserva pela foto do produto; 5 testes, sem publicar
- [x] Cards dos produtos com metade da altura e busca mantida aberta para adicionar vários em sequência; testado sem gravar inclusões
- [x] Cards mais quadrados e pouco mais altos, com nome, cor e preço maiores; conferido em 1705px sem sobreposição

# Previsão de entrega no rastreio
- [x] Auditar onde serviço, CEP e prazo real são gravados e como o link público lê o envio
- [x] Calcular faixa estimada por cotação: +3 dias úteis fixos, exceto SEDEX; preservar data real quando existir
- [x] Exibir a faixa no rastreio sem expor transportadora/código e sem consultas repetidas desnecessárias
- [x] Testar SEDEX, demais modalidades, fins de semana e substituição pela previsão real; não publicar

# Central de Trocas e Devoluções — Fase 2
- [x] Motor compartilhado, tokens isolados e submissão/reserva atômica, sem fiscal; edges fechadas até limite autorizado
- [x] Duas páginas públicas, links no pedido e configuração paginada de reposição
- [x] 17 testes, páginas simuladas 360px e relatório sem publicar
- [ ] Conferência real administrativa/transacional: sessão não exibiu aba; atendimento público depende de proteção aprovada
- [ ] Limites por IP/token: aguarda confirmação do dono sobre proteção ad-hoc

# Correção fiscal da reversa — desconto da venda
- [x] Compartilhar cálculo troca/reversa e aviso fiscal, sem mudar trava de duplicidade
- [x] Conferir oito TDs por SQL e dry_run, simular vínculo sem emissão (25 testes; XML já tinha desconto)
- [x] Implantar nfe-devolucao-emitir e entregar relatório; preservar notas e planos

# Follow-up automático global das lives
- [x] Botão F: toque verificado libera carrinho e sequência; resposta digitada para; simulação sem envio
- [x] Chat: HUMAN_AGENT manual 24h–7 dias somente com permissão comprovada; status e memória
- [ ] Meta: comprovar aprovação Human Agent e aceitar quick reply na resposta privada em teste autorizado (sem envio nesta entrega)
- [x] Auditoria: remetente compartilhado, Instagram privado/janela, chat e LID comprovado; simulação 07/11 sem envio e relatório
- [x] Preservar plano RH idêntico; não implementar RH nem apagar candidato protegido
- [x] Inventariar lembretes existentes e sobreposição
- [x] Configuração global desligada, por tipo e por evento
- [x] Agendamento, paradas, deduplicação e fila segura por instância
- [x] Histórico, números do dia e testes simulados sem mensagens reais
- [x] Relatório de conferência; não publicar
- [ ] Conferir entrega real em live controlada: aguarda autorização, global permanece desligado

# Ajustes atuais — CNPJ e cores Shopify
- [x] Vitrine urgente: ignorar estoque, preservar exclusões manuais e testar bolsa + Spezial 40 até pagamento.
- [x] Priorizar gateway aprovado e criar pendência quando os IDs continuarem ambíguos
- [x] Refazer a simulação de 7 dias e medir os 24 casos resolvidos ou pendentes
- [x] Listar cores ativas na Shopify ausentes no ERP, separando possíveis grafias
- [x] Importar variantes com SKU/numeração/preço e estoque zero; testar Pérola do Samba Cris
- [x] Verificar regras, telas e segurança sem emitir notas nem publicar

# Fiscal — CNPJ emissor pelo gateway
- [x] Mapear emissões automáticas/manuais, NF-e/NFC-e, cancelamentos, correções e devoluções
- [x] Criar configuração segura gateway→empresa, padrão, interruptor desligado e pendência de CNPJs diferentes
- [x] Aplicar seleção e log na emissão sem alterar o comportamento enquanto desligado
- [x] Adicionar configuração, filtro e CNPJ emissor nas telas fiscais e listas/modais de notas
- [x] Desativar somente as duas empresas de teste indicadas
- [x] Testar regras sem emitir notas e simular os últimos 7 dias por CNPJ e pagamentos divididos

# Vínculo ERP ↔ Shopify e de-para de cores
- [x] Rodar relink e refresh dos intents abertos após cada sincronização, retornando o resultado da relink
- [x] Bloquear confirmação do card somente pelos avisos de item definidos, sem duplicar aviso do intent
- [x] Adicionar de-para manual de cores em Estoque → Códigos e religar após salvar
- [x] Testar regras, rodar a sincronização uma vez e informar o jsonb retornado

# Rastreio do contrato próprio dos Correios
- [x] Ligar envios próprios à consulta oficial sem expor transportadora/código real
- [x] Manter Frenet e etapas existentes; testar com envio real e sem publicar

# Auditoria de cadastro e carrinho da live
- [x] Conferir registros reais de cadastro, confirmação e fila de mensagens
- [x] Auditar identificação de pedidos e reproduzir as telas sem cadastrar ou enviar
- [x] Entregar achados comprovados, riscos e próximos passos sem reenvios automáticos

# Reemissão de logística reversa
- [ ] Conferir vínculo da compra, itens e conversa das clientes restantes; separar dúvidas
- [ ] Reemitir somente casos comprovados com NF-e e código; preservar prazo original
- [ ] Enviar código e DANFE espaçados, confirmar registro e listar resultados
- [ ] Andreia fora (Frenet); Gilda e Michelly já enviadas, não reenviar

# Promoções progressivas — reaproveitamento
- [x] Listar e buscar promoções de outras lives, com resumo
- [x] Copiar promoção e produtos sem alterar a original, tratando nome duplicado
- [x] Vincular a cópia ao catálogo e às ofertas da live atual e informar divergências
- [x] Testar “3 por 200” de 05/11 para 07/11 e conferir os vínculos
 
# Segurança — Fase 4
- [x] A1 shopify-create-order: só pedido pago, dados do banco, auth
- [x] A2 shopify-create-live-order: idem
- [x] A3 mercadopago-check-payment: referência E valor
- [x] A4 mercadopago-create-pix: desconto do servidor, override admin
- [x] A5 pagarme-create-charge: valor do body só comparado
- [x] A6 split-payment: total comparado, auth nas mutações
- [x] A7 shopify-webhook: HMAC obrigatório
- [x] A8 checkout-public: update_sale restrito, lookup CPF
- [x] A9 payment-confirmed-hook: só pedido pago
- [x] A10 yampi-create-payment-link / mp-create-boleto / austpay-charge-card
- [ ] B11–B14 destrutivas e conta
- [ ] C15–C17 disparos e mensageria
- [ ] D18 gasto e IA

## Fase 4 — status
- [x] A pagamento/pedidos (implantado)
- [x] B destrutivas/conta (implantado; rotinas fiscais migradas p/ segredo interno)
- [x] C disparo/mensagens (implantado; código da live com limite 3/h telefone, 10/h IP)
- [x] D IA/gasto (implantado; limite de uso por IP)
- [ ] Pendências: validação de assinatura nos webhooks WhatsApp (item 17); identidade do livete-respond (14); valores server-side em Yampi/boleto; split-payment por token de sessão; shopify-webhook precisa do segredo do painel Shopify; botão antigo de pedido Shopify da live (LiveSessionManager); replay MP/Pagar.me com 0 falso negativo

# Central de Trocas — Parte 1 (banco + funções)
- [x] Entrega confirmada J&T/Transportadora no rastreio + backfill + origem da entrega
- [x] Configurações, solicitações, links únicos, elegibilidade e marcador de reposição
- [x] Testes pedidos e relatório final

# Grupo VIP no link da live
- [ ] Plano aguardando aprovação (substituído pelo pedido da Central)
 
# Moderação de comentários do Instagram
- [x] Fila, IA, ocultar, direct de rastreio, tela e testes (interruptor desligado)
- [ ] Confirmar permissão de ocultar com um comentário de teste real (aguarda o dono ligar)
- [ ] Conferir se comentários de anúncio exclusivo chegam (aguarda um anúncio real comentado)

# Link curto /v/:code para grupos VIP
- [x] Tabela, função de criar e resolver, rota rápida, teste

# Trava NF-e de devolução duplicada (urgente)
- [x] Reversa vincula NF à troca aberta; conferência reusa/bloqueia
- [x] Trava de soma ≤ NF original em nfe-devolucao-emitir
- [x] Bloqueio de 2ª troca aberta com mesmos itens
- [x] Backfill de vínculo + relatórios + testes por SQL

# RH (recrutamento)
- [x] Complemento VAGA: stories/menções conferidos e DM direta incluída; 64 testes passaram e funções implantadas sem publicar, candidato preservado
- [x] Fase 1: banco, links por @, senha da área
- [x] Fase 2: página /vaga/:codigo + rascunho + envio
- [x] Fase 3: pontuação no servidor, avaliação IA isolada e testes
- [x] Fase 4: aba RH, detalhe, senha e configurações; testes e limpeza
- [x] Fase 5: aviso WhatsApp único após avaliação, teste manual e reenvio admin; aviso desligado por padrão
- [x] Automação Instagram VAGA-RH: variações tolerantes só nesta regra, link por @, Direct com botão e resposta pública
- [x] Testes reais de correspondência, idempotência e reserva única; limpar somente dados de teste, preservando o candidato do dono

# Pesquisa nos comentários da apresentadora
- [x] Caixa de busca no painel de comentários: filtra por @ e pelo texto, sem acento/maiúscula, sobre os comentários já carregados (nenhuma consulta nova)
- [x] Testar no painel real da live: 600 → 46 (origin), 9 (comprei), 19 (@elisangel), limpar volta a 600; 5 testes, sem publicar

## Data de envio, prazo, cancelamento antes do envio e rastreio (12/11)
- [x] Data de envio real salva no despacho e corrigida pelo 1º evento da transportadora; retroativo aplicado
- [x] Prazo garantido por envio + 7 dias de volta na Central e no agente
- [x] Cancelamento antes do envio guiado (direto / cancelar nota / nota de entrada só admin / despachado = devolução)
- [x] Rastreio colado como link vira código + transportadora (retroativo)
- [ ] 2 rastreios com formato não reconhecido e 1 venda com transportadora divergente — conferir à mão

# Atendimento automático real autorizado (12/11)
- [x] Troca sem escolha de produto: registro, NF/reversa e mensagem automáticos; novo produto só após conferência (simulação transacional; nenhuma cliente enviou a Central nesta rodada)
- [x] Data de recebimento informada pela cliente com validade anti-burla e registro da origem
- [ ] Rastreio corrigido e rotina de 15 minutos ativa; 225 entregas recuperadas, 231 pedidos ainda aguardando a sequência de reprocessamento em andamento
- [x] Fila elegível processada começando pela Arlete: 5 enviados, 0 pendentes, 0 falhas; demais escalados/ignorados com motivo
- [x] Pausa de emergência testada; nenhum erro de envio, NF ou reversa, modo automático preservado

# Follow-up F e recibos de grupo (12/11)
- [x] Isolar a resolução do Instagram por item, mantendo falhas para nova tentativa sem perder o lote
- [x] Descartar GroupReceipts somente da Pérola/Carol antes do processamento, preservando mensagens, recibos 1:1 e movimentação de grupos
- [x] Conferir eventos reais após o reimplante, testes e registros finais; sem publicar o front

# Roteiro de devolução em etapas e caso Eliani (13/11)
- [x] Substituir link imediato por motivo → oferta sem link → aceite ou devolução; troca direta e originalidade preservadas
- [x] Persistir etapa e permitir continuidade sem o bloqueio de 24h, mantendo intervalo e demais travas; teste transacional reversível
- [x] Roteiro v5 e 80 testes Deno + 15 Vitest; prazo verificado antes de pergunta/oferta e nenhum envio
- [x] Eliani marcada, sem produto novo e com bloqueio até confirmação; aviso no cartão/lista e botão de confirmação humana
- [x] 18 simulações (17 conversas do período + caso inicial da Eliani), 8 mudanças e 10 decisões preservadas; zero saídas criadas, modo auto e roteiro v5 conferidos

# Fase 2 — etiquetas e balanços (13/11)
- [x] Ligar a janela de etiquetas ao saldo da loja e aos lotes de impressão/balanço/entrada.
- [x] Criar o histórico paginado com detalhes, reimpressão e desfazer.
- [ ] Testar regras, build e fluxo no preview sem aplicar balanço real.
