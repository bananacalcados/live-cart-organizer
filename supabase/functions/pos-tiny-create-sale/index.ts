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
    const { store_id, seller_id, customer, items, payment_method_id, payment_method_name, discount, notes } = await req.json();
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

    // Build Tiny order
    const subtotal = items.reduce((s: number, i: any) => s + (i.price * i.quantity), 0);
    const total = subtotal - (discount || 0);

    const tinyOrder = {
      pedido: {
        situacao: 'aprovado',
        data_pedido: new Date().toLocaleDateString('pt-BR'),
        ...(customer?.name && {
          cliente: {
            nome: customer.name,
            cpf_cnpj: customer.cpf || '',
            email: customer.email || '',
            fone: customer.whatsapp || '',
            ...(customer.address && { endereco: customer.address }),
            ...(customer.cep && { cep: customer.cep.replace(/\D/g, '') }),
            ...(customer.city && { cidade: customer.city }),
            ...(customer.state && { uf: customer.state }),
          },
        }),
        itens: items.map((item: any) => ({
          item: {
            codigo: item.sku || '',
            descricao: `${item.name}${item.variant ? ` - ${item.variant}` : ''}`,
            unidade: 'UN',
            quantidade: item.quantity,
            valor_unitario: item.price,
          },
        })),
        ...(discount && discount > 0 && { valor_desconto: discount }),
        ...(payment_method_name && {
          forma_pagamento: payment_method_name,
        }),
        ...(seller_id && {
          id_vendedor: seller_id,
        }),
        ...(notes && { obs: notes }),
      },
    };

    console.log('Creating Tiny order:', JSON.stringify(tinyOrder));

    const tinyResp = await fetch('https://api.tiny.com.br/api2/pedido.incluir.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&pedido=${encodeURIComponent(JSON.stringify(tinyOrder))}`,
    });

    const tinyData = await tinyResp.json();
    console.log('Tiny create order response:', JSON.stringify(tinyData));

    if (tinyData.retorno?.status === 'OK' || tinyData.retorno?.status === 'Processado') {
      const records = tinyData.retorno?.registros?.registro || tinyData.retorno?.registros;
      const tinyOrderId = records?.id || records?.[0]?.id || null;
      const tinyOrderNumber = records?.numero || records?.[0]?.numero || null;

      // Save sale to pos_sales
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
          tiny_order_id: String(tinyOrderId),
          tiny_order_number: tinyOrderNumber ? String(tinyOrderNumber) : null,
          status: 'completed',
        })
        .select('id')
        .single();

      if (sale) {
        // Save sale items
        const saleItems = items.map((item: any) => ({
          sale_id: sale.id,
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
        sale_id: sale?.id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const errorMsg = tinyData.retorno?.erros?.[0]?.erro || JSON.stringify(tinyData.retorno);
    throw new Error(`Tiny ERP error: ${errorMsg}`);
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
