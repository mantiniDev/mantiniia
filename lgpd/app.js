// Kit LGPD — inventário das operações de tratamento (ROPA, LGPD art. 37) por empresa atendida.
// Dados no Supabase (tabelas organizacoes / tratamentos, protegidas por RLS e pelo acesso ao sistema "lgpd").
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sb = Auth.sb;
  const K = window.Catalogo;

  // ===================== Utilitários =====================
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const brDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
  const digitos = (s) => String(s || '').replace(/\D/g, '');
  const fmtCnpj = (d) => (d && d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d || '');
  function cnpjValido(c) {
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    const dv = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const r = w.reduce((t, p, i) => t + p * +c[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === +c[12] && dv(13) === +c[13];
  }
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block';
    t.style.background = isErr ? 'var(--danger)' : 'var(--text)';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), isErr ? 6000 : 2800);
  }
  const fail = (e) => { console.error(e); toast('Erro: ' + (e.message || e), true); };
  const RISCO = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' };
  const PAPEL = { controlador: 'Controladora', operador: 'Operadora', controlador_conjunto: 'Controladora conjunta' };
  const baseCurta = (k) => (k ? K.nome(K.BASES, k).split(' — ')[0] : '');
  const baseNome = (k) => (k ? K.nome(K.BASES, k) : '');
  const lista = (cat, arr, outros) => [...(arr || []).map((k) => K.nome(cat, k)), ...(outros ? [outros] : [])].join('; ');

  // ===================== Regras: preenchimento, alertas e risco =====================
  function itensPreenchimento(t) {
    return [
      ['Finalidade', !!t.finalidade?.trim()],
      ['Base legal', !!t.base_legal],
      ['Titulares', !!(t.titulares?.length || t.titulares_outros?.trim())],
      ['Dados tratados', !!(t.dados?.length || t.dados_outros?.trim() || t.dados_sensiveis?.length)],
      ['Origem dos dados', !!t.fonte?.trim()],
      ['Compartilhamento (ou "não há")', !!t.compartilhamento?.trim()],
      ['Prazo de retenção', !!t.retencao?.trim()],
      ['Medidas de segurança', !!(t.seguranca?.length || t.seguranca_outros?.trim())],
    ];
  }
  const preenchimento = (t) => { const i = itensPreenchimento(t); return Math.round((i.filter((x) => x[1]).length / i.length) * 100); };
  function alertas(t) {
    const a = [], sens = (t.dados_sensiveis || []).length > 0, b = t.base_legal || '';
    if (sens && b.startsWith('a7_')) a.push(['erro', 'Há dados sensíveis: a hipótese legal precisa ser do art. 11 (o art. 7º não basta).']);
    if (!sens && b.startsWith('a11_')) a.push(['erro', 'Sem dados sensíveis marcados: use uma hipótese do art. 7º (o art. 11 é para dados sensíveis).']);
    if (b === 'a7_ix') a.push(['aviso', 'Legítimo interesse: registre o teste de balanceamento (LIA), garanta transparência e direito de oposição (art. 10). Não serve para dados sensíveis.']);
    if (b === 'a7_i' || b === 'a11_i') a.push(['aviso', 'Consentimento: guarde a prova, informe a finalidade e permita revogar com facilidade (art. 8º).']);
    if (t.criancas) a.push(['aviso', 'Crianças e adolescentes: tratamento no melhor interesse deles; para crianças, consentimento específico de pelo menos um dos pais ou responsável, salvo exceções (art. 14).']);
    if (t.transferencia && !t.transferencia_mecanismo) a.push(['erro', 'Transferência internacional sem mecanismo informado (art. 33).']);
    if (t.papel === 'operador') a.push(['info', 'Como operadora, a empresa trata os dados segundo as instruções do controlador (art. 39). Indique quem é o controlador nas observações.']);
    if (sens && !(t.seguranca || []).includes('acesso')) a.push(['aviso', 'Dados sensíveis sem controle de acesso marcado nas medidas de segurança.']);
    if ((t.dados_sensiveis || []).includes('biometria')) a.push(['info', 'Biometria: avalie se há alternativa menos invasiva (necessidade — art. 6º, III).']);
    if (riscoSugerido(t)[0] === 'alto') a.push(['info', 'Risco alto: considere elaborar o Relatório de Impacto à Proteção de Dados (RIPD — art. 38).']);
    return a;
  }
  function riscoSugerido(t) {
    const m = [], sens = (t.dados_sensiveis || []).length > 0;
    const grande = ['10.000 a 100.000', 'mais de 100.000'].includes(t.volume);
    if (sens) m.push('dados sensíveis');
    if (t.criancas) m.push('crianças/adolescentes');
    if (t.volume === 'mais de 100.000') m.push('grande volume');
    if ((t.dados_sensiveis || []).includes('biometria') || (t.dados_sensiveis || []).includes('genetico')) m.push('biometria/genético');
    if (m.length) return ['alto', m.join(', ')];
    const med = [];
    if (t.transferencia) med.push('transferência internacional');
    if (t.base_legal === 'a7_ix') med.push('legítimo interesse');
    if (grande) med.push('volume relevante');
    if ((t.dados || []).includes('financeiros') || (t.dados || []).includes('credito')) med.push('dados financeiros');
    if ((t.dados || []).includes('localizacao')) med.push('localização');
    if (med.length) return ['medio', med.join(', ')];
    return ['baixo', 'sem fatores de risco elevados marcados'];
  }
  const barra = (p) => `<div class="barra ${p === 100 ? 'ok' : ''}" title="${p}% preenchido"><i style="width:${p}%"></i></div><span class="small muted">${p}%</span>`;

  // ===================== Estado e navegação =====================
  let orgs = [], org = null, ops = [], op = null, usuario = null, temClientes = false, clientesPJ = [];
  async function carregarOrgs() {
    const { data, error } = await sb.from('organizacoes').select('*, tratamentos(*)').order('nome');
    if (error) return fail(error);
    orgs = data;
  }
  function route() {
    const h = location.hash;
    const mOp = h.match(/^#\/o\/([0-9a-f-]{36})\/t\/(novo|[0-9a-f-]{36})(?:\?m=(\w+))?/);
    const mOrg = h.match(/^#\/o\/([0-9a-f-]{36})/);
    $('view-lista').classList.toggle('hidden', !!mOrg);
    $('view-org').classList.toggle('hidden', !mOrg || !!mOp);
    $('view-op').classList.toggle('hidden', !mOp);
    window.scrollTo(0, 0);
    if (mOp) return abrirOp(mOp[1], mOp[2], mOp[3]);
    if (mOrg) return abrirOrg(mOrg[1]);
    document.title = 'Kit LGPD — mantini.ia.br';
    renderOrgs();
  }
  window.addEventListener('hashchange', route);

  // ===================== Lista de empresas =====================
  function renderOrgs() {
    const q = $('q').value.trim().toLowerCase(), qd = digitos(q);
    const l = orgs.filter((o) => !q || [o.nome, o.setor, o.encarregado_nome].some((x) => String(x || '').toLowerCase().includes(q)) || (qd.length >= 3 && digitos(o.cnpj).includes(qd)));
    $('orgs-body').innerHTML = l.map((o) => {
      const t = o.tratamentos || [];
      const media = t.length ? Math.round(t.reduce((s, x) => s + preenchimento(x), 0) / t.length) : 0;
      return `<tr class="click" data-id="${o.id}">
        <td><b>${esc(o.nome)}</b>${o.setor ? `<div class="small muted">${esc(o.setor)}</div>` : ''}</td>
        <td class="small" style="white-space:nowrap">${esc(fmtCnpj(o.cnpj))}</td>
        <td class="small">${esc(o.encarregado_nome || '')}${o.encarregado_nome ? '' : '<span class="muted">não informado</span>'}</td>
        <td class="num">${t.length}</td>
        <td class="num">${t.filter((x) => x.dados_sensiveis.length).length || ''}</td>
        <td class="num" style="color:var(--danger)">${t.filter((x) => x.risco === 'alto').length || ''}</td>
        <td style="min-width:110px">${t.length ? barra(media) : '<span class="small muted">sem operações</span>'}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="vazio">${orgs.length ? 'Nenhuma empresa encontrada.' : 'Nenhuma empresa ainda. Clique em <b>Nova empresa</b> para começar o inventário.'}</td></tr>`;
  }
  $('orgs-body').addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr) location.hash = '#/o/' + tr.dataset.id; });
  $('q').addEventListener('input', renderOrgs);

  // ===================== Empresa =====================
  async function abrirOrg(id) {
    const { data, error } = await sb.from('organizacoes').select('*, tratamentos(*)').eq('id', id).maybeSingle();
    if (error) return fail(error);
    if (!data) { toast('Empresa não encontrada.', true); location.hash = '#/'; return; }
    org = data; ops = data.tratamentos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    document.title = `${org.nome} — Kit LGPD`;
    $('o-nome').textContent = org.nome;
    $('o-sub').textContent = [org.cnpj ? 'CNPJ ' + fmtCnpj(org.cnpj) : '', org.setor].filter(Boolean).join(' · ');
    $('o-ficha').innerHTML = [['Encarregado (DPO)', [org.encarregado_nome, org.encarregado_email, org.encarregado_tel].filter(Boolean).join(' · ') || 'não informado — a indicação do encarregado é exigida (art. 41)'],
      ['Endereço', org.endereco], ['Observações', org.observacoes]].filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('');
    $('o-n').textContent = ops.length;
    $('o-sens').textContent = ops.filter((x) => x.dados_sensiveis.length).length;
    $('o-criancas').textContent = ops.filter((x) => x.criancas).length;
    $('o-transf').textContent = ops.filter((x) => x.transferencia).length;
    $('o-alto').textContent = ops.filter((x) => x.risco === 'alto').length;
    $('o-compl').textContent = ops.length ? Math.round(ops.reduce((s, x) => s + preenchimento(x), 0) / ops.length) + '%' : '—';
    $('ops-body').innerHTML = ops.map((t) => `<tr class="click" data-id="${t.id}">
        <td><b>${esc(t.nome)}</b>${t.dados_sensiveis.length ? ' <span class="pill sens">sensíveis</span>' : ''}${t.criancas ? ' <span class="pill sens">crianças</span>' : ''}${alertas(t).some((a) => a[0] === 'erro') ? ' <span title="Há inconsistências — abra para ver">⚠️</span>' : ''}</td>
        <td class="small">${esc(t.area || '')}</td>
        <td class="small" title="${esc(baseNome(t.base_legal))}">${esc(baseCurta(t.base_legal)) || '<span class="muted">—</span>'}</td>
        <td class="small">${esc(lista(K.TITULARES, t.titulares.slice(0, 3)))}${t.titulares.length > 3 ? '…' : ''}</td>
        <td>${t.risco ? `<span class="pill ${t.risco}">${RISCO[t.risco]}</span>` : ''}</td>
        <td>${t.status === 'revisado' ? `<span class="pill revisado">revisado${t.revisado_em ? ' ' + brDate(t.revisado_em) : ''}</span>` : '<span class="pill">rascunho</span>'}</td>
        <td style="min-width:110px">${barra(preenchimento(t))}</td></tr>`).join('')
      || '<tr><td colspan="7" class="vazio">Nenhuma operação ainda. Use <b>A partir de modelo</b> para ganhar tempo ou <b>Nova operação</b>.</td></tr>';
  }
  $('ops-body').addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr) location.hash = `#/o/${org.id}/t/${tr.dataset.id}`; });
  $('o-nova-op').addEventListener('click', () => { location.hash = `#/o/${org.id}/t/novo`; });
  $('o-modelo').addEventListener('click', () => {
    $('lista-modelos').innerHTML = K.MODELOS.map((m) => `<button type="button" data-m="${m.chave}"><b>${esc(m.titulo)}</b><span>${esc(m.resumo)}</span></button>`).join('');
    $('dlg-modelos').showModal();
  });
  $('lista-modelos').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-m]'); if (!b) return;
    $('dlg-modelos').close(); location.hash = `#/o/${org.id}/t/novo?m=${b.dataset.m}`;
  });
  $('modelos-fechar').addEventListener('click', () => $('dlg-modelos').close());

  // criar / editar empresa
  let editOrg = null;
  function abrirFormOrg(o) {
    editOrg = o;
    $('org-titulo').textContent = o ? 'Editar empresa' : 'Nova empresa';
    $('org-nome').value = o?.nome || ''; $('org-cnpj').value = fmtCnpj(o?.cnpj); $('org-setor').value = o?.setor || '';
    $('org-end').value = o?.endereco || ''; $('org-dpo').value = o?.encarregado_nome || ''; $('org-dpo-email').value = o?.encarregado_email || '';
    $('org-dpo-tel').value = o?.encarregado_tel || ''; $('org-obs').value = o?.observacoes || '';
    $('org-cli-wrap').classList.toggle('hidden', !temClientes || !clientesPJ.length);
    $('org-cliente').value = o?.cliente_id || '';
    dicaCnpj(); $('dlg-org').showModal(); $('org-nome').focus();
  }
  function dicaCnpj() {
    const d = digitos($('org-cnpj').value), h = $('org-cnpj-hint');
    h.textContent = !d ? '' : d.length !== 14 ? 'CNPJ tem 14 dígitos' : cnpjValido(d) ? 'CNPJ válido ✓' : 'CNPJ inválido — confira';
    h.style.color = d && !(d.length === 14 && cnpjValido(d)) ? 'var(--danger)' : '';
  }
  $('org-cnpj').addEventListener('input', dicaCnpj);
  $('org-cnpj').addEventListener('blur', () => { const d = digitos($('org-cnpj').value); if (d.length === 14) $('org-cnpj').value = fmtCnpj(d); });
  $('org-cliente').addEventListener('change', () => {
    const c = clientesPJ.find((x) => x.id === $('org-cliente').value); if (!c) return;
    if (!$('org-nome').value) $('org-nome').value = c.nome;
    if (!$('org-cnpj').value && c.documento?.length === 14) $('org-cnpj').value = fmtCnpj(c.documento);
    if (!$('org-end').value && c.endereco) $('org-end').value = c.endereco;
    dicaCnpj();
  });
  $('btn-nova-org').addEventListener('click', () => abrirFormOrg(null));
  $('o-edit').addEventListener('click', () => abrirFormOrg(org));
  $('form-org').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    ev.preventDefault();
    const row = { nome: $('org-nome').value.trim(), cnpj: digitos($('org-cnpj').value) || null, setor: $('org-setor').value.trim() || null,
      endereco: $('org-end').value.trim() || null, encarregado_nome: $('org-dpo').value.trim() || null, encarregado_email: $('org-dpo-email').value.trim() || null,
      encarregado_tel: $('org-dpo-tel').value.trim() || null, observacoes: $('org-obs').value.trim() || null, cliente_id: $('org-cliente').value || null };
    if (!row.nome) return;
    const { data, error } = editOrg ? await sb.from('organizacoes').update(row).eq('id', editOrg.id).select().single()
      : await sb.from('organizacoes').insert(row).select().single();
    if (error) return fail(error);
    $('dlg-org').close(); await carregarOrgs(); toast('Empresa salva.');
    if (editOrg) abrirOrg(data.id); else location.hash = '#/o/' + data.id;
  });
  $('o-del').addEventListener('click', async () => {
    if (!confirm(`Excluir ${org.nome} e as ${ops.length} operação(ões) do inventário? Isso não pode ser desfeito.`)) return;
    const { error } = await sb.from('organizacoes').delete().eq('id', org.id);
    if (error) return fail(error);
    await carregarOrgs(); toast('Empresa excluída.'); location.hash = '#/';
  });

  // ===================== Editor da operação =====================
  const caixas = (cat, id) => { $(id).innerHTML = cat.map(([k, v]) => `<label><input type="checkbox" value="${k}"> ${esc(v)}</label>`).join(''); };
  caixas(K.TITULARES, 'o-titulares'); caixas(K.DADOS, 'o-dados'); caixas(K.SENSIVEIS, 'o-sensiveis'); caixas(K.SEGURANCA, 'o-seguranca');
  $('f-base').innerHTML = '<option value="">— escolha —</option>'
    + `<optgroup label="Dados pessoais — art. 7º">${K.BASES.filter((b) => b[0].startsWith('a7_')).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</optgroup>`
    + `<optgroup label="Dados sensíveis — art. 11">${K.BASES.filter((b) => b[0].startsWith('a11_')).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</optgroup>`;
  const marcados = (id) => [...$(id).querySelectorAll('input:checked')].map((i) => i.value);
  const marcar = (id, vals) => $(id).querySelectorAll('input').forEach((i) => { i.checked = (vals || []).includes(i.value); });

  const CAMPOS = { nome: 'f-nome', area: 'f-area', responsavel: 'f-resp', papel: 'f-papel', finalidade: 'f-finalidade', base_legal: 'f-base',
    base_legal_justificativa: 'f-base-just', titulares_outros: 'f-titulares-outros', dados_outros: 'f-dados-outros', volume: 'f-volume', fonte: 'f-fonte',
    formato: 'f-formato', sistemas: 'f-sistemas', compartilhamento: 'f-compart', operadores: 'f-operadores', transferencia_paises: 'f-paises',
    transferencia_mecanismo: 'f-mecanismo', retencao: 'f-retencao', descarte: 'f-descarte', seguranca_outros: 'f-seg-outros', risco: 'f-risco',
    status: 'f-status', revisado_em: 'f-revisado', observacoes: 'f-obs' };
  function lerForm() {
    const t = {};
    for (const [k, id] of Object.entries(CAMPOS)) { const v = $(id).value.trim(); t[k] = v || null; }
    t.papel = t.papel || 'controlador'; t.status = t.status || 'rascunho';
    t.titulares = marcados('o-titulares'); t.dados = marcados('o-dados'); t.dados_sensiveis = marcados('o-sensiveis'); t.seguranca = marcados('o-seguranca');
    t.criancas = $('f-criancas').checked; t.transferencia = $('f-transf').checked;
    if (!t.transferencia) { t.transferencia_paises = null; t.transferencia_mecanismo = null; }
    return t;
  }
  function preencherForm(t) {
    for (const [k, id] of Object.entries(CAMPOS)) $(id).value = t[k] ?? '';
    if (!t.papel) $('f-papel').value = 'controlador';
    if (!t.status) $('f-status').value = 'rascunho';
    marcar('o-titulares', t.titulares); marcar('o-dados', t.dados); marcar('o-sensiveis', t.dados_sensiveis); marcar('o-seguranca', t.seguranca);
    $('f-criancas').checked = !!t.criancas; $('f-transf').checked = !!t.transferencia;
  }
  function atualizarPainel() {
    const t = lerForm();
    $('transf-campos').classList.toggle('hidden', !t.transferencia);
    const itens = itensPreenchimento(t), p = preenchimento(t);
    $('compl-barra').style.width = p + '%'; $('compl-barra').parentElement.classList.toggle('ok', p === 100);
    $('compl-txt').textContent = p === 100 ? 'Tudo preenchido ✓' : `${p}% — falta:`;
    $('compl-falta').innerHTML = itens.filter((i) => !i[1]).map((i) => `<li>${esc(i[0])}</li>`).join('');
    const a = alertas(t);
    $('alertas').innerHTML = a.map(([tipo, txt]) => `<div class="alerta ${tipo}">${esc(txt)}</div>`).join('') || '<p class="small muted" style="margin:0">Nenhum ponto de atenção.</p>';
    const [nivel, motivo] = riscoSugerido(t);
    $('risco-sug').innerHTML = `Sugerido: <b>${RISCO[nivel]}</b> (${esc(motivo)})${!t.risco ? ' — <a href="#" id="usar-risco">usar</a>' : ''}`;
  }
  $('form-op').addEventListener('input', atualizarPainel);
  $('form-op').addEventListener('change', atualizarPainel);
  $('risco-sug').addEventListener('click', (ev) => { if (ev.target.id === 'usar-risco') { ev.preventDefault(); $('f-risco').value = riscoSugerido(lerForm())[0]; atualizarPainel(); } });
  $('f-status').addEventListener('change', () => { if ($('f-status').value === 'revisado' && !$('f-revisado').value) $('f-revisado').value = hoje(); });

  async function abrirOp(orgId, opId, modelo) {
    if (!org || org.id !== orgId) { await abrirOrg(orgId); if (!org) return; }
    $('view-org').classList.add('hidden');
    $('op-voltar').href = '#/o/' + orgId;
    $('op-org').textContent = org.nome;
    if (opId === 'novo') {
      op = null;
      const m = K.MODELOS.find((x) => x.chave === modelo);
      preencherForm(m ? { ...m, nome: m.titulo, chave: undefined, titulo: undefined, resumo: undefined } : { titulares: [], dados: [], dados_sensiveis: [], seguranca: [] });
      $('op-titulo').textContent = m ? 'Nova operação (modelo: ' + m.titulo + ')' : 'Nova operação de tratamento';
      if (m) toast('Modelo aplicado — revise e ajuste antes de salvar.');
    } else {
      op = ops.find((x) => x.id === opId);
      if (!op) { const r = await sb.from('tratamentos').select('*').eq('id', opId).maybeSingle(); op = r.data; }
      if (!op) { toast('Operação não encontrada.', true); location.hash = '#/o/' + orgId; return; }
      preencherForm(op);
      $('op-titulo').textContent = op.nome;
    }
    document.title = `${op ? op.nome : 'Nova operação'} — Kit LGPD`;
    $('op-dup').classList.toggle('hidden', !op); $('op-del').classList.toggle('hidden', !op);
    atualizarPainel();
    $('f-nome').focus();
  }
  $('form-op').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = lerForm();
    if (!t.nome) return toast('Dê um nome à operação.', true);
    if (t.status === 'revisado' && alertas(t).some((a) => a[0] === 'erro') && !confirm('Há inconsistências apontadas em "Pontos de atenção". Marcar como revisado mesmo assim?')) return;
    const { data, error } = op ? await sb.from('tratamentos').update(t).eq('id', op.id).select().single()
      : await sb.from('tratamentos').insert({ ...t, organizacao_id: org.id }).select().single();
    if (error) return fail(error);
    toast('Operação salva.');
    await carregarOrgs();
    org = null; location.hash = '#/o/' + data.organizacao_id;
  });
  $('op-dup').addEventListener('click', async () => {
    const t = { ...lerForm(), nome: lerForm().nome + ' (cópia)', status: 'rascunho', revisado_em: null };
    const { data, error } = await sb.from('tratamentos').insert({ ...t, organizacao_id: org.id }).select().single();
    if (error) return fail(error);
    toast('Cópia criada.'); org = null; location.hash = `#/o/${data.organizacao_id}/t/${data.id}`;
  });
  $('op-del').addEventListener('click', async () => {
    if (!confirm(`Excluir a operação "${op.nome}" do inventário?`)) return;
    const { error } = await sb.from('tratamentos').delete().eq('id', op.id);
    if (error) return fail(error);
    await carregarOrgs(); toast('Operação excluída.'); org = null; location.hash = '#/o/' + op.organizacao_id;
  });

  // ===================== Exportação =====================
  const COLUNAS = [
    ['Operação', (t) => t.nome], ['Área', (t) => t.area], ['Responsável', (t) => t.responsavel], ['Papel', (t) => PAPEL[t.papel]],
    ['Finalidade', (t) => t.finalidade], ['Base legal', (t) => baseNome(t.base_legal)], ['Justificativa da base legal', (t) => t.base_legal_justificativa],
    ['Titulares', (t) => lista(K.TITULARES, t.titulares, t.titulares_outros)], ['Crianças/adolescentes', (t) => (t.criancas ? 'Sim' : 'Não')],
    ['Dados pessoais', (t) => lista(K.DADOS, t.dados, t.dados_outros)], ['Dados sensíveis', (t) => lista(K.SENSIVEIS, t.dados_sensiveis) || 'Não'],
    ['Volume de titulares', (t) => t.volume], ['Origem dos dados', (t) => t.fonte], ['Formato', (t) => ({ digital: 'Digital', fisico: 'Físico', ambos: 'Digital e físico' })[t.formato]],
    ['Sistemas / local', (t) => t.sistemas], ['Compartilhamento', (t) => t.compartilhamento], ['Operadores', (t) => t.operadores],
    ['Transferência internacional', (t) => (t.transferencia ? 'Sim' : 'Não')], ['Países', (t) => t.transferencia_paises], ['Mecanismo (art. 33)', (t) => t.transferencia_mecanismo],
    ['Retenção', (t) => t.retencao], ['Descarte', (t) => t.descarte], ['Medidas de segurança', (t) => lista(K.SEGURANCA, t.seguranca, t.seguranca_outros)],
    ['Risco', (t) => RISCO[t.risco]], ['Situação', (t) => (t.status === 'revisado' ? 'Revisado' : 'Rascunho')], ['Revisado em', (t) => (t.revisado_em ? brDate(t.revisado_em) : '')],
    ['Observações', (t) => t.observacoes],
  ];
  const nomeArquivo = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  $('o-xlsx').addEventListener('click', () => {
    if (!ops.length) return toast('Nenhuma operação para exportar.', true);
    const rows = [COLUNAS.map((c) => c[0]), ...ops.map((t) => COLUNAS.map((c) => c[1](t) ?? ''))];
    const capa = [['Registro das Operações de Tratamento de Dados Pessoais (LGPD, art. 37)'], ['Empresa', org.nome], ['CNPJ', fmtCnpj(org.cnpj)],
      ['Encarregado (DPO)', [org.encarregado_nome, org.encarregado_email, org.encarregado_tel].filter(Boolean).join(' · ')], ['Gerado em', brDate(hoje())], ['Operações', ops.length]];
    Export.download(Export.xlsx([{ name: 'Inventário', rows }, { name: 'Empresa', rows: capa }]), `inventario_lgpd_${nomeArquivo(org.nome)}_${hoje()}.xlsx`);
  });

  function carregarPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise((ok, erro) => {
      const s = document.createElement('script'); s.src = '../assets/vendor/pdf-lib-1.17.1.min.js';
      s.onload = () => ok(window.PDFLib); s.onerror = () => erro(new Error('não foi possível carregar o gerador de PDF')); document.head.appendChild(s);
    });
  }
  // a fonte padrão do PDF só tem os caracteres do português "Windows-1252": troca o resto
  const seguro = (s) => String(s ?? '').replace(/[→⇒]/g, '->').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–—‘’“”•…]/g, '');
  $('o-pdf').addEventListener('click', async () => {
    if (!ops.length) return toast('Nenhuma operação para o relatório.', true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await carregarPdfLib();
      const doc = await PDFDocument.create();
      doc.setTitle(seguro(`Inventário LGPD — ${org.nome}`)); doc.setProducer('mantini.ia.br'); doc.setCreator('mantini.ia.br — Kit LGPD');
      const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
      const W = 595.28, H = 841.89, M = 50, L = W - 2 * M;
      const preto = rgb(0.1, 0.11, 0.13), cinza = rgb(0.42, 0.45, 0.5), verm = rgb(0.9, 0.22, 0.27), linha = rgb(0.86, 0.87, 0.89);
      let pg, y;
      const novaPagina = () => { pg = doc.addPage([W, H]); y = H - M; };
      const precisa = (h) => { if (y - h < M + 20) novaPagina(); };
      const quebrar = (t, font, size, larg) => {
        const out = [];
        for (const par of seguro(t).split('\n')) {
          let l = '';
          for (const w of par.split(' ')) { const tt = l ? l + ' ' + w : w; if (font.widthOfTextAtSize(tt, size) > larg && l) { out.push(l); l = w; } else l = tt; }
          out.push(l);
        }
        return out;
      };
      const escrever = (t, o = {}) => {
        const size = o.size || 10, font = o.font || f, lh = o.lh || size * 1.4, x = o.x ?? M, larg = o.larg ?? L;
        for (const l of quebrar(t, font, size, larg)) { precisa(lh); pg.drawText(l, { x, y: y - size, size, font, color: o.color || preto }); y -= lh; }
      };
      // capa
      novaPagina();
      pg.drawRectangle({ x: M, y: y - 4, width: 40, height: 4, color: verm }); y -= 22;
      escrever('Registro das Operações de Tratamento de Dados Pessoais', { font: fb, size: 18, lh: 24 });
      escrever('Lei 13.709/2018 (LGPD), art. 37', { color: cinza, size: 11 }); y -= 14;
      escrever(org.nome, { font: fb, size: 14, lh: 20 });
      if (org.cnpj) escrever('CNPJ ' + fmtCnpj(org.cnpj));
      if (org.endereco) escrever(org.endereco);
      escrever('Encarregado (DPO): ' + ([org.encarregado_nome, org.encarregado_email, org.encarregado_tel].filter(Boolean).join(' · ') || 'não informado'));
      escrever('Data: ' + brDate(hoje())); y -= 12;
      // resumo
      const resumo = [['Operações registradas', ops.length], ['Com dados sensíveis', ops.filter((x) => x.dados_sensiveis.length).length],
        ['Com crianças ou adolescentes', ops.filter((x) => x.criancas).length], ['Com transferência internacional', ops.filter((x) => x.transferencia).length],
        ['Risco alto / médio / baixo', `${ops.filter((x) => x.risco === 'alto').length} / ${ops.filter((x) => x.risco === 'medio').length} / ${ops.filter((x) => x.risco === 'baixo').length}`],
        ['Revisadas', `${ops.filter((x) => x.status === 'revisado').length} de ${ops.length}`]];
      escrever('Resumo', { font: fb, size: 12, lh: 18 });
      for (const [k, v] of resumo) { precisa(15); pg.drawText(seguro(k), { x: M, y: y - 10, size: 10, font: f, color: cinza }); pg.drawText(String(v), { x: M + 220, y: y - 10, size: 10, font: fb }); y -= 15; }
      y -= 10;
      escrever('Operações', { font: fb, size: 12, lh: 18 });
      for (const [i, t] of ops.entries()) { precisa(14); escrever(`${i + 1}. ${t.nome}${t.area ? ' — ' + t.area : ''}`, { size: 10 }); }
      // uma seção por operação
      for (const [i, t] of ops.entries()) {
        novaPagina();
        escrever(`${i + 1}. ${t.nome}`, { font: fb, size: 14, lh: 19 });
        escrever([t.area, PAPEL[t.papel], t.risco ? 'Risco ' + RISCO[t.risco].toLowerCase() : '', t.status === 'revisado' ? 'Revisado em ' + brDate(t.revisado_em) : 'Rascunho'].filter(Boolean).join(' · '), { color: cinza });
        y -= 6; pg.drawLine({ start: { x: M, y }, end: { x: M + L, y }, thickness: 0.6, color: linha }); y -= 10;
        for (const [rot, fn] of COLUNAS.slice(2)) {
          const v = fn(t);
          if (v == null || v === '' || ['Risco', 'Situação', 'Revisado em', 'Papel'].includes(rot)) continue;
          const linhas = quebrar(String(v), f, 9.5, L - 150);
          precisa(Math.max(1, linhas.length) * 13 + 4);
          pg.drawText(seguro(rot), { x: M, y: y - 9.5, size: 9, font: fb, color: cinza });
          for (const l of linhas) { pg.drawText(l, { x: M + 150, y: y - 9.5, size: 9.5, font: f, color: preto }); y -= 13; }
          y -= 4;
        }
        const al = alertas(t);
        if (al.length) {
          y -= 6; escrever('Pontos de atenção', { font: fb, size: 10, lh: 15 });
          for (const [, txt] of al) escrever('• ' + txt, { size: 9, color: cinza, x: M + 8, larg: L - 8 });
        }
      }
      // rodapé com paginação
      const pags = doc.getPages();
      pags.forEach((p, i) => {
        p.drawText(seguro(`${org.nome} — Inventário LGPD (art. 37) — ${brDate(hoje())}`), { x: M, y: 28, size: 8, font: f, color: cinza });
        const n = `${i + 1}/${pags.length}`; p.drawText(n, { x: W - M - f.widthOfTextAtSize(n, 8), y: 28, size: 8, font: f, color: cinza });
      });
      const bytes = await doc.save();
      Export.download(new Blob([bytes], { type: 'application/pdf' }), `inventario_lgpd_${nomeArquivo(org.nome)}_${hoje()}.pdf`);
    } catch (e) { fail(e); }
  });

  // ===================== Início =====================
  Auth.ready.then(async ({ user }) => {
    usuario = user;
    const { data: ac } = await sb.rpc('tem_acesso', { p_sistema: 'clientes' });
    temClientes = !!ac;
    if (temClientes) {
      const { data } = await sb.from('clientes').select('id, nome, documento, endereco, tipo').eq('ativo', true).order('nome');
      clientesPJ = (data || []).filter((c) => c.tipo === 'PJ');
      $('org-cliente').innerHTML = '<option value="">—</option>' + clientesPJ.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    }
    await carregarOrgs();
    route();
  });
  window.KitLGPD = { alertas, riscoSugerido, preenchimento };
})();
