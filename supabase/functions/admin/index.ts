// admin — painel mantini.ia.br/admin (usuários e controle de acesso).
//
// Segurança (tudo conferido aqui no servidor; a página não tem dado nenhum):
//   1. login do Supabase válido (getUser confere o token no próprio Supabase);
//   2. usuário na tabela public.admins (vazia = ninguém entra);
//   3. segundo fator: código do aplicativo autenticador (sessão "aal2").
// Tentativas de quem não é admin geram alerta por e-mail aos admins (no máximo 1 por hora).
// Toda ação fica registrada em public.admin_log.
//
// GET  → usuários, acessos, admins, autenticador, uso e últimos registros de auditoria
// POST → { acao, ... }: criar, acessos, admin, bloquear, senha-temporaria, link-senha,
//        encerrar-sessoes, zerar-autenticador, excluir
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://www.mantini.ia.br';
const SISTEMAS = ['in_clock', 'processos', 'clientes'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORIGENS = [SITE, 'https://mantini.ia.br'];
function cors(req: Request) {
  const o = req.headers.get('origin') || '';
  const ok = ORIGENS.includes(o) || /^http:\/\/localhost:\d+$/.test(o);
  return {
    'Access-Control-Allow-Origin': ok ? o : SITE, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}
let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400, codigo?: string) => json({ error: { message, codigo } }, status);

// Nível da sessão (aal1 = só senha; aal2 = senha + autenticador). Lido só depois de getUser validar o token.
function nivel(jwt: string) {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch { return 'aal1'; }
}

function senhaAleatoria() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, (x) => abc[x % abc.length]).join('').replace(/^(.{4})(.{5})(.{5})$/, '$1-$2-$3');
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
async function enviarEmail(to: string[], subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY não configurada');
  const from = Deno.env.get('EMAIL_FROM') || 'mantini.ia.br <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
const moldura = (titulo: string, corpo: string) => `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#1d2129">
  <p style="font-weight:800;font-size:18px;margin:0 0 18px">mantini<span style="color:#e63946">.ia</span><span style="color:#6b7280">.br</span></p>
  <h2 style="font-size:17px">${titulo}</h2>${corpo}
  <p style="color:#9aa1ad;font-size:12px;margin-top:24px">Se você não esperava este e-mail, ignore-o.</p></div>`;

async function registrar(admin: string | null, acao: string, alvo?: string | null, detalhe?: unknown) {
  await sb.from('admin_log').insert({ admin_email: admin, acao, alvo: alvo ?? null, detalhe: detalhe ?? null });
}

async function todosUsuarios() {
  const out = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

// Alerta aos admins quando alguém de fora tenta abrir o admin (no máximo 1 e-mail por hora).
async function alertarNegado(email: string | undefined, id: string) {
  const desde = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await sb.from('admin_log').select('id', { count: 'exact', head: true }).eq('acao', 'alerta enviado').gte('quando', desde);
  await registrar(null, 'acesso negado', email || id);
  if (count) return;
  try {
    const { data } = await sb.from('admins').select('user_id');
    const users = await todosUsuarios();
    const para = users.filter((u) => data?.some((a) => a.user_id === u.id) && u.email).map((u) => u.email!);
    if (!para.length) return;
    await enviarEmail(para, '[mantini.ia.br] Tentativa de acesso ao admin', moldura('Tentativa de acesso ao admin',
      `<p>A conta <b>${esc(email || id)}</b> tentou abrir o painel de administração e foi bloqueada.</p>
       <p>Quando: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
       <p>Se não reconhece, bloqueie a conta no admin. Repetições na próxima hora não geram outro e-mail.</p>`));
    await registrar(null, 'alerta enviado', email || id);
  } catch (e) { console.error('alerta não enviado', e); }
}

async function painel() {
  const [users, adm, aces, procs, docs, log] = await Promise.all([
    todosUsuarios(),
    sb.from('admins').select('user_id'),
    sb.from('acessos').select('user_id, sistema'),
    sb.from('processos').select('user_id'),
    sb.from('documentos').select('user_id, tamanho'),
    sb.from('admin_log').select('quando, admin_email, acao, alvo, detalhe').order('quando', { ascending: false }).limit(100),
  ]);
  for (const r of [adm, aces, procs, docs, log]) if (r.error) throw r.error;
  const admins = new Set(adm.data!.map((a) => a.user_id));
  const conta = (lista: { user_id: string }[], id: string) => lista.filter((x) => x.user_id === id).length;
  const usuarios = users.map((u) => ({
    id: u.id, email: u.email, criado: u.created_at, ultimo_login: u.last_sign_in_at ?? null,
    confirmado: !!u.email_confirmed_at,
    bloqueado: !!(u.banned_until && Date.parse(u.banned_until) > Date.now()),
    admin: admins.has(u.id),
    autenticador: (u.factors || []).some((f) => f.factor_type === 'totp' && f.status === 'verified'),
    trocar_senha: !!u.user_metadata?.trocar_senha,
    sistemas: aces.data!.filter((a) => a.user_id === u.id).map((a) => a.sistema),
    processos: conta(procs.data!, u.id),
    documentos: conta(docs.data!, u.id),
    espaco: docs.data!.filter((d) => d.user_id === u.id).reduce((t, d) => t + (d.tamanho || 0), 0),
  })).sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return { geradoEm: new Date().toISOString(), sistemas: SISTEMAS, usuarios, log: log.data };
}

async function linkSenha(email: string, boasVindas: boolean) {
  const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: SITE + '/login/' } });
  if (error) throw error;
  const link = data.properties.action_link;
  await enviarEmail([email], boasVindas ? 'Seu acesso ao mantini.ia.br' : 'Redefinição de senha — mantini.ia.br', moldura(
    boasVindas ? 'Seu acesso foi criado' : 'Redefinir sua senha',
    `<p>${boasVindas ? 'Uma conta foi criada para você no <b>mantini.ia.br</b>.' : 'Foi solicitada a redefinição da sua senha no <b>mantini.ia.br</b>.'}
     Clique no botão para ${boasVindas ? 'criar' : 'definir'} sua senha:</p>
     <p style="margin:22px 0"><a href="${esc(link)}" style="background:#e63946;color:#fff;padding:11px 18px;border-radius:999px;text-decoration:none">${boasVindas ? 'Criar minha senha' : 'Definir nova senha'}</a></p>
     <p style="color:#6b7280;font-size:13px">O link vale por tempo limitado e funciona uma vez.</p>`));
}

async function encerrarSessoes(id: string) {
  const { data, error } = await sb.rpc('admin_encerrar_sessoes', { p_user: id });
  if (error) throw error;
  return data as number;
}

type Corpo = Record<string, unknown>;
async function acao(body: Corpo, eu: { id: string; email: string }) {
  const id = String(body.user_id || '');
  const proprio = id === eu.id;
  const alvo = async () => {
    const { data, error } = await sb.auth.admin.getUserById(id);
    if (error || !data.user) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
    return data.user;
  };
  const sistemasValidos = (v: unknown) => (Array.isArray(v) ? v.filter((s) => SISTEMAS.includes(String(s))).map(String) : []);

  switch (body.acao) {
    case 'criar': {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return fail('E-mail inválido.');
      const modo = body.modo === 'link' ? 'link' : 'senha';
      const senha = modo === 'senha' ? senhaAleatoria() : senhaAleatoria() + senhaAleatoria(); // no modo link ninguém conhece esta
      const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { trocar_senha: modo === 'senha' } });
      if (error) return fail(/already|exists|registered/i.test(error.message) ? 'Já existe uma conta com esse e-mail.' : error.message, 409);
      const novo = data.user!;
      const sistemas = sistemasValidos(body.sistemas);
      if (sistemas.length) await sb.from('acessos').insert(sistemas.map((s) => ({ user_id: novo.id, sistema: s })));
      if (body.admin === true) await sb.from('admins').insert({ user_id: novo.id });
      let aviso = null;
      if (modo === 'link') { try { await linkSenha(email, true); } catch (e) { aviso = 'Conta criada, mas o e-mail não foi enviado: ' + (e as Error).message; } }
      await registrar(eu.email, 'criou usuário', email, { sistemas, admin: body.admin === true, modo });
      return json({ ok: true, id: novo.id, email, senha: modo === 'senha' ? senha : undefined, aviso });
    }
    case 'acessos': {
      const u = await alvo();
      const sistemas = sistemasValidos(body.sistemas);
      await sb.from('acessos').delete().eq('user_id', id);
      if (sistemas.length) await sb.from('acessos').insert(sistemas.map((s) => ({ user_id: id, sistema: s })));
      await registrar(eu.email, 'alterou acessos', u.email, { sistemas });
      return json({ ok: true });
    }
    case 'admin': {
      if (proprio) return fail('Você não pode tirar o seu próprio acesso de admin.');
      const u = await alvo();
      if (body.ativo === true) await sb.from('admins').upsert({ user_id: id });
      else await sb.from('admins').delete().eq('user_id', id);
      await registrar(eu.email, body.ativo === true ? 'deu admin' : 'tirou admin', u.email);
      return json({ ok: true });
    }
    case 'bloquear': {
      if (proprio) return fail('Você não pode bloquear a própria conta.');
      const u = await alvo();
      const bloquear = body.bloqueado === true;
      const { error } = await sb.auth.admin.updateUserById(id, { ban_duration: bloquear ? '876000h' : 'none' });
      if (error) throw error;
      // tabela bloqueados: corta o acesso aos dados na hora, mesmo com token ainda válido
      if (bloquear) { await sb.from('bloqueados').upsert({ user_id: id }); await encerrarSessoes(id); }
      else await sb.from('bloqueados').delete().eq('user_id', id);
      await registrar(eu.email, bloquear ? 'bloqueou' : 'desbloqueou', u.email);
      return json({ ok: true });
    }
    case 'senha-temporaria': {
      const u = await alvo();
      const senha = senhaAleatoria();
      const { error } = await sb.auth.admin.updateUserById(id, { password: senha, user_metadata: { ...(u.user_metadata || {}), trocar_senha: true } });
      if (error) throw error;
      const sessoes = proprio ? 0 : await encerrarSessoes(id);
      await registrar(eu.email, 'gerou senha temporária', u.email, { sessoes_encerradas: sessoes });
      return json({ ok: true, senha });
    }
    case 'link-senha': {
      const u = await alvo();
      await linkSenha(u.email!, false);
      await registrar(eu.email, 'enviou link de nova senha', u.email);
      return json({ ok: true });
    }
    case 'encerrar-sessoes': {
      if (proprio) return fail('Para sair das suas sessões, use "Sair".');
      const u = await alvo();
      const n = await encerrarSessoes(id);
      await registrar(eu.email, 'encerrou sessões', u.email, { sessoes: n });
      return json({ ok: true, sessoes: n });
    }
    case 'zerar-autenticador': {
      if (proprio) return fail('Você não pode zerar o seu próprio autenticador aqui.');
      const u = await alvo();
      const fatores = (u.factors || []);
      for (const f of fatores) {
        const { error } = await sb.auth.admin.mfa.deleteFactor({ userId: id, id: f.id });
        if (error) throw error;
      }
      await encerrarSessoes(id);
      await registrar(eu.email, 'zerou autenticador', u.email, { fatores: fatores.length });
      return json({ ok: true });
    }
    case 'excluir': {
      if (proprio) return fail('Você não pode excluir a própria conta.');
      const u = await alvo();
      if (String(body.confirmar || '').trim().toLowerCase() !== String(u.email).toLowerCase()) return fail('Digite o e-mail da conta para confirmar.');
      const { data: docs } = await sb.from('documentos').select('storage_path').eq('user_id', id);
      if (docs?.length) {
        for (let i = 0; i < docs.length; i += 100) await sb.storage.from('documentos').remove(docs.slice(i, i + 100).map((d) => d.storage_path));
      }
      // contratos de honorários anexados (sistema Clientes)
      const { data: anexos } = await sb.from('contratos_anexos').select('storage_path').eq('user_id', id);
      if (anexos?.length) {
        for (let i = 0; i < anexos.length; i += 100) await sb.storage.from('contratos').remove(anexos.slice(i, i + 100).map((d) => d.storage_path));
      }
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw error;
      await registrar(eu.email, 'excluiu usuário', u.email, { arquivos_apagados: (docs?.length || 0) + (anexos?.length || 0) });
      return json({ ok: true });
    }
    default:
      return fail('Ação desconhecida.');
  }
}

Deno.serve(async (req) => {
  CORS = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!['GET', 'POST'].includes(req.method)) return fail('Método não permitido', 405);

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: ud, error: ue } = await sb.auth.getUser(jwt);
  const user = ud?.user;
  if (ue || !user) return fail('Entre na sua conta.', 401);

  const { data: adm } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!adm) { await alertarNegado(user.email, user.id); return fail('Esta conta não tem acesso ao admin.', 403); }
  if (nivel(jwt) !== 'aal2') return fail('Confirme com o aplicativo autenticador.', 401, 'segundo-fator');

  try {
    if (req.method === 'GET') return json(await painel());
    const body = (await req.json().catch(() => null)) || {};
    return await acao(body, { id: user.id, email: user.email! });
  } catch (e) {
    const err = e as Error & { status?: number };
    console.error('[admin]', err);
    return fail(err.status ? err.message : 'Não foi possível concluir agora: ' + err.message, err.status || 500);
  }
});
