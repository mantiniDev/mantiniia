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
  let docs = [], andamentos = [], audiencias = [];
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
    const { data, error } = await sb.from('processos').select('*, documentos(count), audiencias(id, data_hora, tipo, local, realizada)').order('updated_at', { ascending: false });
    if (error) return fail(error);
    processos = data;
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
  $('d-del').addEventListener('click', async () => {
    if (!confirm(`Excluir o processo ${atual.numero}, todo o histórico e ${docs.length} documento(s)? Não dá para desfazer.`)) return;
    if (docs.length) {
      const { error } = await sb.storage.from(BUCKET).remove(docs.map((d) => d.storage_path));
      if (error) return fail(error);
    }
    const { error } = await sb.from('processos').delete().eq('id', atual.id);
    if (error) return fail(error);
    toast('Processo excluído.'); location.hash = '#/';
  });
  $('d-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(atual.numero); toast('Número copiado — cole na consulta do jus.br.'); }
    catch { prompt('Copie o número:', atual.numero); }
  });

  // ===================== Detalhe =====================
  async function abrirProcesso(id) {
    const [p, d, a, au] = await Promise.all([
      sb.from('processos').select('*').eq('id', id).single(),
      sb.from('documentos').select('*').eq('processo_id', id).order('created_at', { ascending: false }),
      sb.from('andamentos').select('*').eq('processo_id', id).order('data_publicacao', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('audiencias').select('*').eq('processo_id', id).order('data_hora', { ascending: true }),
    ]);
    if (au.error) return fail(au.error);
    if (p.error) { fail(p.error); location.hash = '#/'; return; }
    if (d.error) return fail(d.error);
    if (a.error) return fail(a.error);
    atual = p.data; docs = d.data; andamentos = a.data; audiencias = au.data;
    renderDetalhe();
  }

  function renderDetalhe() {
    const p = atual;
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
        <span class="when">${brDate(a.data_publicacao)}</span> — ${esc(a.documento)}
        ${a.observacao ? `<div class="small muted">${esc(a.observacao)}</div>` : ''}
        <div class="small muted">registrado em ${brDateTime(a.created_at)}</div>
      </li>`).join('') || '<li class="muted">Nenhum andamento registrado.</li>';
  }
  const semExtensao = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, '');

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

  async function enviar(files) {
    files = [...files]; if (!files.length || !atual) return;
    const grandes = files.filter((f) => f.size > 50 * 1048576);
    if (grandes.length) toast(`Ignorado(s) por passar de 50 MB: ${grandes.map((f) => f.name).join(', ')}`, true);
    files = files.filter((f) => f.size <= 50 * 1048576);
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
      toast(`${enviados.length} documento(s) enviado(s).`);
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
    if (f.size > 50 * 1048576) return toast('Arquivo acima de 50 MB.', true);
    const antigo = docs.find((d) => d.categoria === 'processo_completo');
    if (antigo && !confirm(`Substituir "${antigo.nome}" por "${f.name}"? O arquivo anterior será apagado.`)) return;
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
    toast(antigo ? 'Processo completo substituído.' : 'Processo completo carregado.');
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

  // ===================== Início =====================
  Auth.ready.then(async ({ user: u }) => { user = u; await carregarPrefs(); route(); });
  window.Processos = { parseCNJ };
})();
