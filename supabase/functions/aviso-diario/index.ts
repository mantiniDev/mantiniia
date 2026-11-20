// aviso-diario — e-mail diário com audiências próximas, publicações novas do DJEN, processos sem andamento
// e lixeira (avisa exclusões; apaga de vez o que passou de 30 dias).
//
// Chamadas aceitas:
//  • Agendador (pg_cron), todo dia: header "x-aviso-token" = segredo do Vault → envia
//    todo dia a quem usa Processos (tem OAB ou processo) e está com o e-mail diário ligado,
//    mesmo sem novidade (o e-mail confirma que as buscas no DJEN rodaram).
//  • Usuário logado (botão "Enviar e-mail de teste"): Authorization: Bearer <token do usuário>
//    → envia só para ele, mesmo que não haja pendências.
//  • Corpo {"dry": true} → não envia; devolve o que seria enviado (para conferência).
//
// Segredos da função (painel do Supabase → Edge Functions → Secrets):
//  RESEND_API_KEY  chave da API do Resend (obrigatória para enviar)
//  EMAIL_FROM      remetente, ex.: "mantini.ia.br <avisos@mantini.ia.br>" (opcional; padrão: onboarding@resend.dev)
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://www.mantini.ia.br';
const TZ = 'America/Sao_Paulo';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- datas no fuso de Brasília ----------
const ymdTz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const diasAte = (iso: string) => {
  const [a, b] = [ymdTz(new Date(iso)), ymdTz(new Date())].map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return Math.round((a - b) / 86400000);
};
const diasDesde = (iso: string) => -diasAte(iso);
const rotulo = (n: number) => (n === 0 ? 'HOJE' : n === 1 ? 'amanhã' : `em ${n} dias`);
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dataBr = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

type Prefs = { email_diario: boolean; dias_aviso_audiencia: number; dias_sem_andamento: number };
const PADRAO: Prefs = { email_diario: true, dias_aviso_audiencia: 7, dias_sem_andamento: 7 };

async function montar(userId: string, prefs: Prefs) {
  const { data: processos, error } = await supabase.from('processos')
    .select('id, numero, tribunal, titulo, status, ultima_publicacao, documento_atual, ultimo_andamento_em, created_at, audiencias(id, data_hora, tipo, local, realizada)')
    .eq('user_id', userId).eq('status', 'ativo').is('excluido_em', null);
  if (error) throw error;

  const auds = (processos ?? []).flatMap((p) => (p.audiencias ?? [])
    .filter((a) => !a.realizada && diasAte(a.data_hora) >= 0 && diasAte(a.data_hora) <= prefs.dias_aviso_audiencia)
    .map((a) => ({ ...a, p }))).sort((a, b) => a.data_hora.localeCompare(b.data_hora));
  // audiências já marcadas para depois do prazo de aviso (para o e-mail não dizer que não há nenhuma)
  const futuras = (processos ?? []).flatMap((p) => (p.audiencias ?? [])
    .filter((a) => !a.realizada && diasAte(a.data_hora) > prefs.dias_aviso_audiencia)
    .map((a) => ({ ...a, p }))).sort((a, b) => a.data_hora.localeCompare(b.data_hora));
  const parados = (processos ?? []).filter((p) => !p.ultimo_andamento_em || diasDesde(p.ultimo_andamento_em) >= prefs.dias_sem_andamento)
    .sort((a, b) => (a.ultimo_andamento_em ?? '').localeCompare(b.ultimo_andamento_em ?? ''));
  // publicações do DJEN que chegaram nas últimas 24 h (buscas das 8h, 13h e 19h)
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: pubs, error: e2 } = await supabase.from('publicacoes')
    .select('processo_id, numero_mascara, numero_processo, sigla_tribunal, nome_orgao, tipo_comunicacao, tipo_documento, data_disponibilizacao, link, processos(titulo, created_at)')
    .eq('user_id', userId).gte('created_at', desde).order('data_disponibilizacao', { ascending: false }).order('created_at', { ascending: false }).limit(500);
  if (e2) throw e2;
  const processosNovos = new Set((pubs ?? []).filter((x) => (procDe(x)?.created_at ?? '') >= desde).map((x) => x.processo_id)).size;
  // lixeira: excluídos nas últimas 24 h e os que serão apagados de vez nos próximos 3 dias
  const { data: lixo, error: e3 } = await supabase.from('processos').select('id, numero, titulo, excluido_em')
    .eq('user_id', userId).not('excluido_em', 'is', null).order('excluido_em', { ascending: false });
  if (e3) throw e3;
  const excluidos = (lixo ?? []).filter((p) => p.excluido_em! >= desde);
  const expirando = (lixo ?? []).filter((p) => Date.parse(p.excluido_em!) + (DIAS_LIXEIRA - 3) * 864e5 <= Date.now());
  // documentos excluídos nas últimas 24 h (de processos que não estão na lixeira)
  const { data: dl, error: e4 } = await supabase.from('documentos').select('nome, processo_id, excluido_em, processos!inner(numero, excluido_em)')
    .eq('user_id', userId).gte('excluido_em', desde).is('processos.excluido_em', null);
  if (e4) throw e4;
  const docsExcluidos = (dl ?? []).map((d) => ({ nome: d.nome, processo_id: d.processo_id, excluido_em: d.excluido_em!, numero: (d.processos as unknown as { numero: string }).numero }));
  // situação das buscas no DJEN (para o e-mail mostrar que rodaram, mesmo sem publicação)
  const { data: oabs, error: e5 } = await supabase.from('oabs').select('numero, uf, ativo, ultima_busca, ultimo_resultado')
    .eq('user_id', userId).order('created_at');
  if (e5) throw e5;
  // prazos em aberto que vencem nos próximos 7 dias (ou já venceram) e publicações aguardando definição de prazo
  const ate = ymdTz(new Date(Date.now() + 7 * 864e5));
  const { data: pz, error: e6 } = await supabase.from('prazos').select('id, descricao, vencimento, processo_id, processos(numero, titulo, excluido_em)')
    .eq('user_id', userId).is('cumprido_em', null).lte('vencimento', ate).order('vencimento');
  if (e6) throw e6;
  const prazos = (pz ?? []).filter((x) => !(x.processos as unknown as { excluido_em: string | null })?.excluido_em)
    .map((x) => ({ ...x, proc: x.processos as unknown as { numero: string; titulo: string | null }, dias: diasAte(x.vencimento + 'T12:00:00-03:00') }));
  const { count: semPrazo, error: e7 } = await supabase.from('publicacoes').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('prazo_status', null).not('processo_id', 'is', null).gte('data_disponibilizacao', ymdTz(new Date(Date.now() - 30 * 864e5)));
  if (e7) throw e7;
  return { prazos, semPrazo: semPrazo ?? 0, auds, futuras, parados, pubs: pubs ?? [], processosNovos, excluidos, expirando, docsExcluidos,
    oabs: oabs ?? [], totalProcessos: (processos ?? []).length };
}
const MAX_PUBS_EMAIL = 40;
const DIAS_LIXEIRA = 30;

// Apaga de vez os processos que estão na lixeira há mais de 30 dias (arquivos primeiro, depois os dados).
async function esvaziarLixeira() {
  const limite = new Date(Date.now() - DIAS_LIXEIRA * 864e5).toISOString();
  const { data: velhos, error } = await supabase.from('processos').select('id').not('excluido_em', 'is', null).lt('excluido_em', limite);
  if (error) throw error;
  let arquivos = 0;
  for (const p of velhos ?? []) {
    const { data: docs } = await supabase.from('documentos').select('storage_path').eq('processo_id', p.id);
    if (docs?.length) {
      const { error: e1 } = await supabase.storage.from('documentos').remove(docs.map((d) => d.storage_path));
      if (e1) { console.error('lixeira: arquivos não removidos', p.id, e1.message); continue; }
      arquivos += docs.length;
    }
    await supabase.from('processos').delete().eq('id', p.id);
  }
  // documentos na lixeira há mais de 30 dias
  const { data: docsVelhos, error: e2 } = await supabase.from('documentos').select('id, storage_path').not('excluido_em', 'is', null).lt('excluido_em', limite);
  if (e2) throw e2;
  let documentos = 0;
  for (let i = 0; i < (docsVelhos ?? []).length; i += 100) {
    const lote = docsVelhos!.slice(i, i + 100);
    const { error: e3 } = await supabase.storage.from('documentos').remove(lote.map((d) => d.storage_path));
    if (e3) { console.error('lixeira: documentos não removidos', e3.message); continue; }
    await supabase.from('documentos').delete().in('id', lote.map((d) => d.id));
    documentos += lote.length; arquivos += lote.length;
  }
  return { processos: velhos?.length ?? 0, documentos, arquivos };
}
// o processo ligado vem como objeto (relação muitos-para-um); sem tipos gerados, converte aqui
type ProcResumo = { titulo?: string; created_at?: string } | null;
function procDe(x: { processos: unknown }): ProcResumo { return x.processos as ProcResumo; }

type Dados = Awaited<ReturnType<typeof montar>>;
function html({ prazos, semPrazo, auds, futuras, parados, pubs, processosNovos, excluidos, expirando, docsExcluidos, oabs }: Dados, prefs: Prefs) {
  const link = (id: string, t: string) => `<a href="${SITE}/processos/#/p/${id}" style="color:#e63946;text-decoration:none">${esc(t)}</a>`;
  const cor = (n: number) => (n <= 1 ? '#b91c1c' : n <= 7 ? '#c2410c' : '#6b7280');
  const secAud = auds.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px">📅 Audiências nos próximos ${prefs.dias_aviso_audiencia} dias</h2>
    <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
      ${auds.map((a) => { const n = diasAte(a.data_hora); return `<tr style="border-bottom:1px solid #eee">
        <td style="white-space:nowrap;font-weight:700;color:${cor(n)}">${rotulo(n)}</td>
        <td style="white-space:nowrap">${esc(dataHora(a.data_hora))}</td>
        <td>${esc(a.tipo || 'Audiência')}${a.local ? ` · ${esc(a.local)}` : ''}<br>${link(a.p.id, a.p.titulo || a.p.numero)} <span style="color:#6b7280">${esc(a.p.numero)}</span></td></tr>`; }).join('')}
    </table>` : '';
  const rotPrazo = (n: number) => (n < 0 ? (n === -1 ? 'VENCEU ONTEM' : `VENCEU há ${-n} dias`) : n === 0 ? 'vence HOJE' : n === 1 ? 'vence amanhã' : `vence em ${n} dias`);
  const secPrazo = prazos.length || semPrazo ? `
    <h2 style="font-size:16px;margin:24px 0 8px">⏳ Prazos</h2>
    ${prazos.length ? `<table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
      ${prazos.map((z) => `<tr style="border-bottom:1px solid #eee">
        <td style="white-space:nowrap;font-weight:700;color:${z.dias <= 1 ? '#b91c1c' : z.dias <= 5 ? '#c2410c' : '#6b7280'}">${rotPrazo(z.dias)}</td>
        <td style="white-space:nowrap">${dataBr(z.vencimento)}</td>
        <td><b>${esc(z.descricao)}</b><br>${link(z.processo_id, z.proc?.titulo || z.proc?.numero || '')} <span style="color:#6b7280">${esc(z.proc?.numero)}</span></td></tr>`).join('')}
    </table>` : ''}
    ${semPrazo ? `<p style="margin:8px 0 0">📥 <b>${semPrazo}</b> publicação(ões) do DJEN aguardando definição de prazo — <a href="${SITE}/processos/" style="color:#e63946">conferir na aba Prazos</a>.</p>` : ''}` : '';
  const secFut = futuras.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px">📅 ${auds.length ? 'Outras audiências marcadas' : `Audiências marcadas (nenhuma nos próximos ${prefs.dias_aviso_audiencia} dias)`}</h2>
    <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
      ${futuras.slice(0, 15).map((a) => `<tr style="border-bottom:1px solid #eee">
        <td style="white-space:nowrap;color:#6b7280">em ${diasAte(a.data_hora)} dias</td>
        <td style="white-space:nowrap">${esc(dataHora(a.data_hora))}</td>
        <td>${esc(a.tipo || 'Audiência')}${a.local ? ` · ${esc(a.local)}` : ''}<br>${link(a.p.id, a.p.titulo || a.p.numero)} <span style="color:#6b7280">${esc(a.p.numero)}</span></td></tr>`).join('')}
    </table>
    ${futuras.length > 15 ? `<p style="color:#6b7280">… e mais ${futuras.length - 15}.</p>` : ''}` : '';
  const secPar = parados.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px">⏰ Processos sem andamento há ${prefs.dias_sem_andamento} dias ou mais</h2>
    <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
      ${parados.map((p) => `<tr style="border-bottom:1px solid #eee">
        <td>${link(p.id, p.titulo || p.numero)}<br><span style="color:#6b7280">${esc(p.numero)}${p.tribunal ? ' · ' + esc(p.tribunal) : ''}</span></td>
        <td style="white-space:nowrap">${p.ultimo_andamento_em ? `há ${diasDesde(p.ultimo_andamento_em)} dias` : 'sem andamento'}</td>
        <td style="color:#6b7280">${p.ultima_publicacao ? `últ. publicação ${dataBr(p.ultima_publicacao)}` : ''}${p.documento_atual ? `<br>${esc(p.documento_atual)}` : ''}</td></tr>`).join('')}
    </table>` : '';
  const secPub = pubs.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px">📰 Publicações novas no DJEN (${pubs.length})</h2>
    ${processosNovos ? `<p style="margin:0 0 8px;color:#6b7280">Inclui ${processosNovos} processo(s) novo(s), já cadastrado(s) no painel.</p>` : ''}
    <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
      ${pubs.slice(0, MAX_PUBS_EMAIL).map((x) => { const proc = procDe(x);
        const novo = proc?.created_at && Date.now() - Date.parse(proc.created_at) < 24 * 3600e3;
        return `<tr style="border-bottom:1px solid #eee">
        <td style="white-space:nowrap;vertical-align:top">${dataBr(x.data_disponibilizacao)}</td>
        <td><b>${esc([x.tipo_comunicacao, x.tipo_documento].filter(Boolean).join(' – ') || 'Publicação')}</b>${novo ? ' <span style="background:#fee2e2;color:#b91c1c;border-radius:999px;padding:0 6px;font-size:12px">processo novo</span>' : ''}<br>
          ${x.processo_id ? link(x.processo_id, x.numero_mascara || x.numero_processo) : esc(x.numero_mascara || x.numero_processo)}${proc?.titulo ? ` · ${esc(proc.titulo)}` : ''}<br>
          <span style="color:#6b7280">${esc([x.sigla_tribunal, x.nome_orgao].filter(Boolean).join(' · '))}</span>
          ${x.link ? ` · <a href="${esc(x.link)}" style="color:#e63946">inteiro teor</a>` : ''}</td></tr>`; }).join('')}
    </table>
    ${pubs.length > MAX_PUBS_EMAIL ? `<p style="color:#6b7280">… e mais ${pubs.length - MAX_PUBS_EMAIL}. Veja todas na aba <a href="${SITE}/processos/" style="color:#e63946">Publicações (DJEN)</a>.</p>` : ''}` : '';
  const dataLixo = (iso: string) => new Date(Date.parse(iso) + DIAS_LIXEIRA * 864e5).toLocaleDateString('pt-BR', { timeZone: TZ });
  const secLixo = excluidos.length || expirando.length || docsExcluidos.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px">🗑️ Lixeira</h2>
    ${docsExcluidos.length ? `<p style="margin:0 0 6px">Documento(s) excluído(s) nas últimas 24 h — podem ser restaurados até a data indicada:</p>
      <ul style="margin:0 0 10px;padding-left:18px">${docsExcluidos.map((d) => `<li>${esc(d.nome)} · processo ${link(d.processo_id, d.numero)} <span style="color:#6b7280">(até ${dataLixo(d.excluido_em)})</span></li>`).join('')}</ul>` : ''}
    ${excluidos.length ? `<p style="margin:0 0 6px">Excluído(s) nas últimas 24 h — se não foi você, restaure pela lixeira:</p>
      <ul style="margin:0 0 10px;padding-left:18px">${excluidos.map((p) => `<li>${link(p.id, p.numero)}${p.titulo ? ' · ' + esc(p.titulo) : ''} <span style="color:#6b7280">(apagado de vez em ${dataLixo(p.excluido_em!)})</span></li>`).join('')}</ul>` : ''}
    ${expirando.length ? `<p style="margin:0 0 6px;color:#b91c1c">Serão apagados definitivamente em até 3 dias:</p>
      <ul style="margin:0;padding-left:18px">${expirando.map((p) => `<li>${link(p.id, p.numero)}${p.titulo ? ' · ' + esc(p.titulo) : ''} <span style="color:#6b7280">(${dataLixo(p.excluido_em!)})</span></li>`).join('')}</ul>` : ''}` : '';
  const vazio = !prazos.length && !auds.length && !parados.length && !secLixo
    ? `<p style="margin-top:16px">${futuras.length ? `Nenhuma audiência nos próximos ${prefs.dias_aviso_audiencia} dias` : 'Nenhuma audiência marcada'} e nenhum processo parado${semPrazo ? '' : '; nenhum prazo nos próximos 7 dias'}. Tudo em dia! ✅</p>` : '';
  // sem publicação: diz isso explicitamente, para o e-mail servir de confirmação de que a busca rodou
  const semPub = !pubs.length && oabs.some((o) => o.ativo) ? `
    <h2 style="font-size:16px;margin:24px 0 8px">📰 DJEN</h2>
    <p style="margin:0">Nenhuma publicação nova nas últimas 24 h.</p>` : '';
  const atrasada = (o: { ativo: boolean; ultima_busca: string | null }) => o.ativo && (!o.ultima_busca || Date.now() - Date.parse(o.ultima_busca) > 26 * 3600e3);
  const secOab = oabs.length ? `
    <h2 style="font-size:14px;margin:24px 0 6px;color:#6b7280">🔎 Buscas no DJEN (8h, 13h e 19h)</h2>
    <table cellpadding="4" style="border-collapse:collapse;width:100%;font-size:13px;color:#4b5563">
      ${oabs.map((o) => `<tr style="border-bottom:1px solid #eee">
        <td style="white-space:nowrap">OAB ${esc(o.numero)}/${esc(o.uf)}</td>
        <td>${!o.ativo ? 'pausada' : atrasada(o)
          ? `<b style="color:#b91c1c">⚠️ sem busca há mais de 1 dia${o.ultima_busca ? ` (última: ${esc(dataHora(o.ultima_busca))})` : ''}</b>`
          : `última busca ${esc(dataHora(o.ultima_busca!))} · ${esc(o.ultimo_resultado ?? '')}`}</td></tr>`).join('')}
    </table>` : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;color:#1d2129">
    <p style="font-weight:800;font-size:18px;margin:0">mantini<span style="color:#e63946">.ia</span><span style="color:#6b7280">.br</span> · Processos</p>
    ${secPrazo}${secAud}${secPub}${semPub}${secPar}${secFut}${secLixo}${vazio}${secOab}
    <p style="margin-top:28px"><a href="${SITE}/processos/" style="background:#e63946;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Abrir Processos</a></p>
    <p style="color:#9aa1ad;font-size:12px;margin-top:24px">Aviso diário automático. Para desligar ou mudar os prazos, use o botão ✉️ Avisos no sistema Processos.</p>
  </div>`;
}

function assunto({ prazos, semPrazo, auds, parados, pubs, excluidos, expirando, docsExcluidos, oabs }: Dados) {
  const partes: string[] = [];
  const pzVencidos = prazos.filter((z) => z.dias < 0).length, pzHoje = prazos.filter((z) => z.dias === 0).length;
  const pzAmanha = prazos.filter((z) => z.dias === 1).length, pzOutros = prazos.length - pzVencidos - pzHoje - pzAmanha;
  if (pzVencidos) partes.push(`⚠️ ${pzVencidos} prazo(s) vencido(s)`);
  if (pzHoje) partes.push(`${pzHoje} prazo(s) vencem HOJE`);
  if (pzAmanha) partes.push(`${pzAmanha} prazo(s) amanhã`);
  if (pzOutros) partes.push(`${pzOutros} prazo(s) na semana`);
  if (semPrazo) partes.push(`${semPrazo} publicação(ões) sem prazo definido`);
  const hoje = auds.filter((a) => diasAte(a.data_hora) === 0).length;
  const amanha = auds.filter((a) => diasAte(a.data_hora) === 1).length;
  if (hoje) partes.push(`${hoje} audiência(s) HOJE`);
  if (amanha) partes.push(`${amanha} amanhã`);
  if (auds.length - hoje - amanha > 0) partes.push(`${auds.length - hoje - amanha} audiência(s) próxima(s)`);
  if (pubs.length) partes.push(`${pubs.length} publicação(ões) no DJEN`);
  else if (oabs.some((o) => o.ativo)) partes.push('nenhuma publicação no DJEN');
  if (parados.length) partes.push(`${parados.length} processo(s) sem andamento`);
  if (excluidos.length) partes.push(`${excluidos.length} excluído(s)`);
  if (docsExcluidos.length) partes.push(`${docsExcluidos.length} documento(s) excluído(s)`);
  if (expirando.length) partes.push(`${expirando.length} saindo da lixeira`);
  return 'Processos: ' + (partes.join(' · ') || 'tudo em dia');
}

async function enviar(to: string, subject: string, body: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, erro: 'RESEND_API_KEY não configurada' };
  const from = Deno.env.get('EMAIL_FROM') || 'mantini.ia.br <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html: body }),
  });
  const t = await r.text();
  return r.ok ? { ok: true } : { ok: false, erro: `Resend ${r.status}: ${t.slice(0, 300)}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405);
  const corpo = await req.json().catch(() => ({}));
  const dry = corpo?.dry === true;

  // Quem está chamando?
  let alvos: { id: string; email: string }[] = [];
  let teste = false;
  const token = req.headers.get('x-aviso-token');
  if (token) {
    const { data: ok } = await supabase.rpc('verifica_token_aviso', { token });
    if (!ok) return json({ erro: 'token inválido' }, 401);
    for (let page = 1; ; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return json({ erro: error.message }, 500);
      alvos.push(...data.users.filter((u) => u.email).map((u) => ({ id: u.id, email: u.email! })));
      if (data.users.length < 200) break;
    }
  } else {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user?.email) return json({ erro: 'não autorizado' }, 401);
    alvos = [{ id: data.user.id, email: data.user.email }];
    teste = true;
  }

  // o agendador diário também esvazia a lixeira (processos excluídos há mais de 30 dias)
  if (token && !dry) {
    try { const l = await esvaziarLixeira(); if (l.processos) console.log(JSON.stringify({ evento: 'lixeira', ...l })); }
    catch (e) { console.error('lixeira', (e as Error).message); }
  }

  const { data: prefsRows } = await supabase.from('preferencias').select('*').in('user_id', alvos.map((a) => a.id));
  const prefsDe = (id: string): Prefs => ({ ...PADRAO, ...(prefsRows ?? []).find((p) => p.user_id === id) });

  const resultado = [];
  for (const u of alvos) {
    const prefs = prefsDe(u.id);
    if (!teste && !prefs.email_diario) { resultado.push({ email: u.email, enviado: false, motivo: 'e-mail diário desligado' }); continue; }
    const d = await montar(u.id, prefs);
    const { auds, parados, pubs } = d;
    // e-mail todo dia para quem usa o sistema (tem OAB ou processo), mesmo sem novidade; quem nunca usou não recebe
    if (!teste && !d.oabs.length && !d.totalProcessos && !d.excluidos.length && !d.expirando.length) { resultado.push({ email: u.email, enviado: false, motivo: 'não usa Processos' }); continue; }
    const subject = (teste ? '[Teste] ' : '') + assunto(d);
    const body = html(d, prefs);
    if (dry) { resultado.push({ email: u.email, subject, audiencias: auds.length, parados: parados.length, publicacoes: pubs.length, html: body }); continue; }
    const r = await enviar(u.email, subject, body);
    resultado.push({ email: u.email, subject, enviado: r.ok, erro: r.ok ? undefined : r.erro });
  }
  // registro para conferência (sem endereço de e-mail): aparece em Edge Functions → Logs
  console.log(JSON.stringify({ evento: 'aviso-diario', origem: teste ? 'teste' : 'agendador', dry,
    resultado: resultado.map((r) => ({ enviado: (r as { enviado?: boolean }).enviado ?? false, motivo: (r as { motivo?: string }).motivo, erro: (r as { erro?: string }).erro })) }));
  return json({ dry, teste, resultado });
});
