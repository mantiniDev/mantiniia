// aviso-diario — e-mail diário com audiências próximas, publicações novas do DJEN e processos sem andamento.
//
// Chamadas aceitas:
//  • Agendador (pg_cron), todo dia: header "x-aviso-token" = segredo do Vault → envia para todos
//    os usuários com e-mail diário ligado e com algo a avisar.
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
    .eq('user_id', userId).eq('status', 'ativo');
  if (error) throw error;

  const auds = (processos ?? []).flatMap((p) => (p.audiencias ?? [])
    .filter((a) => !a.realizada && diasAte(a.data_hora) >= 0 && diasAte(a.data_hora) <= prefs.dias_aviso_audiencia)
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
  return { auds, parados, pubs: pubs ?? [], processosNovos };
}
const MAX_PUBS_EMAIL = 40;
// o processo ligado vem como objeto (relação muitos-para-um); sem tipos gerados, converte aqui
type ProcResumo = { titulo?: string; created_at?: string } | null;
function procDe(x: { processos: unknown }): ProcResumo { return x.processos as ProcResumo; }

type Dados = Awaited<ReturnType<typeof montar>>;
function html({ auds, parados, pubs, processosNovos }: Dados, prefs: Prefs) {
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
  const vazio = !auds.length && !parados.length && !pubs.length ? '<p>Nenhuma audiência próxima, nenhum processo parado e nenhuma publicação nova. Tudo em dia! ✅</p>' : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;color:#1d2129">
    <p style="font-weight:800;font-size:18px;margin:0">mantini<span style="color:#e63946">.ia</span><span style="color:#6b7280">.br</span> · Processos</p>
    ${secAud}${secPub}${secPar}${vazio}
    <p style="margin-top:28px"><a href="${SITE}/processos/" style="background:#e63946;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Abrir Processos</a></p>
    <p style="color:#9aa1ad;font-size:12px;margin-top:24px">Aviso diário automático. Para desligar ou mudar os prazos, use o botão ✉️ Avisos no sistema Processos.</p>
  </div>`;
}

function assunto({ auds, parados, pubs }: Dados) {
  const partes: string[] = [];
  const hoje = auds.filter((a) => diasAte(a.data_hora) === 0).length;
  const amanha = auds.filter((a) => diasAte(a.data_hora) === 1).length;
  if (hoje) partes.push(`${hoje} audiência(s) HOJE`);
  if (amanha) partes.push(`${amanha} amanhã`);
  if (auds.length - hoje - amanha > 0) partes.push(`${auds.length - hoje - amanha} audiência(s) próxima(s)`);
  if (pubs.length) partes.push(`${pubs.length} publicação(ões) no DJEN`);
  if (parados.length) partes.push(`${parados.length} processo(s) sem andamento`);
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

  const { data: prefsRows } = await supabase.from('preferencias').select('*').in('user_id', alvos.map((a) => a.id));
  const prefsDe = (id: string): Prefs => ({ ...PADRAO, ...(prefsRows ?? []).find((p) => p.user_id === id) });

  const resultado = [];
  for (const u of alvos) {
    const prefs = prefsDe(u.id);
    if (!teste && !prefs.email_diario) { resultado.push({ email: u.email, enviado: false, motivo: 'e-mail diário desligado' }); continue; }
    const d = await montar(u.id, prefs);
    const { auds, parados, pubs } = d;
    if (!teste && !auds.length && !parados.length && !pubs.length) { resultado.push({ email: u.email, enviado: false, motivo: 'nada a avisar' }); continue; }
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
