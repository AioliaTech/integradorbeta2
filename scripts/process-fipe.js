const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function separarModeloVersao(modelValue) {
  const palavras = modelValue.trim().split(/\s+/);
  const modeloParts = [palavras[0]];
  
  for (let i = 1; i < palavras.length; i++) {
    if (/^\d+$/.test(palavras[i])) modeloParts.push(palavras[i]);
    else break;
  }
  
  return {
    modelo: modeloParts.join(' '),
    versao: palavras.slice(modeloParts.length).join(' ') || null
  };
}

function extrairDados(versao) {
  const u = versao.toUpperCase();
  let categoria = null, combustivel = null;
  
  if (u.includes('SUV')) categoria = 'SUV';
  else if (u.includes('SEDAN')) categoria = 'Sedan';
  else if (u.includes('HATCH')) categoria = 'Hatch';
  else if (u.includes('PICKUP')) categoria = 'Caminhonete';
  
  if (u.includes('FLEX')) combustivel = 'Flex';
  else if (u.includes('DIESEL')) combustivel = 'Diesel';
  else if (u.includes('GASOLINA') || u.includes('GAS.')) combustivel = 'Gasolina';
  else if (u.includes('ELETRICO') || u.includes('ELÉTRICO')) combustivel = 'Elétrico';
  
  return { categoria, combustivel };
}

async function processarTipo(tipo) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔄 PROCESSANDO ${tipo}`);
  console.log('='.repeat(60));
  
  // Buscar dados
  let allData = [];
  let page = 0;
  const pageSize = 5000;
  
  while (true) {
    const { data, error, count } = await supabase
      .from('fipe')
      .select('"Brand Code", "Brand Value", "Model Value"', { count: 'exact' })
      .eq('"Type"', tipo)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error) {
      console.error(`❌ ERRO ao buscar dados:`, error);
      return;
    }
    
    if (!data || data.length === 0) break;
    
    allData.push(...data);
    console.log(`📄 Página ${page + 1}: ${data.length} registros | Total: ${allData.length}/${count || '?'}`);
    
    if (data.length < pageSize) break;
    page++;
  }
  
  if (allData.length === 0) {
    console.log(`⚠️ Nenhum dado encontrado para ${tipo}`);
    return;
  }
  
  console.log(`\n✅ TOTAL LIDO: ${allData.length} linhas\n`);
  
  // Processar
  const marcasMap = new Map();
  const modelosMap = new Map();
  const versoesMap = new Map();
  
  allData.forEach(item => {
    const code = item['Brand Code'];
    let brand = item['Brand Value'];
    
    if (!code || !brand) return;
    
    brand = brand.replace(/^GM - /i, '').replace(/^FIAT - /i, '').replace(/^VW - /i, '');
    
    if (!marcasMap.has(code)) {
      marcasMap.set(code, { 
        type: tipo, 
        brand_code: String(code), 
        brand_value: brand 
      });
    }
    
    const { modelo, versao } = separarModeloVersao(item['Model Value']);
    const modeloKey = `${code}-${modelo}`;
    
    if (!modelosMap.has(modeloKey)) {
      modelosMap.set(modeloKey, { 
        type: tipo, 
        brand_code: String(code), 
        model_name: modelo 
      });
    }
    
    if (versao) {
      const versaoKey = `${code}-${modelo}-${versao}`;
      if (!versoesMap.has(versaoKey)) {
        const { categoria, combustivel } = extrairDados(versao);
        versoesMap.set(versaoKey, {
          type: tipo,
          brand_code: String(code),
          model_name: modelo,
          version: versao,
          categoria,
          combustivel
        });
      }
    }
  });
  
  console.log(`📊 ESTATÍSTICAS:`);
  console.log(`   - Marcas únicas: ${marcasMap.size}`);
  console.log(`   - Modelos únicos: ${modelosMap.size}`);
  console.log(`   - Versões únicas: ${versoesMap.size}\n`);
  
  // ===== INSERIR MARCAS =====
  const marcas = Array.from(marcasMap.values());
  if (marcas.length > 0) {
    console.log(`📤 INSERINDO ${marcas.length} MARCAS...`);
    console.log(`   Amostra:`, marcas.slice(0, 3));
    
    const { data: insertedData, error: insertError } = await supabase
      .from('fipe_marcas_unicas')
      .upsert(marcas, { 
        onConflict: 'type,brand_code',
        ignoreDuplicates: false 
      })
      .select();
    
    if (insertError) {
      console.error(`❌ ERRO AO INSERIR MARCAS:`, insertError);
      console.error(`   Código:`, insertError.code);
      console.error(`   Mensagem:`, insertError.message);
      console.error(`   Detalhes:`, insertError.details);
    } else {
      console.log(`✅ MARCAS INSERIDAS: ${insertedData?.length || marcas.length}`);
      
      // Verificar se realmente inseriu
      const { count } = await supabase
        .from('fipe_marcas_unicas')
        .select('*', { count: 'exact', head: true })
        .eq('type', tipo);
      
      console.log(`✅ VERIFICAÇÃO: ${count} marcas na tabela para tipo ${tipo}`);
    }
  }
  
  // ===== INSERIR MODELOS =====
  const modelos = Array.from(modelosMap.values());
  if (modelos.length > 0) {
    console.log(`\n📤 INSERINDO ${modelos.length} MODELOS (em lotes de 1000)...`);
    
    for (let i = 0; i < modelos.length; i += 1000) {
      const batch = modelos.slice(i, i + 1000);
      
      const { error } = await supabase
        .from('fipe_modelos_unicos')
        .upsert(batch, { 
          onConflict: 'type,brand_code,model_name',
          ignoreDuplicates: false 
        });
      
      if (error) {
        console.error(`❌ ERRO lote ${i}-${i + 1000}:`, error.message);
      } else {
        console.log(`   ✅ Lote ${i}-${i + batch.length} inserido`);
      }
    }
    
    const { count } = await supabase
      .from('fipe_modelos_unicos')
      .select('*', { count: 'exact', head: true })
      .eq('type', tipo);
    
    console.log(`✅ VERIFICAÇÃO: ${count} modelos na tabela para tipo ${tipo}`);
  }
  
  // ===== INSERIR VERSÕES =====
  const versoes = Array.from(versoesMap.values());
  if (versoes.length > 0) {
    console.log(`\n📤 INSERINDO ${versoes.length} VERSÕES (em lotes de 500)...`);
    
    for (let i = 0; i < versoes.length; i += 500) {
      const batch = versoes.slice(i, i + 500);
      
      const { error } = await supabase
        .from('fipe_versoes_unicas')
        .upsert(batch, { 
          onConflict: 'type,brand_code,model_name,version',
          ignoreDuplicates: false 
        });
      
      if (error) {
        console.error(`❌ ERRO lote ${i}-${i + 500}:`, error.message);
      } else {
        console.log(`   ✅ Lote ${i}-${i + batch.length} inserido`);
      }
    }
    
    const { count } = await supabase
      .from('fipe_versoes_unicas')
      .select('*', { count: 'exact', head: true })
      .eq('type', tipo);
    
    console.log(`✅ VERIFICAÇÃO: ${count} versões na tabela para tipo ${tipo}`);
  }
  
  console.log(`\n🎉 ${tipo} CONCLUÍDO!\n`);
}

async function main() {
  console.log('🚀 INICIANDO PROCESSAMENTO FIPE\n');
  
  const tipos = ['CAR', 'MOTORCYCLE', 'TRUCK'];
  
  for (const tipo of tipos) {
    await processarTipo(tipo);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅✅✅ PROCESSAMENTO COMPLETO ✅✅✅');
  console.log('='.repeat(60));
}

main().catch(console.error);
