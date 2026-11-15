// Admin mantini.ia.br — usuários e controle de acesso.
// A página não tem dado nenhum: tudo vem da função "admin" no Supabase, que confere
// login + lista de admins + autenticador (aal2) a cada chamada.
// A sessão do admin fica só nesta aba (sessionStorage): fechar a aba ou 30 min parado = sair.
(function () {
  'use strict';

  // Não pode ser aberto dentro de outro site (proteção contra "clickjacking").
  if (window.top !== window.self) { document.documentElement.textContent = ''; window.top.location = window.self.location.href; return; }

  const cfg = window.MANTINI_CONFIG;
  const API = cfg.supabaseUrl + '/functions/v1/admin';
  const PARADO_MS = 30 * 60 * 1000;
  const NOMES = { in_clock: 'in_clock', processos: 'Processos' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataHora = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const tamanho = (b) => (!b ? '—' : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { storage: window.sessionStorage, storageKey: 'mantini-admin', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  // ---------- etapas ----------
  const ETAPAS = ['carregando', 'login', 'totp', 'cadastrar', 'negado', 'painel'];
  function etapa(nome) {
    ETAPAS.forEach((e) => $('etapa-' + e).classList.toggle('hidden', e !== nome));
    $('conta').classList.toggle('hidden', !['painel', 'totp', 'cadastrar', 'negado'].includes(nome));
    msg('');
  }
  function msg(t, erro) { $('msg').textContent = t || ''; $('msg').className = 'small ' + (erro ? 'error' : 'muted'); }

  async function sair() {
    await sb.auth.signOut().catch(() => {});
    sessionStorage.removeItem('mantini-admin');
    dados = null; etapa('login');
  }
  $('sair').addEventListener('click', sair);

  // 30 minutos parado = sair
  let parado;
  const acordar = () => { clearTimeout(parado); parado = setTimeout(() => { if (dados) { sair(); msg('Sessão encerrada por inatividade.'); } }, PARADO_MS); };
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach((e) => document.addEventListener(e, acordar, { passive: true }));

  // ---------- chamada ao servidor ----------
  async function api(metodo, corpo) {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw Object.assign(new Error('Sessão expirada.'), { status: 401 });
    const r = await fetch(API, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: cfg.supabaseKey, 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Erro ' + r.status), { status: r.status, codigo: j.error?.codigo });
    return j;
  }

  // ---------- login ----------
  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg('Entrando…');
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('senha').value });
    $('senha').value = '';
    if (error) return msg(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message, true);
    await seguir();
  });

  // Decide o próximo passo conforme o servidor: 403 = não é admin; 401 segundo-fator = pedir autenticador.
  async function seguir() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return etapa('login');
    $('conta-email').textContent = s.session.user.email;
    try {
      dados = await api('GET');
      etapa('painel'); render(); acordar();
    } catch (e) {
      if (e.status === 403) { await sb.auth.signOut().catch(() => {}); return etapa('negado'); }
      if (e.codigo === 'segundo-fator') return segundoFator();
      if (e.status === 401) return sair();
      etapa('login'); msg(e.message, true);
    }
  }

  // ---------- segundo fator ----------
  let fatorId = null;
  async function segundoFator() {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) return msg(error.message, true);
    const ativo = data.totp.find((f) => f.status === 'verified');
    if (ativo) { fatorId = ativo.id; etapa('totp'); $('codigo-totp').focus(); return; }
    // primeiro acesso: cadastra o autenticador (remove tentativas não concluídas)
    for (const f of data.all.filter((f) => f.factor_type === 'totp' && f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
    const novo = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'mantini.ia.br admin' });
    if (novo.error) return msg(novo.error.message, true);
    fatorId = novo.data.id;
    $('qr').src = novo.data.totp.qr_code;
    $('segredo').textContent = novo.data.totp.secret;
    etapa('cadastrar'); $('codigo-novo').focus();
  }
  async function confirmarFator(campo) {
    msg('Conferindo…');
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code: $(campo).value.trim() });
    $(campo).value = '';
    if (error) return msg('Código inválido ou expirado. Tente o próximo código do aplicativo.', true);
    await seguir();
  }
  $('form-totp').addEventListener('submit', (ev) => { ev.preventDefault(); confirmarFator('codigo-totp'); });
  $('form-cadastrar').addEventListener('submit', (ev) => { ev.preventDefault(); confirmarFator('codigo-novo'); });

  // ---------- painel ----------
  let dados = null, eu = null;
  async function recarregar(aviso) {
    try { dados = await api('GET'); render(); if (aviso) msg(aviso); }
    catch (e) { if (e.status === 401 || e.status === 403) return seguir(); msg(e.message, true); }
  }

  function render() {
    eu = $('conta-email').textContent;
    const us = dados.usuarios;
    const n = (f) => us.filter(f).length;
    $('resumo').innerHTML = [
      ['Usuários', us.length], ['Admins', n((u) => u.admin)], ['Bloqueados', n((u) => u.bloqueado)],
      ['Ativos 30 dias', n((u) => u.ultimo_login && Date.now() - Date.parse(u.ultimo_login) < 30 * 864e5)],
      ['Sem acesso a sistemas', n((u) => !u.sistemas.length && !u.bloqueado)],
      ['Espaço usado', tamanho(us.reduce((t, u) => t + u.espaco, 0))],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

    $('novo-sistemas').innerHTML = dados.sistemas.map((s) => `<label><input type="checkbox" value="${s}" checked> ${NOMES[s] || s}</label>`).join('');

    const q = $('busca').value.trim().toLowerCase();
    $('usuarios').innerHTML = us.filter((u) => !q || String(u.email).includes(q)).map((u) => {
      const proprio = u.email === eu;
      const tags = [
        proprio ? '<span class="tag ok">você</span>' : '',
        u.admin ? '<span class="tag admin">admin</span>' : '',
        u.bloqueado ? '<span class="tag bloqueado">bloqueado</span>' : '',
        u.autenticador ? '<span class="tag ok">autenticador</span>' : (u.admin ? '<span class="tag alerta">sem autenticador</span>' : ''),
        u.trocar_senha ? '<span class="tag alerta">troca de senha pendente</span>' : '',
        !u.confirmado ? '<span class="tag alerta">e-mail não confirmado</span>' : '',
      ].join('');
      const sis = dados.sistemas.map((s) => `<label><input type="checkbox" data-sis="${s}" ${u.sistemas.includes(s) ? 'checked' : ''}> ${NOMES[s] || s}</label>`).join('');
      const b = (acao, texto, cls = '') => `<button data-acao="${acao}" class="${cls}">${texto}</button>`;
      return `<tr data-id="${u.id}" class="${proprio ? 'eu' : ''}">
        <td><div class="email">${esc(u.email)}</div><div class="tags">${tags}</div><div class="small muted">criado em ${dataHora(u.criado)}</div></td>
        <td class="sis">${sis}</td>
        <td class="small">${dataHora(u.ultimo_login)}</td>
        <td class="num small">${u.processos} proc.<br>${u.documentos} docs<br>${tamanho(u.espaco)}</td>
        <td class="acoes"><div class="botoes">
          ${b('senha-temporaria', 'Senha temporária')}${b('link-senha', 'Link de senha')}
          ${proprio ? '' : b('encerrar-sessoes', 'Encerrar sessões')}
          ${proprio || !u.autenticador ? '' : b('zerar-autenticador', 'Zerar autenticador')}
          ${proprio ? '' : b('admin', u.admin ? 'Tirar admin' : 'Tornar admin')}
          ${proprio ? '' : b('bloquear', u.bloqueado ? 'Desbloquear' : 'Bloquear', u.bloqueado ? '' : 'danger')}
          ${proprio ? '' : b('excluir', 'Excluir', 'danger')}
        </div></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">Nenhum usuário encontrado.</td></tr>';

    $('log').innerHTML = (dados.log || []).map((l) => `<tr>
      <td class="small">${dataHora(l.quando)}</td><td class="small">${esc(l.admin_email || '—')}</td>
      <td>${esc(l.acao)}</td><td class="small">${esc(l.alvo || '')}</td>
      <td class="detalhe">${l.detalhe ? esc(JSON.stringify(l.detalhe)) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nada registrado ainda.</td></tr>';
  }
  $('busca').addEventListener('input', () => dados && render());

  // ---------- ações ----------
  function mostrarSenha(email, senha) {
    $('senha-email').textContent = email; $('senha-valor').textContent = senha;
    $('dlg-senha').showModal();
  }
  $('copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('senha-valor').textContent); $('copiar').textContent = 'Copiado ✓'; }
    catch { $('copiar').textContent = 'Selecione e copie'; }
    setTimeout(() => ($('copiar').textContent = 'Copiar'), 1500);
  });
  $('fechar-senha').addEventListener('click', () => { $('senha-valor').textContent = ''; $('dlg-senha').close(); });

  $('form-novo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const corpo = {
      acao: 'criar', email: $('novo-email').value.trim(), admin: $('novo-admin').checked,
      modo: document.querySelector('input[name=modo]:checked').value,
      sistemas: [...$('novo-sistemas').querySelectorAll('input:checked')].map((i) => i.value),
    };
    if (corpo.admin && !confirm(`Dar acesso de ADMIN a ${corpo.email}?`)) return;
    try {
      msg('Criando…');
      const r = await api('POST', corpo);
      $('form-novo').reset();
      await recarregar(r.aviso || (corpo.modo === 'link' ? `Conta criada. Link para criar a senha enviado para ${r.email}.` : `Conta criada para ${r.email}.`));
      if (r.senha) mostrarSenha(r.email, r.senha);
    } catch (e) { msg(e.message, true); }
  });

  const PERGUNTAS = {
    'senha-temporaria': (u) => `Gerar uma senha temporária para ${u.email}? A senha atual deixa de valer${u.email === eu ? '' : ' e as sessões abertas são encerradas'}.`,
    'link-senha': (u) => `Enviar para ${u.email} um link por e-mail para definir uma nova senha?`,
    'encerrar-sessoes': (u) => `Encerrar todas as sessões de ${u.email}? A pessoa precisará entrar de novo.`,
    'zerar-autenticador': (u) => `Zerar o autenticador de ${u.email}? Use quando a pessoa perdeu o celular; ela cadastra de novo no próximo acesso ao admin.`,
    admin: (u) => (u.admin ? `Tirar o acesso de admin de ${u.email}?` : `Dar acesso de ADMIN a ${u.email}? A pessoa poderá gerenciar todos os usuários.`),
    bloquear: (u) => (u.bloqueado ? `Desbloquear ${u.email}?` : `Bloquear ${u.email}? A pessoa não consegue mais entrar e as sessões abertas são encerradas.`),
  };

  $('usuarios').addEventListener('change', async (ev) => {
    const cb = ev.target.closest('input[data-sis]'); if (!cb) return;
    const tr = cb.closest('tr');
    const sistemas = [...tr.querySelectorAll('input[data-sis]:checked')].map((i) => i.dataset.sis);
    try { await api('POST', { acao: 'acessos', user_id: tr.dataset.id, sistemas }); await recarregar('Acessos atualizados.'); }
    catch (e) { msg(e.message, true); recarregar(); }
  });

  let excluindo = null;
  $('usuarios').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-acao]'); if (!btn) return;
    const u = dados.usuarios.find((x) => x.id === btn.closest('tr').dataset.id);
    const acao = btn.dataset.acao;
    if (acao === 'excluir') { excluindo = u; $('excluir-email').textContent = u.email; $('excluir-confirmar').value = ''; $('dlg-excluir').showModal(); return; }
    if (!confirm(PERGUNTAS[acao](u))) return;
    const corpo = { acao, user_id: u.id };
    if (acao === 'admin') corpo.ativo = !u.admin;
    if (acao === 'bloquear') corpo.bloqueado = !u.bloqueado;
    try {
      btn.disabled = true;
      const r = await api('POST', corpo);
      await recarregar({
        'link-senha': `Link enviado para ${u.email}.`, 'encerrar-sessoes': `${r.sessoes ?? 0} sessão(ões) encerrada(s).`,
        'zerar-autenticador': 'Autenticador zerado.', admin: 'Feito.', bloquear: 'Feito.', 'senha-temporaria': 'Senha temporária gerada.',
      }[acao]);
      if (r.senha) mostrarSenha(u.email, r.senha);
    } catch (e) { msg(e.message, true); btn.disabled = false; }
  });
  $('cancelar-excluir').addEventListener('click', () => $('dlg-excluir').close());
  $('form-excluir').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('POST', { acao: 'excluir', user_id: excluindo.id, confirmar: $('excluir-confirmar').value });
      $('dlg-excluir').close(); await recarregar(`Conta ${excluindo.email} excluída.`);
    } catch (e) { msg(e.message, true); }
  });

  // ---------- início ----------
  seguir();
})();
