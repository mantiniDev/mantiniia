// Processos — controle pessoal de processos judiciais.
// Dados no Supabase (tabelas processos / andamentos / documentos, protegidas por RLS)
// e arquivos no bucket privado "documentos" em <user_id>/<processo_id>/<arquivo>.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sb = Auth.sb;
  const BUCKET = 'documentos';
  let user = null;
  let processos = [];      // lista (com contagem de documentos)
  let atual = null;        // processo aberto no detalhe
  let docs = [], andamentos = [], audiencias = [], pubsProcesso = [];
  let editingAudId = null;
  let editingAndId = null;

  // ===================== Utilitários =====================
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const brDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
  const brDateTime = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const fmtSize = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const diasDesde = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block';
    t.style.background = isErr ? 'var(--danger)' : 'var(--text)';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), isErr ? 6000 : 2500);
  }
  function toastAcao(msg, rotulo, fn) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block'; t.style.background = 'var(--text)';
    const b = document.createElement('button'); b.textContent = rotulo;
    b.onclick = () => { t.style.display = 'none'; fn(); };
    t.appendChild(b);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), 10000);
  }
  const fail = (e) => { console.error(e); toast('Erro: ' + (e.message || e), true); };

  // Preferências de aviso: ficam no servidor (tabela preferencias) para valerem também no e-mail diário.
  let prefs = { email_diario: true, dias_aviso_audiencia: 7, dias_sem_andamento: 7 };
  async function carregarPrefs() {
    const { data, error } = await sb.from('preferencias').select('*').maybeSingle();
    if (error) return fail(error);
    if (data) prefs = data;
    Agenda.setAvisoDias(prefs.dias_aviso_audiencia); // o portal e as notificações usam o mesmo prazo
  }
  const staleDays = () => prefs.dias_sem_andamento;
  // "atualizado há" conta a partir do último andamento registrado (ou do cadastro)
  const idade = (p) => diasDesde(p.ultimo_andamento_em || p.created_at);
  const isStale = (p) => p.status === 'ativo' && (!p.ultimo_andamento_em || idade(p) >= staleDays());
  const idadeTxt = (p) => { const d = idade(p); return d === 0 ? 'hoje' : d === 1 ? '1 dia' : `${d} dias`; };

  const proxAud = (lista) => (lista || []).filter((a) => !a.realizada && Agenda.diasAte(a.data_hora) >= 0)
    .sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora))[0] || null;
  const cdHtml = (a) => `<span class="cd ${Agenda.urgencia(a.data_hora)}">${Agenda.rotulo(a.data_hora)}</span>`;
  const dataCurta = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ---------- Número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO ----------
  const UF = ['', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SE', 'SP', 'TO'];
  function parseCNJ(str) {
    const d = String(str).replace(/\D/g, '');
    if (d.length !== 20) return null;
    const n = { seq: d.slice(0, 7), dv: d.slice(7, 9), ano: d.slice(9, 13), j: d.slice(13, 14), tr: d.slice(14, 16), orig: d.slice(16, 20) };
    n.fmt = `${n.seq}-${n.dv}.${n.ano}.${n.j}.${n.tr}.${n.orig}`;
    const base = BigInt(n.seq + n.ano + n.j + n.tr + n.orig);
    n.valido = 98n - ((base * 100n) % 97n) === BigInt(n.dv);
    const tr = Number(n.tr);
    n.tribunal = ({
      1: 'STF', 2: 'CNJ', 3: 'STJ',
      4: tr ? `TRF${tr}` : 'CJF',
      5: tr ? `TRT${tr}` : 'TST',
      6: tr ? `TRE-${UF[tr] || n.tr}` : 'TSE',
      7: tr ? `CJM${tr}` : 'STM',
      8: tr === 7 ? 'TJDFT' : UF[tr] ? `TJ${UF[tr]}` : '',
      9: UF[tr] ? `TJM${UF[tr]}` : '',
    })[n.j] || '';
    return n;
  }

  // ===================== Navegação =====================
  function route() {
    const m = location.hash.match(/^#\/p\/([0-9a-f-]{36})/);
    $('view-list').classList.toggle('hidden', !!m);
    $('view-detail').classList.toggle('hidden', !m);
    if (m) abrirProcesso(m[1]); else { atual = null; carregarLista(); }
  }
  window.addEventListener('hashchange', route);

  // ===================== Lista =====================
  async function carregarLista() {
    // o Supabase entrega no máximo 1000 linhas por consulta: busca em páginas
    const todos = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from('processos').select('*, documentos(count), audiencias(id, data_hora, tipo, local, realizada)').is('excluido_em', null)
        .order('updated_at', { ascending: false }).order('id').range(de, de + 999);
      if (error) return fail(error);
      todos.push(...data);
      if (data.length < 1000) break;
    }
    processos = todos;
    renderLista();
  }

  function filtrados() {
    const q = $('q').value.trim().toLowerCase();
    const st = $('f-status').value;
    const qd = q.replace(/\D/g, '');
    return processos.filter((p) => (st === 'todos' || p.status === st) && (!q ||
      [p.numero, p.tribunal, p.titulo, p.documento_atual, p.observacoes].some((v) => (v || '').toLowerCase().includes(q)) ||
      (qd.length >= 4 && p.numero.replace(/\D/g, '').includes(qd))));
  }

  function renderLista() {
    const list = filtrados().sort((a, b) => (isStale(b) - isStale(a)) || idade(b) - idade(a));
    $('list-body').innerHTML = list.map((p) => `
      <tr class="click" data-id="${p.id}">
        <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${esc(p.numero)}${p.status !== 'ativo' ? ` <span class="pill ${p.status}">${p.status}</span>` : ''}</td>
        <td>${esc(p.tribunal)}</td><td>${esc(p.titulo)}</td>
        <td>${brDate(p.ultima_publicacao)}</td><td>${esc(p.documento_atual || '—')}</td>
        <td>${(() => { const a = proxAud(p.audiencias); return a ? `${dataCurta(a.data_hora)} ${cdHtml(a)}` : '<span class="muted">—</span>'; })()}</td>
        <td class="num">${p.documentos?.[0]?.count ?? 0}</td>
        <td class="num ${isStale(p) ? 'stale' : 'ok-age'}">${p.ultimo_andamento_em ? idadeTxt(p) : 'sem andamento'}</td>
      </tr>`).join('') ||
      `<tr><td colspan="8" class="muted">${processos.length ? 'Nenhum processo encontrado com esse filtro.' : 'Nenhum processo ainda. Clique em <b>Novo processo</b> para começar.'}</td></tr>`;

    // audiências próximas de todos os processos
    const todas = processos.flatMap((p) => (p.audiencias || []).map((a) => ({ ...a, _p: p })));
    const prox = Agenda.proximas(todas);
    $('alert-aud').classList.toggle('hidden', !prox.length);
    $('alert-aud').innerHTML = prox.length ? `📅 <b>${prox.length}</b> audiência(s) nos próximos ${Agenda.avisoDias()} dias:<ul style="margin:6px 0 0">` +
      prox.map((a) => `<li>${cdHtml(a)} <b>${esc(Agenda.dataHora(a.data_hora))}</b> — ${esc(a.tipo || 'Audiência')} · <a href="#/p/${a._p.id}">${esc(a._p.titulo || a._p.numero)}</a>${a.local ? ' · ' + esc(a.local) : ''}</li>`).join('') + '</ul>' : '';
    Agenda.notificar(todas, (a) => a._p, (a) => '/processos/#/p/' + a._p.id);
    renderBotaoNotif();

    const stale = processos.filter(isStale);
    $('alert-stale').classList.toggle('hidden', !stale.length);
    // separa "nunca teve andamento" de "parado há N dias"
    const nunca = stale.filter((p) => !p.ultimo_andamento_em);
    const parados = stale.filter((p) => p.ultimo_andamento_em);
    const lista = (arr) => arr.map((p) => `<a href="#/p/${p.id}">${esc(p.titulo || p.numero)}</a>`).join(', ');
    $('alert-stale').innerHTML = [
      nunca.length ? `📌 ${nunca.length === 1 ? 'Processo ainda sem andamento registrado' : `<b>${nunca.length}</b> processos ainda sem andamento registrado`}: ${lista(nunca)}. Informe a data da última publicação e o documento atual.` : '',
      parados.length ? `⏰ ${parados.length === 1 ? 'Processo' : `<b>${parados.length}</b> processos`} sem novo andamento há ${staleDays()} dias ou mais: ${lista(parados)}.` : '',
    ].filter(Boolean).join('<br>');
  }

  $('list-body').addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr) location.hash = '#/p/' + tr.dataset.id; });
  $('q').addEventListener('input', renderLista);
  $('f-status').addEventListener('change', renderLista);
  $('btn-avisos').addEventListener('click', () => {
    $('pf-aud').value = prefs.dias_aviso_audiencia; $('pf-stale').value = prefs.dias_sem_andamento;
    $('pf-email').checked = prefs.email_diario; $('dlg-avisos').showModal();
  });
  $('form-avisos').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const row = { user_id: user.id, email_diario: $('pf-email').checked,
      dias_aviso_audiencia: Math.min(90, Math.max(1, Number($('pf-aud').value) || 7)),
      dias_sem_andamento: Math.min(365, Math.max(1, Number($('pf-stale').value) || 7)), updated_at: new Date().toISOString() };
    const { data, error } = await sb.from('preferencias').upsert(row).select().single();
    if (error) return fail(error);
    prefs = data; Agenda.setAvisoDias(prefs.dias_aviso_audiencia);
    $('dlg-avisos').close(); toast('Avisos salvos.'); renderLista();
  });
  $('pf-teste').addEventListener('click', async () => {
    const b = $('pf-teste'); b.disabled = true; b.textContent = 'Enviando…';
    try {
      const { data, error } = await sb.functions.invoke('aviso-diario', { body: {} });
      if (error) throw error;
      const r = data?.resultado?.[0];
      if (r?.enviado) toast(`E-mail de teste enviado para ${r.email}.`);
      else toast('Não foi possível enviar: ' + (r?.erro || r?.motivo || 'erro desconhecido'), true);
    } catch (e) { fail(e); }
    b.disabled = false; b.textContent = 'Enviar e-mail de teste';
  });
  function renderBotaoNotif() {
    const b = $('btn-notif');
    b.classList.toggle('hidden', !Agenda.suportaNotificacao() || Notification.permission === 'granted');
    if (Agenda.suportaNotificacao() && Notification.permission === 'denied') { b.textContent = '🔕 Notificações bloqueadas'; b.title = 'Libere as notificações deste site nas configurações do navegador.'; }
  }
  $('btn-notif').addEventListener('click', async () => {
    const r = await Agenda.pedirPermissao();
    if (r === 'granted') { toast('Notificações ativadas. Você será avisado ao abrir o site.'); renderLista(); }
    else renderBotaoNotif();
  });

  $('btn-export').addEventListener('click', () => {
    const rows = [['Número', 'Tribunal', 'Título / partes', 'Situação', 'Última publicação', 'Documento atual', 'Próxima audiência', 'Dias até a audiência', 'Documentos', 'Último andamento registrado em', 'Observações'],
      ...filtrados().map((p) => [p.numero, p.tribunal || '', p.titulo || '', p.status, brDate(p.ultima_publicacao).replace('—', ''), p.documento_atual || '',
        proxAud(p.audiencias) ? dataCurta(proxAud(p.audiencias).data_hora) : '', proxAud(p.audiencias) ? Agenda.diasAte(proxAud(p.audiencias).data_hora) : '',
        p.documentos?.[0]?.count ?? 0, p.ultimo_andamento_em ? brDateTime(p.ultimo_andamento_em) : '', p.observacoes || ''])];
    Export.download(Export.xlsx([{ name: 'Processos', rows }]), `processos_${hoje()}.xlsx`);
  });

  // ===================== Processo (criar / editar / excluir) =====================
  let editingProc = null;
  function abrirFormProcesso(p) {
    editingProc = p || null;
    $('proc-title').textContent = p ? 'Editar processo' : 'Novo processo';
    $('p-numero').value = p?.numero || ''; $('p-tribunal').value = p?.tribunal || '';
    $('p-titulo').value = p?.titulo || ''; $('p-status').value = p?.status || 'ativo';
    $('p-obs').value = p?.observacoes || ''; $('p-numero-hint').textContent = '';
    $('dlg-proc').showModal(); $('p-numero').focus();
  }
  $('btn-new').addEventListener('click', () => abrirFormProcesso(null));
  $('p-numero').addEventListener('input', () => {
    const n = parseCNJ($('p-numero').value);
    const hint = $('p-numero-hint');
    if (!n) { hint.textContent = ''; return; }
    hint.textContent = n.valido ? `✓ ${n.fmt}${n.tribunal ? ' — ' + n.tribunal : ''}` : '⚠️ dígito verificador não confere — confira o número';
    hint.style.color = n.valido ? 'var(--ok)' : 'var(--warn)';
    if (n.tribunal && !$('p-tribunal').dataset.touched) $('p-tribunal').value = n.tribunal;
  });
  $('p-tribunal').addEventListener('input', () => ($('p-tribunal').dataset.touched = '1'));

  $('form-proc').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const n = parseCNJ($('p-numero').value);
    const row = {
      numero: n ? n.fmt : $('p-numero').value.trim(),
      tribunal: $('p-tribunal').value.trim() || null, titulo: $('p-titulo').value.trim() || null,
      status: $('p-status').value, observacoes: $('p-obs').value.trim() || null,
    };
    if (!editingProc && processos.some((p) => p.numero === row.numero) && !confirm('Já existe um processo com esse número. Cadastrar mesmo assim?')) return;
    const q = editingProc ? sb.from('processos').update(row).eq('id', editingProc.id) : sb.from('processos').insert(row);
    const { data, error } = await q.select().single();
    if (error) return fail(error);
    $('dlg-proc').close(); delete $('p-tribunal').dataset.touched;
    toast('Processo salvo.');
    if (editingProc) abrirProcesso(data.id); else location.hash = '#/p/' + data.id;
  });

  $('d-edit').addEventListener('click', () => abrirFormProcesso(atual));
  // Excluir = mover para a lixeira (30 dias para restaurar). Apagar de vez só pela lixeira.
  $('d-del').addEventListener('click', async () => {
    if (atual.excluido_em) return apagarDeVez(atual);
    if (!confirm(`Mover o processo ${atual.numero} para a lixeira?\n\nEle some das listas, mas fica 30 dias na lixeira (com documentos, andamentos e audiências) e pode ser restaurado.`)) return;
    const id = atual.id, numero = atual.numero;
    const { error } = await sb.from('processos').update({ excluido_em: new Date().toISOString() }).eq('id', id);
    if (error) return fail(error);
    location.hash = '#/';
    toastAcao(`Processo ${numero} movido para a lixeira.`, 'Desfazer', () => restaurar(id));
  });

  async function restaurar(id) {
    const { error } = await sb.from('processos').update({ excluido_em: null }).eq('id', id);
    if (error) return fail(error);
    toast('Processo restaurado.');
    if (atual?.id === id) abrirProcesso(id); else { carregarLista(); if (aba === 'lixeira') carregarLixeira(); }
  }

  async function apagarDeVez(p) {
    const { data: ds, error: e0 } = await sb.from('documentos').select('storage_path').eq('processo_id', p.id);
    if (e0) return fail(e0);
    if (!confirm(`Apagar DEFINITIVAMENTE o processo ${p.numero}, todo o histórico e ${ds.length} documento(s)?\n\nIsso não pode ser desfeito.`)) return;
    if (ds.length) { const { error } = await sb.storage.from(BUCKET).remove(ds.map((d) => d.storage_path)); if (error) return fail(error); }
    const { error } = await sb.from('processos').delete().eq('id', p.id);
    if (error) return fail(error);
    toast('Processo apagado definitivamente.');
    if (atual?.id === p.id) location.hash = '#/'; else carregarLixeira();
  }

  // ---------- lixeira ----------
  const DIAS_LIXEIRA = 30;
  const venceEm = (iso) => new Date(Date.parse(iso) + DIAS_LIXEIRA * 864e5);
  let lixo = [];
  async function carregarLixeira() {
    const { data, error } = await sb.from('processos').select('id, numero, titulo, tribunal, excluido_em, documentos(count)')
      .not('excluido_em', 'is', null).order('excluido_em', { ascending: false });
    if (error) return fail(error);
    lixo = data;
    contarLixeira(lixo.length);
    $('lixeira-body').innerHTML = lixo.map((p) => {
      const resta = Math.max(0, Math.ceil((venceEm(p.excluido_em) - Date.now()) / 864e5));
      return `<tr data-id="${p.id}">
        <td style="white-space:nowrap"><a href="#/p/${p.id}">${esc(p.numero)}</a></td>
        <td>${esc(p.titulo || '')}${p.tribunal ? ` <span class="muted small">· ${esc(p.tribunal)}</span>` : ''}</td>
        <td class="small">${brDateTime(p.excluido_em)}</td>
        <td class="num">${p.documentos?.[0]?.count ?? 0}</td>
        <td class="small ${resta <= 3 ? 'stale' : ''}">${venceEm(p.excluido_em).toLocaleDateString('pt-BR')} (${resta} dia${resta === 1 ? '' : 's'})</td>
        <td class="actions"><button data-lact="restaurar" class="primary">Restaurar</button> <button data-lact="apagar" class="danger">Apagar de vez</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">A lixeira está vazia.</td></tr>';
  }
  function contarLixeira(n) { $('lixeira-qtd').textContent = n || ''; $('lixeira-qtd').classList.toggle('hidden', !n); }
  async function contarLixeiraServidor() {
    const { count } = await sb.from('processos').select('id', { count: 'exact', head: true }).not('excluido_em', 'is', null);
    contarLixeira(count);
  }
  $('lixeira-body').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-lact]'); if (!b) return;
    const p = lixo.find((x) => x.id === b.closest('tr').dataset.id);
    if (b.dataset.lact === 'restaurar') restaurar(p.id); else apagarDeVez(p);
  });
  $('d-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(atual.numero); toast('Número copiado — cole na consulta do jus.br.'); }
    catch { prompt('Copie o número:', atual.numero); }
  });

  // ===================== Detalhe =====================
  async function abrirProcesso(id) {
    const [p, d, a, au, pb] = await Promise.all([
      sb.from('processos').select('*').eq('id', id).single(),
      sb.from('documentos').select('*').eq('processo_id', id).order('created_at', { ascending: false }),
      sb.from('andamentos').select('*').eq('processo_id', id).order('data_publicacao', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('audiencias').select('*').eq('processo_id', id).order('data_hora', { ascending: true }),
      sb.from('publicacoes').select('*').eq('processo_id', id).order('data_disponibilizacao', { ascending: false }).limit(100),
    ]);
    if (pb.error) return fail(pb.error);
    pubsProcesso = pb.data;
    if (au.error) return fail(au.error);
    if (p.error) { fail(p.error); location.hash = '#/'; return; }
    if (d.error) return fail(d.error);
    if (a.error) return fail(a.error);
    atual = p.data; docs = d.data; andamentos = a.data; audiencias = au.data;
    renderDetalhe();
  }

  function renderDetalhe() {
    const p = atual;
    const al2 = $('alert-lixeira');
    al2.classList.toggle('hidden', !p.excluido_em);
    al2.innerHTML = p.excluido_em ? `🗑️ Este processo está na <b>lixeira</b> desde ${brDateTime(p.excluido_em)} e será apagado definitivamente em ${venceEm(p.excluido_em).toLocaleDateString('pt-BR')}. <button data-restaurar>Restaurar</button>` : '';
    $('d-del').textContent = p.excluido_em ? 'Apagar de vez' : 'Excluir';
    document.title = `${p.numero} — Processos`;
    $('d-numero').textContent = p.numero;
    $('d-sub').innerHTML = [p.tribunal, p.titulo].filter(Boolean).map(esc).join(' · ') + ` <span class="pill ${p.status}">${p.status}</span>`;
    $('d-obs').textContent = p.observacoes || '';
    $('d-ultpub').textContent = brDate(p.ultima_publicacao);
    $('d-docatual').textContent = p.documento_atual || '—';
    $('d-idade').textContent = p.ultimo_andamento_em ? idadeTxt(p) : 'sem andamento';
    $('d-idade').className = isStale(p) ? 'stale' : '';
    const pa = proxAud(audiencias);
    const pendente = audiencias.filter((x) => !x.realizada && Agenda.diasAte(x.data_hora) < 0)
      .sort((x, y) => new Date(y.data_hora) - new Date(x.data_hora))[0];
    $('d-proxaud').innerHTML = pa ? `${esc(dataCurta(pa.data_hora))} ${cdHtml(pa)}`
      : pendente ? `<span title="Audiência com data passada e não marcada como realizada — confira a data">⚠️ ${esc(dataCurta(pendente.data_hora))} <span class="cd perto">já passou — conferir</span></span>` : '—';

    // futuras primeiro (mais próxima no topo), depois as passadas/realizadas (mais recente primeiro)
    const fut = audiencias.filter((x) => !x.realizada && Agenda.diasAte(x.data_hora) >= 0);
    const pas = audiencias.filter((x) => !fut.includes(x)).sort((x, y) => new Date(y.data_hora) - new Date(x.data_hora));
    $('aud-list').innerHTML = [...fut, ...pas].map((x) => {
      const realizada = x.realizada;
      const pendente = !realizada && Agenda.diasAte(x.data_hora) < 0;
      return `<li data-id="${x.id}" class="${realizada ? 'done' : ''}">
        <span class="when">${esc(Agenda.dataHora(x.data_hora))}</span>
        ${realizada ? '<span class="cd passou">realizada</span>' : pendente ? '<span class="cd perto">passou — marcar como realizada?</span>' : cdHtml(x)}
        <span class="info">${esc(x.tipo || 'Audiência')}${x.local ? ' · ' + esc(x.local) : ''}${x.observacao ? `<div class="small muted">${esc(x.observacao)}</div>` : ''}</span>
        <span class="acts">
          ${!realizada && !pendente ? `<button data-act="ics" title="Baixar para Outlook / Apple / celular, com lembretes 1 dia e 2 h antes">📅 Agenda</button>
          <a class="btn" target="_blank" rel="noopener" href="${esc(Agenda.googleUrl(x, atual))}">Google Agenda</a>` : ''}
          <button data-act="feita">${realizada ? 'Desfazer' : 'Realizada'}</button>
          <button data-act="edit">Editar</button> <button class="danger" data-act="del">×</button>
        </span></li>`;
    }).join('') || '<li class="muted">Nenhuma audiência cadastrada.</li>';

    const al = $('alert-proc');
    al.classList.toggle('hidden', !isStale(p));
    al.innerHTML = !p.ultimo_andamento_em
      ? '📌 Este processo ainda não tem andamento. <a href="#" data-and>Informe a data da última publicação e o documento atual</a>.'
      : `⏰ Sem andamento registrado há ${idadeTxt(p)}. Verifique o processo no tribunal e <a href="#" data-and>registre o andamento</a>.`;

    const completo = docs.find((d) => d.categoria === 'processo_completo');
    const docsAnd = docs.filter((d) => d.categoria !== 'processo_completo');
    $('completo-info').innerHTML = completo
      ? `Carregado em <b>${brDateTime(completo.created_at)}</b> · <a href="#" data-act="ver" data-id="${completo.id}">${esc(completo.nome)}</a> · ${fmtSize(completo.tamanho)}`
      : 'Nenhum arquivo do processo completo ainda.';
    $('completo-acts').innerHTML = completo
      ? `<button data-act="ver" data-id="${completo.id}">Ver</button><button data-act="baixar" data-id="${completo.id}">Baixar</button><button class="danger" data-act="apagar" data-id="${completo.id}">Apagar</button>`
      : '';
    $('completo-drop-txt').innerHTML = completo
      ? 'Para <b>substituir</b>, arraste aqui o novo PDF do processo completo ou <u>clique para escolher</u>'
      : 'Arraste aqui o PDF do processo completo ou <u>clique para escolher</u>';

    $('docs-body').innerHTML = docsAnd.map((d) => `
      <tr data-id="${d.id}">
        <td><a href="#" data-act="ver">${esc(d.nome)}</a></td>
        <td class="small">${brDateTime(d.created_at)}</td><td class="num small">${fmtSize(d.tamanho)}</td>
        <td class="actions"><button data-act="baixar">Baixar</button> <button class="danger" data-act="apagar">×</button></td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum documento de andamento ainda.</td></tr>';
    $('doc-names').innerHTML = docsAnd.map((d) => `<option value="${esc(semExtensao(d.nome))}">`).join('');

    $('timeline').innerHTML = andamentos.map((a) => `
      <li data-id="${a.id}">
        <span class="acts"><button data-act="edit">Editar</button> <button class="danger" data-act="del">×</button></span>
        <span class="when">${brDate(a.data_publicacao)}</span> — ${esc(a.documento)}${a.origem === 'djen' ? '<span class="tag-djen">DJEN</span>' : ''}
        ${a.observacao ? `<div class="small muted">${esc(a.observacao)}</div>` : ''}
        <div class="small muted">registrado em ${brDateTime(a.created_at)}</div>
      </li>`).join('') || '<li class="muted">Nenhum andamento registrado.</li>';

    $('d-pubs-card').classList.toggle('hidden', !pubsProcesso.length);
    $('d-pubs').innerHTML = pubsProcesso.map((x) => cartaoPub(x, false)).join('');
  }
  const semExtensao = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, '');

  $('alert-lixeira').addEventListener('click', (ev) => { if (ev.target.closest('[data-restaurar]')) restaurar(atual.id); });
  $('alert-proc').addEventListener('click', (ev) => { if (ev.target.closest('[data-and]')) { ev.preventDefault(); abrirAndamento(); } });

  // ===================== Andamentos =====================
  function abrirAndamento(opts = {}) {
    editingAndId = opts.andamento?.id || null;
    $('and-title').textContent = editingAndId ? 'Editar andamento' : 'Registrar andamento';
    $('and-hint').textContent = opts.hint || (editingAndId ? '' : 'Informe a data da última publicação do processo e o documento em que ele está.');
    $('a-data').value = opts.andamento?.data_publicacao || atual.ultima_publicacao || hoje();
    $('a-doc').value = opts.andamento?.documento ?? opts.documento ?? '';
    $('a-obs').value = opts.andamento?.observacao || '';
    $('a-data').max = hoje();
    $('dlg-and').showModal();
    (opts.documento ? $('a-data') : $('a-doc')).focus();
  }
  $('d-andamento').addEventListener('click', () => abrirAndamento());

  $('form-and').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const row = { data_publicacao: $('a-data').value, documento: $('a-doc').value.trim(), observacao: $('a-obs').value.trim() || null };
    if (!row.data_publicacao || !row.documento) return;
    const q = editingAndId ? sb.from('andamentos').update(row).eq('id', editingAndId) : sb.from('andamentos').insert({ ...row, processo_id: atual.id });
    const { error } = await q;
    if (error) return fail(error);
    $('dlg-and').close(); toast('Andamento registrado.');
    abrirProcesso(atual.id);
  });

  $('timeline').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const a = andamentos.find((x) => x.id === b.closest('li').dataset.id);
    if (b.dataset.act === 'edit') return abrirAndamento({ andamento: a });
    if (!confirm(`Apagar o andamento de ${brDate(a.data_publicacao)} (${a.documento})?`)) return;
    const { error } = await sb.from('andamentos').delete().eq('id', a.id);
    if (error) return fail(error);
    abrirProcesso(atual.id);
  });

  // ===================== Audiências =====================
  const toLocalInput = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function abrirAudiencia(a) {
    editingAudId = a?.id || null;
    $('aud-title').textContent = a ? 'Editar audiência' : 'Nova audiência';
    $('au-data').value = a ? toLocalInput(a.data_hora) : '';
    $('au-tipo').value = a?.tipo || ''; $('au-local').value = a?.local || '';
    $('au-obs').value = a?.observacao || ''; $('au-realizada').checked = !!a?.realizada;
    $('dlg-aud').showModal(); $('au-data').focus();
  }
  $('d-nova-aud').addEventListener('click', () => abrirAudiencia(null));
  $('form-aud').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    if (!$('au-data').value) return;
    // data no passado sem marcar "realizada" quase sempre é erro de digitação (ex.: ano 2016 em vez de 2026)
    const dt = new Date($('au-data').value);
    if (!$('au-realizada').checked && Agenda.diasAte(dt.toISOString()) < 0) {
      const quando = dt.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
      if (!confirm(`A data informada já passou: ${quando}.\n\nSe foi erro de digitação (por exemplo, no ano), clique em Cancelar e corrija.\nSe é uma audiência antiga, clique em OK.`)) { $('au-data').focus(); return; }
    }
    const row = { data_hora: new Date($('au-data').value).toISOString(), tipo: $('au-tipo').value.trim() || null,
      local: $('au-local').value.trim() || null, observacao: $('au-obs').value.trim() || null, realizada: $('au-realizada').checked };
    const q = editingAudId ? sb.from('audiencias').update(row).eq('id', editingAudId) : sb.from('audiencias').insert({ ...row, processo_id: atual.id });
    const { error } = await q;
    if (error) return fail(error);
    $('dlg-aud').close();
    toast(row.realizada ? 'Audiência salva.' : `Audiência salva — ${Agenda.rotulo(row.data_hora)}.`);
    abrirProcesso(atual.id);
  });
  $('aud-list').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const a = audiencias.find((x) => x.id === b.closest('li').dataset.id);
    if (b.dataset.act === 'edit') return abrirAudiencia(a);
    if (b.dataset.act === 'ics') return Agenda.baixarIcs(a, atual);
    if (b.dataset.act === 'feita') {
      const { error } = await sb.from('audiencias').update({ realizada: !a.realizada }).eq('id', a.id);
      if (error) return fail(error);
      return abrirProcesso(atual.id);
    }
    if (b.dataset.act === 'del') {
      if (!confirm(`Apagar a audiência de ${Agenda.dataHora(a.data_hora)}?`)) return;
      const { error } = await sb.from('audiencias').delete().eq('id', a.id);
      if (error) return fail(error);
      abrirProcesso(atual.id);
    }
  });

  // ===================== Documentos =====================
  const safeName = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);

  // ---------- limite de 50 MB: PDFs maiores são comprimidos no navegador antes do envio ----------
  const LIMITE = 50 * 1048576;
  const ehPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const mb = (b) => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  let cancelarComp = false;
  async function caber(f) {
    if (f.size <= LIMITE) return f;
    if (!ehPdf(f)) { toast(`"${f.name}" tem ${mb(f.size)} e passa do limite de 50 MB (só PDFs podem ser comprimidos).`, true); return null; }
    if (!confirm(`"${f.name}" tem ${mb(f.size)}, acima do limite de 50 MB.\n\nComprimir agora para caber? As páginas viram imagem em boa resolução para leitura, mas o texto deixa de ser selecionável/pesquisável.`)) return null;
    cancelarComp = false;
    $('comp-nome').textContent = f.name; $('comp-bar').value = 0; $('comp-txt').textContent = 'Carregando…';
    $('dlg-comp').showModal();
    try {
      const r = await PdfCompress.comprimir(f, {
        limite: LIMITE, cancelado: () => cancelarComp,
        progresso: (p) => {
          if (p.fase === 'lendo') $('comp-txt').textContent = 'Lendo o PDF…';
          else if (p.fase === 'salvando') $('comp-txt').textContent = 'Montando o PDF comprimido…';
          else {
            $('comp-bar').value = p.pagina / p.total;
            $('comp-txt').textContent = `Comprimindo página ${p.pagina} de ${p.total}` + (p.nivel > 1 ? ` (tentativa ${p.nivel}, qualidade menor)` : '');
          }
        },
      });
      const novo = new File([r.blob], f.name, { type: 'application/pdf' });
      novo.nota = `comprimido de ${mb(f.size)} para ${mb(novo.size)}`;
      return novo;
    } catch (e) {
      if (!e.cancelado) fail(e); else toast('Compressão cancelada.');
      return null;
    } finally { $('dlg-comp').close(); }
  }
  $('comp-cancelar').addEventListener('click', () => { cancelarComp = true; $('comp-txt').textContent = 'Cancelando…'; });
  $('dlg-comp').addEventListener('cancel', (ev) => { ev.preventDefault(); cancelarComp = true; }); // Esc = cancelar

  async function enviar(files) {
    files = [...files]; if (!files.length || !atual) return;
    const prontos = [];
    for (const f of files) { const ok = await caber(f); if (ok) prontos.push(ok); }
    files = prontos;
    const enviados = [];
    for (const [i, f] of files.entries()) {
      toast(`Enviando ${i + 1}/${files.length}: ${f.name}…`);
      const path = `${user.id}/${atual.id}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (up.error) { fail(up.error); continue; }
      const ins = await sb.from('documentos').insert({ processo_id: atual.id, categoria: 'andamento', nome: f.name, storage_path: path, tipo: f.type || null, tamanho: f.size });
      if (ins.error) { await sb.storage.from(BUCKET).remove([path]); fail(ins.error); continue; }
      enviados.push(f);
    }
    await abrirProcesso(atual.id);
    if (enviados.length) {
      const notas = enviados.filter((f) => f.nota).map((f) => `"${f.name}" ${f.nota}`);
      toast(`${enviados.length} documento(s) enviado(s).` + (notas.length ? ' ' + notas.join('; ') + '.' : ''));
      // Sempre pede o andamento depois de carregar documentos.
      abrirAndamento({
        documento: semExtensao(enviados[enviados.length - 1].name),
        hint: `Você carregou ${enviados.length} documento(s). Qual a data da última publicação e em qual documento o processo está agora?`,
      });
    }
  }
  /** Processo completo: só 1 por processo. O novo substitui o anterior, que é apagado do armazenamento. */
  async function enviarCompleto(files) {
    const f = [...files][0]; if (!f || !atual) return;
    if ([...files].length > 1) toast('Só um arquivo de processo completo é guardado; usando o primeiro.', true);
    const antigo = docs.find((d) => d.categoria === 'processo_completo');
    if (antigo && !confirm(`Substituir "${antigo.nome}" por "${f.name}"? O arquivo anterior será apagado.`)) return;
    const pronto = await caber(f); if (!pronto) return;
    return enviarCompletoArquivo(pronto, antigo);
  }
  async function enviarCompletoArquivo(f, antigo) {
    toast(`Enviando ${f.name}…`);
    const path = `${user.id}/${atual.id}/${crypto.randomUUID()}-${safeName(f.name)}`;
    const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (up.error) return fail(up.error);
    const dados = { nome: f.name, storage_path: path, tipo: f.type || null, tamanho: f.size, created_at: new Date().toISOString() };
    // primeiro grava o novo; só depois apaga o antigo (se algo falhar, o anterior continua lá)
    const q = antigo
      ? sb.from('documentos').update(dados).eq('id', antigo.id)
      : sb.from('documentos').insert({ ...dados, processo_id: atual.id, categoria: 'processo_completo' });
    const r = await q;
    if (r.error) { await sb.storage.from(BUCKET).remove([path]); return fail(r.error); }
    if (antigo) {
      const rm = await sb.storage.from(BUCKET).remove([antigo.storage_path]);
      if (rm.error) console.warn('arquivo antigo não removido', rm.error);
    }
    await abrirProcesso(atual.id);
    // O processo completo não é um andamento: só guarda a data em que foi carregado.
    toast((antigo ? 'Processo completo substituído' : 'Processo completo carregado') + (f.nota ? ` (${f.nota}).` : '.'));
  }

  function ligarDrop(el, input, fn) {
    input.addEventListener('change', (ev) => { fn(ev.target.files); ev.target.value = ''; });
    ['dragenter', 'dragover'].forEach((e) => el.addEventListener(e, (ev) => { ev.preventDefault(); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((e) => el.addEventListener(e, (ev) => { ev.preventDefault(); el.classList.remove('over'); }));
    el.addEventListener('drop', (ev) => fn(ev.dataTransfer.files));
  }
  ligarDrop($('drop'), $('files'), enviar);
  ligarDrop($('drop-completo'), $('file-completo'), enviarCompleto);

  async function urlAssinada(d, download) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.storage_path, 600, download ? { download: d.nome } : undefined);
    if (error) throw error;
    return data.signedUrl;
  }

  async function acaoDocumento(ev) {
    const el = ev.target.closest('[data-act]'); if (!el) return;
    ev.preventDefault();
    const d = docs.find((x) => x.id === (el.dataset.id || el.closest('tr')?.dataset.id));
    if (!d) return;
    try {
      if (el.dataset.act === 'ver') return await ver(d);
      if (el.dataset.act === 'baixar') { location.href = await urlAssinada(d, true); return; }
      if (el.dataset.act === 'apagar') {
        if (!confirm(`Apagar o documento "${d.nome}"?`)) return;
        const rm = await sb.storage.from(BUCKET).remove([d.storage_path]); if (rm.error) throw rm.error;
        const del = await sb.from('documentos').delete().eq('id', d.id); if (del.error) throw del.error;
        toast('Documento apagado.'); abrirProcesso(atual.id);
      }
    } catch (e) { fail(e); }
  }
  $('docs-body').addEventListener('click', acaoDocumento);
  $('completo-info').addEventListener('click', acaoDocumento);
  $('completo-acts').addEventListener('click', acaoDocumento);

  async function ver(d) {
    const url = await urlAssinada(d, false);
    const tipo = d.tipo || '';
    $('v-name').textContent = d.nome;
    $('v-open').href = url;
    $('v-download').href = await urlAssinada(d, true);
    const frame = $('v-frame');
    if (tipo === 'application/pdf' || /\.pdf$/i.test(d.nome)) frame.innerHTML = `<iframe src="${esc(url)}" title="${esc(d.nome)}"></iframe>`;
    else if (tipo.startsWith('image/')) frame.innerHTML = `<img src="${esc(url)}" alt="${esc(d.nome)}">`;
    else if (tipo.startsWith('text/')) frame.innerHTML = `<iframe src="${esc(url)}" title="${esc(d.nome)}"></iframe>`;
    else frame.innerHTML = '<p class="muted">Este tipo de arquivo não tem pré-visualização. Use <b>Baixar</b> ou <b>Abrir em nova aba</b>.</p>';
    $('dlg-view').showModal();
  }
  $('v-close').addEventListener('click', () => $('dlg-view').close());
  $('dlg-view').addEventListener('close', () => ($('v-frame').innerHTML = ''));

  // ===================== DJEN: OABs e publicações =====================
  const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'];
  $('oab-uf').innerHTML = UFS.map((u) => `<option ${u === 'RJ' ? 'selected' : ''}>${u}</option>`).join('');
  let oabs = [];

  // alguns tribunais mandam o texto com marcações HTML (<br>, <a>): mostra só o texto
  const textoLimpo = (t) => String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();

  function cartaoPub(x, comProcesso) {
    const proc = x.processos;
    return `<div class="pub ${x.lida ? '' : 'nova'}" data-pub="${x.id}">
      <div class="topo">
        <b>${brDate(x.data_disponibilizacao)}</b>
        <span class="tipo">${esc([x.tipo_comunicacao, x.tipo_documento].filter(Boolean).join(' – ') || 'Publicação')}</span>
        <span class="meta">${esc([x.sigla_tribunal, x.nome_orgao].filter(Boolean).join(' · '))}</span>
        ${x.lida ? '' : '<span class="badge">nova</span>'}
      </div>
      ${comProcesso ? `<div class="meta">Processo <a href="#/p/${x.processo_id}">${esc(x.numero_mascara || x.numero_processo)}</a>${proc?.titulo ? ' · ' + esc(proc.titulo) : ''}${x.nome_classe ? ' · ' + esc(x.nome_classe) : ''}</div>` : ''}
      <div class="meta">OAB ${esc((x.oabs || []).join(', '))}</div>
      ${x.texto ? `<p class="texto">${esc(textoLimpo(x.texto))}</p>` : ''}
      <div class="acoes">
        ${x.texto && x.texto.length > 220 ? '<button data-pact="abrir">Ler tudo</button>' : ''}
        ${x.link ? `<a class="btn" href="${esc(x.link)}" target="_blank" rel="noopener">Inteiro teor ↗</a>` : ''}
        <button data-pact="lida">${x.lida ? 'Marcar como não lida' : 'Marcar como lida'}</button>
      </div>
    </div>`;
  }

  async function acaoPub(ev) {
    const b = ev.target.closest('button[data-pact]'); if (!b) return;
    const card = b.closest('.pub'); const id = card.dataset.pub;
    if (b.dataset.pact === 'abrir') { card.classList.toggle('aberta'); b.textContent = card.classList.contains('aberta') ? 'Recolher' : 'Ler tudo'; return; }
    const lida = !card.classList.contains('nova') ? false : true;
    const { error } = await sb.from('publicacoes').update({ lida }).eq('id', id);
    if (error) return fail(error);
    card.classList.toggle('nova', !lida);
    card.querySelector('.badge')?.remove();
    if (!lida) card.querySelector('.topo').insertAdjacentHTML('beforeend', '<span class="badge">nova</span>');
    b.textContent = lida ? 'Marcar como não lida' : 'Marcar como lida';
    contarNaoLidas();
  }
  $('pub-lista').addEventListener('click', acaoPub);
  $('d-pubs').addEventListener('click', acaoPub);

  async function contarNaoLidas() {
    const { count } = await sb.from('publicacoes').select('id', { count: 'exact', head: true }).eq('lida', false);
    const el = $('pub-nao-lidas');
    el.textContent = count || ''; el.classList.toggle('hidden', !count);
  }

  // abas Processos / Publicações
  let aba = 'processos';
  $('abas').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-aba]'); if (!b) return;
    aba = b.dataset.aba;
    document.querySelectorAll('#abas button').forEach((x) => x.classList.toggle('active', x === b));
    ['processos', 'publicacoes', 'lixeira'].forEach((x) => $('aba-' + x).classList.toggle('hidden', aba !== x));
    if (aba === 'publicacoes') carregarPubs(true);
    if (aba === 'lixeira') carregarLixeira();
  });

  const POR_PAGINA = 50;
  let pubPagina = 0, pubTimer;
  async function carregarPubs(reset) {
    if (reset) { pubPagina = 0; $('pub-lista').innerHTML = '<p class="muted">Carregando…</p>'; }
    let q = sb.from('publicacoes').select('*, processos(titulo)', { count: 'exact' })
      .order('data_disponibilizacao', { ascending: false }).order('created_at', { ascending: false })
      .range(pubPagina * POR_PAGINA, pubPagina * POR_PAGINA + POR_PAGINA - 1);
    if ($('pub-filtro').value === 'nao-lidas') q = q.eq('lida', false);
    const termo = $('pub-q').value.trim().replace(/[%,()]/g, ' ');
    if (termo) {
      const dig = termo.replace(/\D/g, '');
      const t = termo.replace(/\s+/g, '*');
      q = q.or([`texto.ilike.*${t}*`, `nome_orgao.ilike.*${t}*`, `sigla_tribunal.ilike.*${t}*`, `tipo_documento.ilike.*${t}*`,
        `tipo_comunicacao.ilike.*${t}*`, `nome_classe.ilike.*${t}*`, dig.length >= 4 ? `numero_processo.ilike.*${dig}*` : null].filter(Boolean).join(','));
    }
    const { data, count, error } = await q;
    if (error) return fail(error);
    const html = data.map((x) => cartaoPub(x, true)).join('');
    if (reset) $('pub-lista').innerHTML = html || `<p class="muted">${oabs.length || termo ? 'Nenhuma publicação encontrada.' : 'Nenhuma OAB cadastrada ainda. Clique em <b>⚖️ OABs</b> para começar.'}</p>`;
    else $('pub-lista').insertAdjacentHTML('beforeend', html);
    pubPagina++;
    $('pub-mais').classList.toggle('hidden', pubPagina * POR_PAGINA >= (count || 0));
    $('pub-info').textContent = count ? `${count} publicação(ões)${$('pub-filtro').value === 'nao-lidas' ? ' não lida(s)' : ''}.` : '';
    contarNaoLidas();
  }
  $('pub-mais').addEventListener('click', () => carregarPubs(false));
  $('pub-filtro').addEventListener('change', () => carregarPubs(true));
  $('pub-q').addEventListener('input', () => { clearTimeout(pubTimer); pubTimer = setTimeout(() => carregarPubs(true), 350); });
  $('pub-marcar-todas').addEventListener('click', async () => {
    if (!confirm('Marcar todas as publicações como lidas?')) return;
    const { error } = await sb.from('publicacoes').update({ lida: true }).eq('lida', false);
    if (error) return fail(error);
    carregarPubs(true);
  });

  // OABs
  async function carregarOabs() {
    const { data, error } = await sb.from('oabs').select('*').order('created_at');
    if (error) return fail(error);
    oabs = data;
    $('oabs-body').innerHTML = oabs.map((o) => `<tr data-oab="${o.id}">
      <td><b>${esc(o.numero)}/${esc(o.uf)}</b>${o.ativo ? '' : ' <span class="pill">pausada</span>'}</td>
      <td>${esc(o.nome || '')}</td>
      <td class="small">${o.ultima_busca ? brDateTime(o.ultima_busca) : '<span class="muted">ainda não buscou</span>'}</td>
      <td class="small ${String(o.ultimo_resultado || '').startsWith('Erro') ? 'error' : 'muted'}">${esc(o.ultimo_resultado || '')}</td>
      <td class="actions"><button data-oact="ativo">${o.ativo ? 'Pausar' : 'Retomar'}</button> <button class="danger" data-oact="del">×</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma OAB cadastrada.</td></tr>';
  }
  async function abrirOabs() { await carregarOabs(); $('dlg-oabs').showModal(); }
  $('btn-oabs').addEventListener('click', abrirOabs);
  $('btn-oabs2').addEventListener('click', abrirOabs);
  $('oab-fechar').addEventListener('click', () => $('dlg-oabs').close());
  $('form-oab').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const numero = $('oab-num').value.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    const { error } = await sb.from('oabs').insert({ numero, uf: $('oab-uf').value, nome: $('oab-nome').value.trim() || null });
    if (error) return fail(/duplicate/i.test(error.message) ? new Error('Essa OAB já está cadastrada.') : error);
    $('oab-num').value = ''; $('oab-nome').value = '';
    await carregarOabs();
    buscarAgora();
  });
  $('oabs-body').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-oact]'); if (!b) return;
    const o = oabs.find((x) => x.id === b.closest('tr').dataset.oab);
    if (b.dataset.oact === 'del') {
      if (!confirm(`Parar de monitorar a OAB ${o.numero}/${o.uf}? As publicações e processos já trazidos continuam.`)) return;
      const { error } = await sb.from('oabs').delete().eq('id', o.id); if (error) return fail(error);
    } else {
      const { error } = await sb.from('oabs').update({ ativo: !o.ativo }).eq('id', o.id); if (error) return fail(error);
    }
    carregarOabs();
  });

  // A API do CNJ só aceita acesso do Brasil: a função roda em São Paulo (x-region).
  async function buscarAgora() {
    const b = $('oab-buscar'); b.disabled = true; b.textContent = 'Buscando no DJEN…';
    toast('Buscando publicações no DJEN… isso pode levar até 1–2 minutos.');
    try {
      const { data, error } = await sb.functions.invoke('djen', { body: {}, headers: { 'x-region': 'sa-east-1' } });
      if (error) throw error;
      const r = data.resultado || [];
      const novas = r.reduce((t, x) => t + (x.novas || 0), 0), procs = r.reduce((t, x) => t + (x.processosNovos || 0), 0);
      const erros = r.filter((x) => x.erro);
      toast(erros.length ? `Busca com erro: ${erros[0].erro}` : `Busca concluída: ${novas} publicação(ões) nova(s)${procs ? `, ${procs} processo(s) novo(s)` : ''}.`, !!erros.length);
    } catch (e) { fail(e); }
    b.disabled = false; b.textContent = '🔄 Buscar agora';
    await carregarOabs();
    if (aba === 'publicacoes') carregarPubs(true); else carregarLista();
  }
  $('oab-buscar').addEventListener('click', buscarAgora);

  // ===================== Início =====================
  Auth.ready.then(async ({ user: u }) => { user = u; await carregarPrefs(); route(); carregarOabsSilencioso(); contarNaoLidas(); contarLixeiraServidor(); });
  async function carregarOabsSilencioso() { const { data } = await sb.from('oabs').select('*'); oabs = data || []; }
  window.Processos = { parseCNJ };
})();
