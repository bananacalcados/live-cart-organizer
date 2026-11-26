# Preço do cadastro (Legacy) x preço no PDV

## 1) Origem do "preço próprio" gravado sem necessidade (conferido no código)

Fluxos que gravam o preço do pai como preço próprio da variação:

| Fluxo | O que faz hoje | Correção |
|---|---|---|
| Estoque > Novo produto (ProductMasterForm) | Se a variação não tem preço, copia o do pai para `sale_price_override` e `cost_price_override` ("herança"). **Foi isso que travou o Tamanco em 79,99.** | Enviar vazio quando igual ou vazio |
| Função do banco `create_product_with_variants` | Grava o que o formulário manda | Gravar nulo quando igual ao pai (proteção no servidor) |
| Editar produto (ProductEditDialog) — variações novas e existentes | Grava o que está no campo; se alguém digitou o mesmo valor do pai, vira preço próprio | Igual ao pai = nulo |
| Espelho PDV → cadastro (`sync_pos_product_to_estoque`, quando surge produto no PDV sem variação) | Cria variação com preço próprio = preço do PDV | Nulo quando igual ao pai |
| Importar cor da Shopify (`import_shopify_missing_color`) | Preço próprio = preço da Shopify, sempre | Nulo quando igual ao pai |
| Entrada por NF-e (nfe-link-items-pos) | Grava só custo próprio = custo da nota | Nulo quando igual ao custo do pai (custo fica só nesta normalização, sem regra nova) |

Não gravam preço próprio (só leem): create-master-product-pos, pos-add-variants, sync-master-product-stock, create/update-master-product-shopify. Não mudam.

Regra única: valor próprio só é gravado quando é DIFERENTE do pai (vazio, 0 ou igual = nulo). Uma função pequena no front (`normalizeVariantOverride`) e a mesma regra em SQL. Dados existentes NÃO são alterados.

## 2) Regra no banco (sem cron, sem polling)

### O que existe hoje (conferido)
- pos_products: `trg_mirror_pos_product_cost_price` (ao mudar preço/custo, preenche só lojas com o mesmo código de barras que estão ZERADAS; já ignora chamadas encadeadas), `trg_pos_products_price_tier` (recalcula a faixa de preço), demais gatilhos são de estoque/nome — não reagem a preço.
- product_variants: `trg_variant_to_pos` (só cor/tamanho/sku/gtin), não propaga preço.
- products_master: `trg_master_name_to_pos` (só nome), não propaga preço.
- **Nada no banco propaga preço hoje**; só o "Salvar" da tela de edição faz isso (passo 5 do salvar, por SKU).
- Ligação PDV ↔ variação usada pelo sistema (`sync_master_to_pos`): `tiny_variant_id = tiny_id` OU `sku = sku` OU `gtin = barcode`. Usaremos exatamente a mesma.

### Shopify
Mudar preço no PDV não dispara nada para a Shopify: o único envio automático (`shopify-mirror-stock`) sai da venda e manda só estoque. A regra nova não cria efeito na Shopify.

### Migração proposta
```sql
CREATE OR REPLACE FUNCTION public.propagate_master_price_to_pos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN RETURN NEW; END IF;
  PERFORM set_config('app.sync_in_progress','on',true);
  UPDATE public.pos_products pp
     SET price = NEW.sale_price, updated_at = now()
   WHERE pp.price IS DISTINCT FROM NEW.sale_price
     AND EXISTS (
       SELECT 1 FROM public.product_variants v
        WHERE v.master_id = NEW.id
          AND COALESCE(v.sale_price_override,0) = 0
          AND ((v.tiny_variant_id IS NOT NULL AND v.tiny_variant_id = pp.tiny_id::text)
            OR (v.sku  IS NOT NULL AND v.sku  = pp.sku)
            OR (v.gtin IS NOT NULL AND v.gtin = pp.barcode)));
  PERFORM set_config('app.sync_in_progress','off',true);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_master_price_to_pos
AFTER UPDATE OF sale_price ON public.products_master
FOR EACH ROW WHEN (OLD.sale_price IS DISTINCT FROM NEW.sale_price)
EXECUTE FUNCTION public.propagate_master_price_to_pos();

CREATE OR REPLACE FUNCTION public.propagate_variant_price_to_pos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_price numeric;
BEGIN
  IF public.is_sync_in_progress() THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(NEW.sale_price_override,0), m.sale_price)
    INTO v_price FROM public.products_master m WHERE m.id = NEW.master_id;
  IF v_price IS NULL OR v_price <= 0 THEN RETURN NEW; END IF;
  PERFORM set_config('app.sync_in_progress','on',true);
  UPDATE public.pos_products pp
     SET price = v_price, updated_at = now()
   WHERE pp.price IS DISTINCT FROM v_price
     AND ((NEW.tiny_variant_id IS NOT NULL AND pp.tiny_id::text = NEW.tiny_variant_id)
       OR (NEW.sku  IS NOT NULL AND pp.sku = NEW.sku)
       OR (NEW.gtin IS NOT NULL AND pp.barcode = NEW.gtin));
  PERFORM set_config('app.sync_in_progress','off',true);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_variant_price_to_pos
AFTER UPDATE OF sale_price_override ON public.product_variants
FOR EACH ROW WHEN (OLD.sale_price_override IS DISTINCT FROM NEW.sale_price_override)
EXECUTE FUNCTION public.propagate_variant_price_to_pos();

REVOKE EXECUTE ON FUNCTION public.propagate_master_price_to_pos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.propagate_variant_price_to_pos() FROM PUBLIC, anon, authenticated;
```
Mais: ajuste das três funções do banco do item 1 para gravar nulo quando igual ao pai.

Observações:
- Só dispara quando o valor muda e só toca linhas daquele produto/variação; não regrava linha com preço igual.
- Nunca grava 0/nulo no PDV.
- Sem laço: usa a mesma trava de sincronização dos gatilhos de nome; o espelho por código de barras não reage a chamadas encadeadas, e a faixa de preço é recalculada normalmente (efeito desejado).
- Variação com preço próprio 0 conta como "sem preço próprio" (resolve a sapatilha das 2 linhas a 0,00 só se o pai for alterado depois; não mexo nela agora).
- Duplicação: o passo 5 do "Salvar" passa a repetir o que o banco já fez. Ele pode continuar sem risco (o resultado é igual), mas recomendo tirar dele preço e custo... **preço sim, custo não** (custo segue só pelo "Salvar" até o Matthews decidir). Categoria continua no "Salvar".
- Custo: recomendo deixar FORA agora. Custo muda com NF-e e o custo da venda já é congelado no item vendido; incluir depois, com o ok do Matthews, usando o mesmo desenho.

## 3) Tela "Editar produto"

Ao salvar com o preço do pai alterado:
- Variações com preço próprio igual ao preço ANTIGO do pai: janela "Aplicar o novo preço a todas as X variações?" — Sim = limpa o preço próprio delas (vão seguir o pai); Não = mantém.
- Variações com preço próprio diferente: aviso discreto "N variações têm preço próprio (R$ …)" — sem pergunta, sem mudança.
- Salvar continua igual no resto.

## Arquivos
- `src/components/inventory/ProductMasterForm.tsx` — parar de copiar o preço/custo do pai.
- `src/components/inventory/ProductEditDialog.tsx` — normalização, pergunta/aviso, passo 5 sem preço.
- `src/lib/variantPriceOverride.ts` (novo) + teste.
- `supabase/functions/nfe-link-items-pos/index.ts` — custo igual ao pai = nulo.
- Uma migração (gatilhos + 3 funções do banco).
- `AGENTS.md` — regra: preço do PDV segue o cadastro via gatilho.

## Riscos no PDV
- Venda em andamento: o carrinho já guarda o preço no item; a mudança vale para o próximo bipe. Venda paga não muda.
- Preço promocional: se alguém pôs promoção direto no PDV (sem preço próprio no cadastro), uma mudança no pai sobrescreve. Hoje o "Salvar" já fazia isso; o risco novo é mudanças no pai fora da tela (ex.: importações). A auditoria mostrou o PDV batendo com o cadastro em 3.393 de 3.395 linhas, então não há promoções desse tipo hoje.
- Etiquetas: já impressas ficam com o preço antigo; o sistema não reimprime.
- Mudança em massa do preço de muitos pais numa única operação faz várias atualizações em sequência (rápidas, só as linhas do produto).

## Como desfazer
`DROP TRIGGER trg_master_price_to_pos` e `trg_variant_price_to_pos` (o resto do sistema volta a ser como hoje). O front volta pelo histórico.

## Testes (transação com rollback, sem tocar produto real)
- Mudar preço do pai: variação sem preço próprio atualiza nas 3 lojas; com preço próprio não muda.
- Mudar preço próprio; limpar (null) → volta ao pai; pôr 0 → volta ao pai.
- Pai com preço 0/nulo → PDV não muda.
- Produto sem linhas no PDV → nada acontece, sem erro.
- Mesmo valor → gatilho não dispara.
- Faixa de preço recalculada; espelho por código de barras não entra em laço.
- Tempo do gatilho medido num produto com ~12 variações × 3 lojas.
- Testes automáticos da regra "igual ao pai = nulo" e da pergunta (quem entra / quem só vira aviso).

Não conseguirei testar: carrinho aberto real no PDV, etiquetas, importação real da Shopify/NF-e, nem salvar na tela com produto real (só simulado).

Nenhum preço de produto existente será alterado.
