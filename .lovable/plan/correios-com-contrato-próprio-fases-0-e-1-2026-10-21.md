# Correios com contrato próprio — fases 0 e 1

## Resultado
- Administração ganha a aba **Correios (contrato)**, visível só para admin, com credenciais, remetente, ambiente, serviços, Salvar e Testar conexão.
- **PDV > Expedição > Conferência**, no detalhe do pedido, ganha **Cotar fretes** junto da seleção de transportadora. Mostra Correios do contrato e Frenet, preços, prazos, pacote editável e escolha da opção.
- O fluxo antigo de expedição, Frenet, emissão fiscal, rastreio e lançamento do custo de envio continuam preservados. Não inclui etiquetas, coleta ou reversa.

## Fase 0 — configuração e conexão
1. Criar `correios_settings` com linha única, remetente Pérola informado, SEDEX 03220/PAC 03298 e integração inicialmente desativada. Sem acesso direto de usuários às credenciais; acesso à tabela exclusivamente por service role.
2. Criar os auxiliares CWS em `_shared/correios.ts`: autenticação pelo cartão, cache/renovação do token a menos de 30 minutos de validade, bases por ambiente, timeout de 15 segundos e tratamento das mensagens de erro.
3. Criar `correios-admin` com JWT validado no código e autorização admin no servidor:
   - Ler configuração sem retornar código de acesso, token ou outros segredos; mostrar somente indicação de configuração e quatro últimos caracteres do código.
   - Salvar campos enviados, preservar código vazio e invalidar cache quando as credenciais/ambiente mudarem; registrar o usuário responsável.
   - Testar autenticação e consultar preço/prazo dos dois serviços para 35051520 → 01310100, 500g, 30×20×12cm. Mostrar os metadados seguros e os resultados/erros.
4. Criar `src/components/admin/CorreiosSettingsPanel.tsx` e integrar a aba em `src/pages/Admin.tsx`.

## Fase 1 — fretes na Conferência
1. Criar `sale_freight_quotes` para pacote, opções, erros, autor/data e opção selecionada; leitura autenticada e escrita somente pelo servidor. Sem reutilizar as tabelas antigas.
2. Criar `sale-freight-quote`, validando JWT, acesso PDV/expedição e acesso à venda no servidor:
   - Buscar itens e dados de peso/dimensões em lotes por identificadores, sem consultas por item.
   - Aplicar prioridade variante → produto → categoria → 0,7kg/par; comprimento/largura máximos, altura somada pela quantidade; validar 15×10×1cm mínimo, 100cm por lado e soma até 200cm.
   - Usar o CEP do remetente configurado para ambas as fontes e o CEP real da venda para destino.
   - Correios: uma chamada de preço e uma de prazo pelos serviços ativos; converter corretamente strings monetárias com vírgula e não enviar valor declarado.
   - Frenet: manter endpoint/token existentes, filtrar serviços com erro; fontes independentes, sem fallback que esconda a falha de uma delas. Correios desativado retorna somente Frenet.
   - Aceitar pacote ajustado para recotação, com validação no servidor, sem modificar dimensões cadastradas dos produtos.
   - Seleção recebe o identificador da cotação e da opção já persistida, nunca preço/transportadora arbitrários do navegador. Gravar opção e transportadora/tipo coerentes na venda de forma atômica, sem alterar pagamento ou frete cobrado à cliente.
3. Criar `ExpFreightQuotePanel.tsx`, integrado em `ExpConferenceDialog.tsx`, seção **3. Envio e rastreio**, junto de `ExpShippingFields`:
   - Todas as opções ordenadas por preço, badges Contrato/Mais barato/Mais rápido, erros separados por fonte.
   - Peso e medidas editáveis, recotação explícita; opções anteriores não podem ser usadas após editar o pacote sem recotar.
   - “Usar esta opção” preenche os campos locais usados ao finalizar a Conferência, incluindo custo e prazo, para a finalização não sobrescrever a escolha recém-gravada.
   - Não exibir para retirada/mototáxi.
4. Mostrar data/hora da última cotação no card do pedido em `POSExpedition.tsx`, carregando as últimas cotações somente para os pedidos da página, em lote, com acesso para recotar na Conferência.

## Consultas e desempenho
- Admin: uma chamada de configuração ao abrir a aba, além da verificação de acesso; sem polling.
- Conferência: uma leitura adicional da última cotação ao abrir o detalhe; manter as consultas existentes da tela.
- Lista de pedidos: uma leitura em lote para a página visível, sem consulta por card.
- Cotação somente por clique: buscas de venda/itens/produtos em lotes limitados; até duas chamadas CWS (mais token se necessário) e uma chamada Frenet. Nenhum cron/polling novo.
- Conferir índices e planos das consultas novas em tabelas grandes antes da entrega.

## Premissas
- Email e complemento do remetente ficam vazios, pois não foram informados.
- Onde produto/categoria não tiverem medidas, usar caixa padrão **30×20×12cm por par**, identificada como padrão e ajustável antes de recotar. Peso mantém o fallback solicitado de 0,7kg/par.
- Para envios unificados, o pacote deve incluir todos os itens do agrupamento e a opção deve ser aplicada aos pedidos do mesmo envio, respeitando as regras atuais de unificação; não cotar somente um pedido e apresentar como o pacote completo.
- Manter o padrão de JWT validado no código usado pelo projeto, compatível com as chaves atuais; não ativar validação incompatível no gateway das funções.
- Não publicar nesta solicitação, pois não houve pedido para publicar.

## Validação e entrega
- Testes para conversão BRL, cache de token/renovação, peso por prioridade/quantidade, medidas/limites, serviços ativos, falhas independentes e autorização de configuração/seleção.
- Conferir telas com sessão autorizada, salvamento/leitura da configuração sem expor segredos, lista de opções, recotação e seleção preservada na Conferência; sem realizar envio ou cobrança.
- Conexão real ao contrato depende de você preencher as credenciais na nova aba. Sem elas, não afirmar que autenticação/preços Correios foram validados.
- Informar ao final os componentes exatos, funções/tabelas criadas, testes realizados e qualquer bloqueio restante.