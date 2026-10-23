# Rascunho do cadastro em tempo real (autoatendimento → ficha do chat)

## Objetivo
Tudo que a cliente digita no formulário do `/pedido/:slug` aparece em tempo real na ficha da cliente no chat da live, sem ela clicar em "Confirmar cadastro". O cadastro oficial só muda quando ela confirma.

## Como vai funcionar
1. **Rascunho salvo aos poucos (página da cliente):** cada campo digitado é enviado ao backend com uma pausa curta (~1 s após parar de digitar) e gravado numa coluna `form_draft` (JSON) na tabela `live_selfservice_accesses`, junto da sessão daquela cliente. Se ela sair e voltar com o mesmo WhatsApp, o formulário já vem preenchido de onde parou (rascunho tem prioridade sobre o cadastro antigo).
2. **Espelho em tempo real (chat da live):** a ficha da cliente (painel lateral do chat) se inscreve em tempo real na linha do rascunho (filtro por evento + telefone). Ao receber atualização, preenche só os campos com conteúdo novo, sem apagar o que a vendedora digitou na hora. Uma atualização por digitação pausada; a tabela fica habilitada no canal de tempo real.
3. **Ao confirmar:** o rascunho vira cadastro oficial (fluxo atual inalterado) e o rascunho é limpo.

## Arquivos
- Migração: coluna `form_draft jsonb` em `live_selfservice_accesses` + realtime na tabela.
- `supabase/functions/live-selfservice/index.ts`: ação nova `draft` (grava rascunho) e `identify` devolve o rascunho salvo.
- `src/pages/SelfServiceOrderPage.tsx`: envio do rascunho com pausa + restauração ao voltar.
- `src/components/CustomerFichaDialog.tsx`: inscrição em tempo real e preenchimento dos campos (só para pedidos de eventos no modo autoatendimento).

## Limites
- Só vale para eventos no modo "WhatsApp + Cadastro online".
- Não toca no cadastro oficial nem nos outros modos de live.
- Não publicar.
