import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, sale_id, seller_id, tiny_seller_id, customer, items, payment_method_id, payment_method_name, discount, notes } = await req.json();
    if (!store_id) throw new Error('store_id is required');
    if (!items || items.length === 0) throw new Error('items is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store token not configured');

    const token = store.tiny_token;
    const subtotal = items.reduce((s: number, i: any) => s + (i.price * i.quantity), 0);
    const total = subtotal - (discount || 0);

    let tinyOrderId: string | null = null;
    let tinyOrderNumber: string | null = null;
    let tinyFailed = false;

    // Helper: build Tiny order payload
    const buildTinyOrder = (orderItems: any[]) => ({
      pedido: {
        situacao: 'aprovado',
        data_pedido: new Date().toLocaleDateString('pt-BR'),
        cliente: customer?.name ? {
          nome: customer.name,
          cpf_cnpj: customer.cpf || '',
          email: customer.email || '',
          fone: customer.whatsapp || '',
          ...(customer.address && { endereco: customer.address }),
          ...(customer.addressNumber && { numero: customer.addressNumber }),
          ...(customer.complement && { complemento: customer.complement }),
          ...(customer.neighborhood && { bairro: customer.neighborhood }),
          ...(customer.cep && { cep: customer.cep.replace(/\D/g, '') }),
          ...(customer.city && { cidade: customer.city }),
          ...(customer.state && { uf: customer.state }),
        } : {
          nome: 'Consumidor Final',
        },
        itens: orderItems.map((item: any) => ({
          item: {
            codigo: item.codigo || item.sku || '',
            descricao: `${item.name}${item.variant ? ` - ${item.variant}` : ''}`,
            unidade: 'UN',
            quantidade: item.quantity,
            valor_unitario: item.price,
          },
        })),
        ...(discount && discount > 0 && { valor_desconto: discount }),
        ...(payment_method_name && { forma_pagamento: payment_method_name }),
        ...(tiny_seller_id && { id_vendedor: tiny_seller_id }),
        ...(notes && { obs: notes }),
      },
    });

    // Helper: search Tiny product by SKU to find child variation code
    const findChildCodeBySku = async (parentCode: string): Promise<string | null> => {
      try {
        // Search by the parent code as SKU
        const searchResp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&pesquisa=${encodeURIComponent(parentCode)}`,
        });
        const searchData = await searchResp.json();
        const produtos = searchData.retorno?.produtos || [];

        for (const p of produtos) {
          const prod = p.produto || p;
          const prodId = prod.id;
          if (!prodId) continue;

          // Get full product details to find variations
          const detailResp = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${token}&formato=json&id=${prodId}`,
          });
          const detailData = await detailResp.json();
          const fullProd = detailData.retorno?.produto;
          if (!fullProd) continue;

          // Check if this is the parent product with variations
          const variacoes = fullProd.variacoes || [];
          if (variacoes.length > 0) {
            // Return the first active variation's code
            const firstVariation = variacoes[0]?.variacao || variacoes[0];
            const childCode = firstVariation?.codigo || firstVariation?.sku;
            if (childCode) {
              console.log(`Found child code "${childCode}" for parent "${parentCode}"`);
              return childCode;
            }
          }
        }
      } catch (e) {
        console.error('Error searching child product by SKU:', e);
      }
      return null;
    };

    // Try to create order in Tiny ERP
    try {
      const orderItems = items.map((item: any) => ({ ...item, codigo: item.sku || '' }));
      let tinyOrder = buildTinyOrder(orderItems);

      console.log('Creating Tiny order:', JSON.stringify(tinyOrder));

      const tinyResp = await fetch('https://api.tiny.com.br/api2/pedido.incluir.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${token}&formato=json&pedido=${encodeURIComponent(JSON.stringify(tinyOrder))}`,
      });

      // Validate response content-type before parsing
      const contentType = tinyResp.headers.get('content-type') || '';
      if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
        const textBody = await tinyResp.text();
        console.error('Tiny returned non-JSON response:', contentType, textBody.substring(0, 300));
        throw new Error(`Tiny API returned non-JSON response (${tinyResp.status})`);
      }

      const tinyData = await tinyResp.json();
      console.log('Tiny create order response:', JSON.stringify(tinyData));

      // Guard against null/empty response
      if (!tinyData || !tinyData.retorno) {
        console.error('Tiny returned null/empty response:', JSON.stringify(tinyData));
        throw new Error('Tiny API returned null response');
      }

      if (tinyData.retorno?.status === 'OK' || tinyData.retorno?.status === 'Processado') {
        const records = tinyData.retorno?.registros?.registro || tinyData.retorno?.registros;
        tinyOrderId = records?.id || records?.[0]?.id || null;
        tinyOrderNumber = records?.numero || records?.[0]?.numero || null;
        
        // Extra guard: if ID came back as null string or undefined, flag as failed
        if (!tinyOrderId) {
          console.error('Tiny returned OK but no order ID in records:', JSON.stringify(tinyData.retorno));
          tinyFailed = true;
        }
      } else {
        // Errors can be at retorno.erros OR retorno.registros.registro.erros
        const topErros = tinyData.retorno?.erros || [];
        const registroErros = tinyData.retorno?.registros?.registro?.erros || [];
        const allErros = [...topErros, ...registroErros];
        const errorMessages = allErros.map((e: any) => e.erro || '').join(' | ');

        // Check for "produto pai" error and retry with child SKU
        if (errorMessages.toLowerCase().includes('produto pai')) {
          console.log('Parent product error detected, attempting to resolve child SKUs...');

          // Extract the problematic product codes from error messages
          const codeMatches = errorMessages.match(/código\s+(\S+)/gi) || [];
          const problemCodes = codeMatches.map((m: string) => m.replace(/código\s+/i, '').trim());

          let resolved = false;
          const updatedItems = [...orderItems];

          for (const problemCode of problemCodes) {
            const childCode = await findChildCodeBySku(problemCode);
            if (childCode) {
              // Replace the parent code with child code in items
              for (const item of updatedItems) {
                if (item.codigo === problemCode || item.sku === problemCode) {
                  item.codigo = childCode;
                  console.log(`Replaced parent "${problemCode}" with child "${childCode}" for item "${item.name}"`);
                  resolved = true;
                }
              }
            }
          }

          if (resolved) {
            // Retry with corrected codes
            tinyOrder = buildTinyOrder(updatedItems);
            console.log('Retrying Tiny order with child SKUs:', JSON.stringify(tinyOrder));

            const retryResp = await fetch('https://api.tiny.com.br/api2/pedido.incluir.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `token=${token}&formato=json&pedido=${encodeURIComponent(JSON.stringify(tinyOrder))}`,
            });

            const retryData = await retryResp.json();
            console.log('Tiny retry response:', JSON.stringify(retryData));

            if (retryData.retorno?.status === 'OK' || retryData.retorno?.status === 'Processado') {
              const records = retryData.retorno?.registros?.registro || retryData.retorno?.registros;
              tinyOrderId = records?.id || records?.[0]?.id || null;
              tinyOrderNumber = records?.numero || records?.[0]?.numero || null;
            } else {
              const retryError = retryData.retorno?.erros?.[0]?.erro || JSON.stringify(retryData.retorno);
              console.error('Tiny retry also failed:', retryError);
              tinyFailed = true;
            }
          } else {
            console.error('Could not resolve child SKUs, saving locally');
            tinyFailed = true;
          }
        } else {
          console.error('Tiny API failed, saving sale locally:', errorMessages);
          tinyFailed = true;
        }
      }
    } catch (tinyError) {
      console.error('Tiny API unreachable, saving sale locally:', tinyError);
      tinyFailed = true;
    }

    // If sale_id is provided, update existing sale instead of creating a new one
    let saleId = sale_id;
    if (sale_id) {
      await supabase
        .from('pos_sales')
        .update({
          seller_id: seller_id || null,
          customer_id: customer?.id || null,
          payment_method: payment_method_name || null,
          tiny_order_id: tinyOrderId ? String(tinyOrderId) : null,
          tiny_order_number: tinyOrderNumber ? String(tinyOrderNumber) : null,
          status: tinyFailed ? 'pending_sync' : 'completed',
        } as any)
        .eq('id', sale_id);
    } else {
      // Create new sale (original flow for POS in-store sales)
      const { data: sale, error: saleError } = await supabase
        .from('pos_sales')
        .insert({
          store_id,
          seller_id: seller_id || null,
          customer_id: customer?.id || null,
          payment_method: payment_method_name || null,
          subtotal,
          discount: discount || 0,
          total,
          tiny_order_id: tinyOrderId ? String(tinyOrderId) : null,
          tiny_order_number: tinyOrderNumber ? String(tinyOrderNumber) : null,
          status: tinyFailed ? 'pending_sync' : 'completed',
        })
        .select('id')
        .single();
      saleId = sale?.id;
    }

    if (saleId && !sale_id) {
      // Only insert items/stock/gamification for NEW sales (not existing checkout sales which already have items)
      const saleItems = items.map((item: any) => ({
        sale_id: saleId,
        sku: item.sku || '',
        product_name: item.name,
        variant_name: item.variant || null,
        size: item.size || null,
        category: item.category || null,
        quantity: item.quantity,
        unit_price: item.price,
        barcode: item.barcode || null,
        tiny_product_id: item.tiny_id ? String(item.tiny_id) : null,
      }));

      await supabase.from('pos_sale_items').insert(saleItems);

      // Update local stock cache (pos_products)
      for (const item of items) {
        if (item.sku) {
          const { data: product } = await supabase
            .from('pos_products')
            .select('id, stock')
            .eq('store_id', store_id)
            .eq('sku', item.sku)
            .maybeSingle();

          if (product) {
            const newStock = Math.max(0, (product.stock || 0) - item.quantity);
            await supabase
              .from('pos_products')
              .update({ stock: newStock, synced_at: new Date().toISOString() })
              .eq('id', product.id);
          }
        }
      }

      // Award gamification points to seller
      if (seller_id) {
        const { data: existingGamification } = await supabase
          .from('pos_gamification')
          .select('id, total_points, sales_count, registrations_count')
          .eq('seller_id', seller_id)
          .eq('store_id', store_id)
          .maybeSingle();

        const salePoints = 10;
        const registrationPoints = customer?.id ? 15 : 0;
        const completenessPoints = customer?.id ? calculateCompletenessPoints(customer) : 0;
        const totalNew = salePoints + registrationPoints + completenessPoints;

        if (existingGamification) {
          await supabase.from('pos_gamification').update({
            total_points: existingGamification.total_points + totalNew,
            sales_count: existingGamification.sales_count + 1,
            registrations_count: existingGamification.registrations_count + (customer?.id ? 1 : 0),
          }).eq('id', existingGamification.id);
        } else {
          await supabase.from('pos_gamification').insert({
            seller_id,
            store_id,
            total_points: totalNew,
            sales_count: 1,
            registrations_count: customer?.id ? 1 : 0,
          });
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tiny_order_id: tinyOrderId,
      tiny_order_number: tinyOrderNumber,
      sale_id: saleId,
      tiny_failed: tinyFailed,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateCompletenessPoints(customer: any): number {
  let points = 0;
  if (customer.email) points += 3;
  if (customer.whatsapp) points += 3;
  if (customer.cpf) points += 2;
  if (customer.address) points += 2;
  if (customer.age_range) points += 3;
  if (customer.preferred_style) points += 3;
  if (customer.cep) points += 2;
  return points;
}