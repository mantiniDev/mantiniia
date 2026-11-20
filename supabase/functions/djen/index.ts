// djen — busca publicações no DJEN (Comunicações processuais do CNJ) pelas OABs cadastradas.
//
// A API do CNJ só aceita acesso do Brasil: a função precisa rodar em São Paulo
// (quem chama envia o cabeçalho  x-region: sa-east-1).
//
// Chamadas aceitas:
//  • Agendador (pg_cron), 3x por dia: header "x-aviso-token" = segredo do Vault → todas as OABs ativas.
//  • Usuário logado (botão "Buscar agora"): Authorization: Bearer <token> → só as OABs dele.
//
// Para cada publicação nova (a mesma comunicação nunca é gravada duas vezes por usuário):
//  • processo já cadastrado (mesmo número) → vira andamento dele;
//  • processo novo → é criado no painel ("Parte A x Parte B") com a publicação como último andamento.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const TZ = 'America/Sao_Paulo';
const DIAS_PADRAO = 3;        // janela de cada busca (as repetidas são ignoradas)
const DIAS_PRIMEIRA = 30;     // primeira busca de uma OAB recém-cadastrada
const MAX_PAGINAS = 20;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const digitos = (s: string) => String(s || '').replace(/\D/g, '');

type Item = {
  id: number; hash?: string; data_disponibilizacao: string; siglaTribunal?: string; tipoComunicacao?: string;
  nomeOrgao?: string; texto?: string; numero_processo: string; link?: string; tipoDocumento?: string;
  nomeClasse?: string; numeroprocessocommascara?: string; ativo?: boolean;
  destinatarios?: { nome: string; polo: string }[];
};
type Oab = { id: string; user_id: string; numero: string; uf: string; ultima_busca: string | null };

class LimiteAtingido extends Error {}

// O DJEN às vezes falha por instantes (erro 5xx ou queda de conexão): tenta de novo após 5 s e 20 s.
const ESPERAS_RETENTATIVA = [5000, 20000];
async function buscarComRetentativa(url: string): Promise<Response> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status < 500 || tentativa >= ESPERAS_RETENTATIVA.length) return r;
      await r.body?.cancel();
      console.log(JSON.stringify({ evento: 'djen-retentativa', status: r.status, tentativa: tentativa + 1 }));
    } catch (e) {
      if (tentativa >= ESPERAS_RETENTATIVA.length) throw e;
      console.log(JSON.stringify({ evento: 'djen-retentativa', erro: String((e as Error).message || e).slice(0, 120), tentativa: tentativa + 1 }));
    }
    await dormir(ESPERAS_RETENTATIVA[tentativa]);
  }
}

// Busca todas as páginas de uma OAB num intervalo de datas.
async function buscarOab(oab: Oab): Promise<Item[]> {
  const fim = new Date();
  const inicio = new Date(Date.now() - (oab.ultima_busca ? DIAS_PADRAO : DIAS_PRIMEIRA) * 864e5);
  const itens: Item[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const q = new URLSearchParams({
      numeroOab: oab.numero, ufOab: oab.uf, dataDisponibilizacaoInicio: dia(inicio), dataDisponibilizacaoFim: dia(fim),
      itensPorPagina: '100', pagina: String(pagina),
    });
    const r = await buscarComRetentativa(`${API}?${q}`);
    if (r.status === 429) throw new LimiteAtingido('limite de consultas do DJEN atingido; continua na próxima busca');
    if (!r.ok) throw new Error(`DJEN respondeu ${r.status}`);
    const j = await r.json();
    const lote: Item[] = j.items || [];
    itens.push(...lote);
    const restante = Number(r.headers.get('x-ratelimit-remaining') ?? 10);
    if (lote.length < 100) break;
    await dormir(restante <= 2 ? 15000 : 800); // respeita o controle de taxa do CNJ
  }
  return itens.filter((i) => i.ativo !== false);
}

function titulo(item: Item) {
  const nomes = (polo: string) => (item.destinatarios || []).filter((d) => d.polo === polo).map((d) => d.nome.trim());
  const resumo = (l: string[]) => (l.length > 1 ? `${l[0]} e outros` : l[0] || '');
  const a = resumo(nomes('A')), p = resumo(nomes('P'));
  return a && p ? `${a} x ${p}` : a || p || item.nomeClasse || null;
}

// Divide uma lista em blocos (consultas com muitos ids estouram o tamanho do endereço).
const blocos = <T>(l: T[], n = 200): T[][] => Array.from({ length: Math.ceil(l.length / n) }, (_, k) => l.slice(k * n, k * n + n));

// Grava as publicações novas de um usuário, em lotes, e liga cada uma a um processo (existente ou criado agora).
async function gravar(userId: string, oabTxt: string, itens: Item[]) {
  if (!itens.length) return { novas: 0, processosNovos: 0 };

  // 1. o que já existe (pelo id da comunicação e pelo hash)
  const porId = new Map<number, { id: string; oabs: string[] }>();
  const hashes = new Set<string>();
  for (const b of blocos([...new Set(itens.map((i) => i.id))])) {
    const { data, error } = await sb.from('publicacoes').select('id, comunicacao_id, oabs, hash').eq('user_id', userId).in('comunicacao_id', b);
    if (error) throw error;
    for (const p of data || []) { porId.set(Number(p.comunicacao_id), p); if (p.hash) hashes.add(p.hash); }
  }
  for (const b of blocos([...new Set(itens.map((i) => i.hash).filter(Boolean) as string[])])) {
    const { data, error } = await sb.from('publicacoes').select('hash').eq('user_id', userId).in('hash', b);
    if (error) throw error;
    for (const p of data || []) hashes.add(p.hash);
  }
  // publicação já gravada: só registra que esta OAB também recebeu
  for (const p of porId.values()) {
    if (!p.oabs.includes(oabTxt)) await sb.from('publicacoes').update({ oabs: [...p.oabs, oabTxt] }).eq('id', p.id);
  }

  // 2. só as novas, sem repetição (mesmo id ou mesmo hash), da mais antiga para a mais recente
  const novos: Item[] = [];
  const vistosId = new Set<number>();
  for (const it of [...itens].sort((a, b) => a.data_disponibilizacao.localeCompare(b.data_disponibilizacao))) {
    if (porId.has(it.id) || vistosId.has(it.id) || (it.hash && hashes.has(it.hash))) continue;
    vistosId.add(it.id); if (it.hash) hashes.add(it.hash);
    novos.push(it);
  }
  if (!novos.length) return { novas: 0, processosNovos: 0 };

  // 3. processos: os que faltam são criados de uma vez (dados da publicação mais recente de cada um)
  const { data: procs, error: e2 } = await sb.from('processos').select('id, numero').eq('user_id', userId);
  if (e2) throw e2;
  const porNumero = new Map((procs || []).map((p) => [digitos(p.numero), p.id as string]));
  const faltam = new Map<string, Item>();
  for (const it of novos) { const n = digitos(it.numero_processo); if (!porNumero.has(n)) faltam.set(n, it); }
  for (const b of blocos([...faltam.values()], 100)) {
    const { data, error } = await sb.from('processos').insert(b.map((it) => ({
      user_id: userId, numero: it.numeroprocessocommascara || it.numero_processo, tribunal: it.siglaTribunal || null,
      titulo: titulo(it), status: 'ativo',
      observacoes: `Cadastrado automaticamente a partir do DJEN (OAB ${oabTxt}).${it.nomeClasse ? ' Classe: ' + it.nomeClasse + '.' : ''}`,
    }))).select('id, numero');
    if (error) throw error;
    for (const p of data || []) porNumero.set(digitos(p.numero), p.id);
  }

  // 4. publicações e andamentos, em lotes
  let novas = 0;
  for (const b of blocos(novos, 100)) {
    const { data: pubs, error: e3 } = await sb.from('publicacoes').insert(b.map((it) => ({
      user_id: userId, comunicacao_id: it.id, hash: it.hash || null, processo_id: porNumero.get(digitos(it.numero_processo)),
      numero_processo: digitos(it.numero_processo), numero_mascara: it.numeroprocessocommascara || null, sigla_tribunal: it.siglaTribunal || null,
      tipo_comunicacao: it.tipoComunicacao || null, tipo_documento: it.tipoDocumento || null, nome_orgao: it.nomeOrgao || null,
      nome_classe: it.nomeClasse || null, texto: it.texto || null, link: it.link || null,
      partes: it.destinatarios?.map((d) => ({ nome: d.nome, polo: d.polo })) || null,
      data_disponibilizacao: it.data_disponibilizacao, oabs: [oabTxt],
    }))).select('id, comunicacao_id');
    if (e3) throw e3;
    const pubDe = new Map((pubs || []).map((p) => [Number(p.comunicacao_id), p.id as string]));
    const { error: e4 } = await sb.from('andamentos').insert(b.map((it) => ({
      user_id: userId, processo_id: porNumero.get(digitos(it.numero_processo)), data_publicacao: it.data_disponibilizacao,
      documento: [it.tipoComunicacao, it.tipoDocumento].filter(Boolean).join(' – ') || 'Publicação no DJEN',
      observacao: `DJEN · ${[it.siglaTribunal, it.nomeOrgao].filter(Boolean).join(' · ')}`, origem: 'djen', publicacao_id: pubDe.get(it.id),
    })));
    if (e4) throw e4;
    novas += b.length;
  }
  return { novas, processosNovos: faltam.size };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405);

  // Quem chama: agendador (token do Vault) ou usuário logado (só as OABs dele)
  let filtroUser: string | null = null;
  const token = req.headers.get('x-aviso-token');
  if (token) {
    const { data: ok } = await sb.rpc('verifica_token_aviso', { token });
    if (!ok) return json({ erro: 'token inválido' }, 401);
  } else {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data.user) return json({ erro: 'não autorizado' }, 401);
    const { data: ok } = await sb.from('acessos').select('user_id').eq('user_id', data.user.id).eq('sistema', 'processos').maybeSingle();
    const { data: bloq } = await sb.from('bloqueados').select('user_id').eq('user_id', data.user.id).maybeSingle();
    if (!ok || bloq) return json({ erro: 'sem acesso ao sistema Processos' }, 403);
    filtroUser = data.user.id;
  }

  let q = sb.from('oabs').select('id, user_id, numero, uf, ultima_busca').eq('ativo', true);
  if (filtroUser) q = q.eq('user_id', filtroUser);
  const { data: oabs, error } = await q;
  if (error) return json({ erro: error.message }, 500);

  // contas bloqueadas ou sem acesso ao sistema não são consultadas pelo agendador
  const { data: liberados } = await sb.from('acessos').select('user_id').eq('sistema', 'processos');
  const { data: bloqueados } = await sb.from('bloqueados').select('user_id');
  const pode = (u: string) => liberados?.some((a) => a.user_id === u) && !bloqueados?.some((b) => b.user_id === u);

  const resultado = [];
  let parar = false;
  for (const oab of oabs || []) {
    if (!pode(oab.user_id)) continue;
    const oabTxt = `${oab.numero}/${oab.uf}`;
    if (parar) { resultado.push({ oab: oabTxt, adiado: true }); continue; }
    try {
      const itens = await buscarOab(oab);
      const r = await gravar(oab.user_id, oabTxt, itens);
      const msg = `${itens.length} encontrada(s), ${r.novas} nova(s)` + (r.processosNovos ? `, ${r.processosNovos} processo(s) novo(s)` : '');
      await sb.from('oabs').update({ ultima_busca: new Date().toISOString(), ultimo_resultado: msg }).eq('id', oab.id);
      resultado.push({ oab: oabTxt, encontradas: itens.length, ...r });
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 300);
      if (e instanceof LimiteAtingido) parar = true;
      await sb.from('oabs').update({ ultimo_resultado: 'Erro: ' + msg }).eq('id', oab.id);
      resultado.push({ oab: oabTxt, erro: msg });
    }
    await dormir(800);
  }
  console.log(JSON.stringify({ evento: 'djen', origem: filtroUser ? 'usuario' : 'agendador', regiao: Deno.env.get('SB_REGION'),
    oabs: resultado.length, novas: resultado.reduce((t, r) => t + ((r as { novas?: number }).novas || 0), 0),
    erros: resultado.filter((r) => (r as { erro?: string }).erro).length }));
  return json({ resultado });
});
