// in_clock — versão web do controle de horário e tarefas.
// Dados ficam no localStorage deste navegador (chave STORE_KEY).
(function () {
  'use strict';

  const STORE_KEY = 'mantini.in_clock.v1';
  const $ = (id) => document.getElementById(id);

  // ===================== Estado =====================
  const defaults = () => ({
    v: 1,
    settings: { dailyTarget: 8, weeklyTarget: 40 },
    nextId: 1,
    // {id, name, category, quantity, date, start, end, acc, resumedAt, pausedByPonto}
    // acc = segundos acumulados; resumedAt = ms enquanto corre; end = null => em andamento
    entries: [],
    // 'YYYY-MM-DD' -> {in, out, breaks:[{start, end}]}  (timestamps em ms)
    days: {},
    meeting: null, // {start, name}
  });

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY) ?? localStorage.getItem('mantini.clock.v1');
      if (!raw) return defaults();
      const s = Object.assign(defaults(), JSON.parse(raw));
      s.settings = Object.assign(defaults().settings, s.settings);
      return s;
    } catch (e) {
      console.error(e);
      return defaults();
    }
  }
  let S = load();
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  // sincroniza entre abas abertas
  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { S = load(); renderAll(); } });

  // ===================== Utilitários =====================
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const hm = (ms) => { if (ms == null) return ''; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const brDate = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtDur(sec, withSec = true) {
    const neg = sec < 0; sec = Math.abs(Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (neg ? '−' : '') + (withSec ? `${h}:${pad(m)}:${pad(s)}` : `${h}:${pad(m)}`);
  }
  const hours = (sec) => Math.round((sec / 3600) * 100) / 100;

  /** "1h30m", "90m", "45" (min), "1:30", "1:30:00", "2h" -> segundos; null se inválido; 0 se vazio */
  function parseDur(str) {
    str = String(str || '').trim().toLowerCase().replace(',', '.');
    if (!str) return 0;
    let m;
    if ((m = str.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/))) return +m[1] * 3600 + +m[2] * 60 + (+m[3] || 0);
    if ((m = str.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/)) && (m[1] || m[2] || m[3]))
      return Math.round((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
    if (/^\d+(\.\d+)?$/.test(str)) return Math.round(parseFloat(str) * 60);
    return null;
  }

  /** Intervalo [from, to] (YYYY-MM-DD inclusive) de um período nomeado. */
  function range(period, from, to) {
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    switch (period) {
      case 'today': return [ymd(d0), ymd(d0)];
      case 'week': { const m = monday(d0); return [ymd(m), ymd(add(m, 6))]; }
      case 'lastweek': { const m = add(monday(d0), -7); return [ymd(m), ymd(add(m, 6))]; }
      case 'month': return [ymd(new Date(d0.getFullYear(), d0.getMonth(), 1)), ymd(new Date(d0.getFullYear(), d0.getMonth() + 1, 0))];
      case 'lastmonth': return [ymd(new Date(d0.getFullYear(), d0.getMonth() - 1, 1)), ymd(new Date(d0.getFullYear(), d0.getMonth(), 0))];
      case 'd30': return [ymd(add(d0, -29)), ymd(d0)];
      case 'custom': return [from || '0000-01-01', to || '9999-12-31'];
      default: return ['0000-01-01', '9999-12-31'];
    }
  }
  const inRange = (date, [a, b]) => date >= a && date <= b;

  // ===================== Tarefas =====================
  const running = () => S.entries.find((e) => e.end == null);
  const entryDur = (e, now = Date.now()) => e.acc + (e.resumedAt ? (now - e.resumedAt) / 1000 : 0);

  function pauseEntry(e, byPonto) {
    if (!e || !e.resumedAt) return;
    e.acc = entryDur(e); e.resumedAt = null; e.pausedByPonto = !!byPonto;
  }
  function resumeEntry(e) {
    if (!e || e.resumedAt) return;
    e.resumedAt = Date.now(); e.pausedByPonto = false;
  }
  function stopTask() {
    const e = running(); if (!e) return;
    pauseEntry(e); e.end = Date.now(); e.pausedByPonto = false;
  }
  function startTask(name, category, quantity) {
    stopTask();
    const now = Date.now();
    const onBreak = pontoStatus() === 'pause';
    S.entries.push({
      id: S.nextId++, name, category, quantity, date: today(), start: now, end: null,
      acc: 0, resumedAt: onBreak ? null : now, pausedByPonto: onBreak,
    });
  }
  function addManual(name, category, quantity, date, durSec) {
    const start = parseYmd(date).getTime() + 9 * 3600 * 1000;
    S.entries.push({ id: S.nextId++, name, category, quantity, date, start, end: start + durSec * 1000, acc: durSec, resumedAt: null, manual: true });
  }
  const categories = () => [...new Set(S.entries.map((e) => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // ===================== Ponto =====================
  function dayOf(date, create) {
    if (!S.days[date] && create) S.days[date] = { in: null, out: null, breaks: [] };
    return S.days[date];
  }
  function pontoStatus() {
    const d = S.days[today()];
    if (!d || !d.in || d.out) return 'off';
    return d.breaks.some((b) => b.end == null) ? 'pause' : 'on';
  }
  function dayWorked(date, now = Date.now()) {
    const d = S.days[date];
    if (!d || !d.in) return 0;
    const end = d.out ?? (date === today() ? now : d.in);
    let total = Math.max(0, end - d.in);
    for (const b of d.breaks) {
      const bs = Math.max(b.start, d.in), be = Math.min(b.end ?? end, end);
      if (be > bs) total -= be - bs;
    }
    return Math.max(0, total / 1000);
  }
  function dayBreaks(date, now = Date.now()) {
    const d = S.days[date]; if (!d) return 0;
    const end = d.out ?? now;
    return d.breaks.reduce((s, b) => s + Math.max(0, (b.end ?? end) - b.start), 0) / 1000;
  }
  const dayBalance = (date) => (S.days[date]?.in ? dayWorked(date) - S.settings.dailyTarget * 3600 : 0);

  function punchIn() {
    const d = dayOf(today(), true), now = Date.now();
    if (!d.in) d.in = now;
    else if (d.out) { d.breaks.push({ start: d.out, end: now }); d.out = null; } // voltou depois de sair
    const e = running(); if (e && e.pausedByPonto) resumeEntry(e);
  }
  function punchBreak() {
    if (pontoStatus() !== 'on') return;
    S.days[today()].breaks.push({ start: Date.now(), end: null });
    pauseEntry(running(), true);
  }
  function punchResume() {
    if (pontoStatus() !== 'pause') return;
    S.days[today()].breaks.find((b) => b.end == null).end = Date.now();
    const e = running(); if (e && e.pausedByPonto) resumeEntry(e);
  }
  function punchOut() {
    const d = S.days[today()]; if (!d || !d.in || d.out) return;
    const now = Date.now();
    d.breaks.forEach((b) => { if (b.end == null) b.end = now; });
    d.out = now;
    stopTask();
  }

  // ===================== Relatórios / exportação =====================
  function reportData(rg) {
    const entries = S.entries.filter((e) => inRange(e.date, rg)).sort((a, b) => a.start - b.start);
    const cats = {};
    for (const e of entries) {
      const k = e.category || '(sem categoria)';
      cats[k] = cats[k] || { n: 0, qty: 0, sec: 0 };
      cats[k].n++; cats[k].qty += Number(e.quantity) || 0; cats[k].sec += entryDur(e);
    }
    const dates = new Set([...entries.map((e) => e.date), ...Object.keys(S.days).filter((d) => inRange(d, rg) && S.days[d].in)]);
    const byDay = [...dates].sort().map((d) => ({
      date: d,
      tasks: entries.filter((e) => e.date === d).reduce((s, e) => s + entryDur(e), 0),
      ponto: dayWorked(d),
    }));
    const pontoDays = Object.keys(S.days).filter((d) => inRange(d, rg) && S.days[d].in).sort();
    return { entries, cats, byDay, pontoDays };
  }

  function sheetsFor(rg) {
    const r = reportData(rg);
    const target = S.settings.dailyTarget;
    return [
      { name: 'Lançamentos', rows: [['Data', 'Início', 'Fim', 'Nome', 'Categoria', 'Quantidade', 'Horas', 'Duração'],
        ...r.entries.map((e) => [brDate(e.date), e.manual ? '' : hm(e.start), e.end && !e.manual ? hm(e.end) : (e.end ? '' : 'em andamento'),
          e.name, e.category || '', e.quantity === '' || e.quantity == null ? '' : Number(e.quantity), hours(entryDur(e)), fmtDur(entryDur(e))])] },
      { name: 'Resumo por dia', rows: [['Data', 'Tarefas (h)', 'Ponto (h)'],
        ...r.byDay.map((d) => [brDate(d.date), hours(d.tasks), hours(d.ponto)])] },
      { name: 'Por categoria', rows: [['Categoria', 'Lançamentos', 'Quantidade', 'Horas'],
        ...Object.entries(r.cats).sort((a, b) => b[1].sec - a[1].sec).map(([k, v]) => [k, v.n, v.qty, hours(v.sec)])] },
      { name: 'Ponto', rows: [['Data', 'Dia', 'Entrada', 'Saída', 'Pausas (h)', 'Trabalhado (h)', 'Meta (h)', 'Saldo (h)'],
        ...r.pontoDays.map((d) => [brDate(d), WEEKDAYS[parseYmd(d).getDay()], hm(S.days[d].in), hm(S.days[d].out),
          hours(dayBreaks(d)), hours(dayWorked(d)), target, hours(dayBalance(d))])] },
    ];
  }
  const reportRange = () => range($('r-period').value, $('r-from').value, $('r-to').value);
  const rangeLabel = (rg) => (rg[0] === rg[1] ? rg[0] : `${rg[0].replace('0000-01-01', 'inicio')}_a_${rg[1].replace('9999-12-31', 'hoje')}`);

  // ===================== Renderização =====================
  let tab = 'tarefas';
  function renderAll() { renderLive(); renderTasks(); renderPonto(); renderReports(); renderSettings(); }

  function renderLive() {
    const now = Date.now(), e = running();
    $('run-name').textContent = e ? e.name + (e.resumedAt ? '' : ' (pausada)') : '—';
    $('run-time').textContent = fmtDur(e ? entryDur(e, now) : 0);
    $('today-total').textContent = fmtDur(S.entries.filter((x) => x.date === today()).reduce((s, x) => s + entryDur(x, now), 0));
    $('btn-stop').disabled = !e;
    document.querySelectorAll('[data-live-entry]').forEach((td) => {
      const x = S.entries.find((y) => y.id === +td.dataset.liveEntry); if (x) td.textContent = fmtDur(entryDur(x, now));
    });

    $('meet-time').textContent = S.meeting ? fmtDur((now - S.meeting.start) / 1000) : '—';
    $('btn-meet').textContent = S.meeting ? 'Encerrar reunião' : 'Iniciar reunião';
    $('btn-meet').className = S.meeting ? 'danger' : '';

    const st = pontoStatus();
    const badge = $('ponto-badge');
    badge.textContent = { off: 'fora do ponto', on: 'ponto aberto', pause: 'em pausa' }[st];
    badge.className = 'badge ' + ({ on: 'on', pause: 'pause' }[st] || '');
    $('btn-in').disabled = st !== 'off';
    $('btn-break').disabled = st !== 'on';
    $('btn-resume').disabled = st !== 'pause';
    $('btn-out').disabled = st === 'off';
    setFavicon(st);

    const t = today(), wk = range('week');
    const wWorked = Object.keys(S.days).filter((d) => inRange(d, wk)).reduce((s, d) => s + dayWorked(d, now), 0);
    $('p-today').textContent = fmtDur(dayWorked(t, now), false);
    setBal($('p-today-bal'), S.days[t]?.in ? dayBalance(t) : null);
    $('p-week').textContent = fmtDur(wWorked, false);
    setBal($('p-week-bal'), wWorked - S.settings.weeklyTarget * 3600);

    document.title = (e && e.resumedAt ? `▶ ${fmtDur(entryDur(e, now))} · ` : '') + 'in_clock — mantini.ia.br';
  }
  function setBal(el, sec) {
    if (sec == null) { el.textContent = '—'; el.className = ''; return; }
    el.textContent = (sec >= 0 ? '+' : '') + fmtDur(sec, false);
    el.className = sec >= 0 ? 'pos' : 'neg';
  }

  let lastFav = null;
  function setFavicon(st) {
    if (st === lastFav) return; lastFav = st;
    const color = { on: '#16a34a', pause: '#d97706' }[st] || '#2563eb';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="${color}"/><circle cx="32" cy="32" r="22" fill="#fff"/><path d="M32 16v16l10 6" stroke="${color}" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`;
    $('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function renderTasks() {
    $('cat-list').innerHTML = categories().map((c) => `<option value="${esc(c)}">`).join('');
    const rg = range($('t-filter').value);
    const list = S.entries.filter((e) => inRange(e.date, rg)).sort((a, b) => b.start - a.start);
    $('t-body').innerHTML = list.map((e) => {
      const live = e.end == null;
      return `<tr data-id="${e.id}" class="${live ? 'running' : ''}">
        <td>${live ? '▶ ' : ''}${brDate(e.date)}</td><td>${e.manual ? '<span class="muted">manual</span>' : hm(e.start)}</td>
        <td>${esc(e.name)}</td><td>${esc(e.category)}</td><td class="num">${esc(e.quantity ?? '')}</td>
        <td class="num" ${live ? `data-live-entry="${e.id}"` : ''}>${fmtDur(entryDur(e))}</td>
        <td class="actions"><button data-act="again" title="Iniciar de novo">▶</button> <button data-act="edit">Editar</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">Nenhum lançamento no período.</td></tr>';
    const tot = list.reduce((s, e) => s + entryDur(e), 0);
    $('t-foot').innerHTML = list.length ? `<tr><th colspan="5">Total (${list.length})</th><th class="num">${fmtDur(tot)}</th><th></th></tr>` : '';
  }

  function renderPonto() {
    const rg = range($('p-filter').value);
    const dates = Object.keys(S.days).filter((d) => inRange(d, rg)).sort();
    let bank = 0;
    const rows = dates.map((d) => {
      const day = S.days[d], bal = dayBalance(d);
      bank += bal;
      const live = d === today() && day.in && !day.out;
      return `<tr data-date="${d}">
        <td>${brDate(d)} <span class="muted small">${WEEKDAYS[parseYmd(d).getDay()]}</span></td>
        <td>${hm(day.in)}</td><td>${day.out ? hm(day.out) : (live ? '<span class="muted">aberto</span>' : '')}</td>
        <td class="num">${fmtDur(dayBreaks(d), false)}</td><td class="num">${fmtDur(dayWorked(d), false)}</td>
        <td class="num ${bal >= 0 ? 'pos' : 'neg'}">${day.in ? (bal >= 0 ? '+' : '') + fmtDur(bal, false) : ''}</td>
        <td class="num ${bank >= 0 ? 'pos' : 'neg'}">${(bank >= 0 ? '+' : '') + fmtDur(bank, false)}</td>
        <td class="actions"><button data-act="edit">Editar</button></td></tr>`;
    });
    $('p-body').innerHTML = rows.reverse().join('') || '<tr><td colspan="8" class="muted">Nenhum registro no período.</td></tr>';
  }

  function renderReports() {
    const isCustom = $('r-period').value === 'custom';
    document.querySelectorAll('.r-custom').forEach((el) => el.classList.toggle('hidden', !isCustom));
    const r = reportData(reportRange());
    $('r-cat').innerHTML = Object.entries(r.cats).sort((a, b) => b[1].sec - a[1].sec)
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${v.qty || ''}</td><td class="num">${fmtDur(v.sec, false)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">Sem dados.</td></tr>';
    $('r-day').innerHTML = r.byDay.map((d) => `<tr><td>${brDate(d.date)}</td><td class="num">${fmtDur(d.tasks, false)}</td><td class="num">${fmtDur(d.ponto, false)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Sem dados.</td></tr>';
  }

  function renderSettings() {
    $('s-daily').value = S.settings.dailyTarget;
    $('s-weekly').value = S.settings.weeklyTarget;
  }

  // ===================== Diálogos =====================
  let editingId = null;
  function openTaskEditor(id) {
    const e = S.entries.find((x) => x.id === id); if (!e) return;
    editingId = id;
    $('e-name').value = e.name; $('e-cat').value = e.category || ''; $('e-qty').value = e.quantity ?? '';
    $('e-date').value = e.date; $('e-dur').value = fmtDur(entryDur(e));
    const live = e.end == null;
    $('e-dur').disabled = live;
    $('e-dur-hint').textContent = live ? '(travada: tarefa em andamento)' : '';
    $('dlg-task').showModal();
  }
  $('dlg-task').addEventListener('close', () => {
    if ($('dlg-task').returnValue !== 'ok') return;
    const e = S.entries.find((x) => x.id === editingId); if (!e) return;
    e.name = $('e-name').value.trim() || e.name;
    e.category = $('e-cat').value.trim();
    e.quantity = $('e-qty').value === '' ? '' : Number($('e-qty').value);
    if ($('e-date').value) e.date = $('e-date').value;
    if (e.end != null) {
      const d = parseDur($('e-dur').value);
      if (d == null) { alert('Duração inválida. Use 1:30:00 ou 1h30m.'); return; }
      e.acc = d;
    }
    save(); renderAll();
  });
  $('e-del').addEventListener('click', () => {
    if (!confirm('Remover este lançamento?')) return;
    S.entries = S.entries.filter((x) => x.id !== editingId);
    $('dlg-task').close('cancel'); save(); renderAll();
  });

  // --- dia de ponto ---
  let editingDate = null;
  function breakRow(start = '', end = '') {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `<input type="time" class="b-start" value="${start}"> até <input type="time" class="b-end" value="${end}"> <button type="button" class="danger">×</button>`;
    div.querySelector('button').onclick = () => div.remove();
    $('d-breaks').appendChild(div);
  }
  function openDayEditor(date) {
    editingDate = date || null;
    const d = date ? S.days[date] : null;
    $('d-date').value = date || today();
    $('d-in').value = d ? hm(d.in) : '';
    $('d-out').value = d ? hm(d.out) : '';
    $('d-breaks').innerHTML = '';
    (d?.breaks || []).forEach((b) => breakRow(hm(b.start), hm(b.end)));
    $('d-del').classList.toggle('hidden', !date);
    $('dlg-day').showModal();
  }
  $('d-add-break').onclick = () => breakRow();
  $('dlg-day').addEventListener('close', () => {
    if ($('dlg-day').returnValue !== 'ok') return;
    const date = $('d-date').value; if (!date) return;
    const base = parseYmd(date).getTime();
    const at = (v) => { if (!v) return null; const [h, m] = v.split(':').map(Number); return base + (h * 60 + m) * 60000; };
    const prev = editingDate ? S.days[editingDate] : null;
    // preserva segundos originais quando o horário não foi alterado
    const keep = (orig, v) => (orig != null && hm(orig) === v && editingDate === date ? orig : at(v));
    const day = { in: keep(prev?.in, $('d-in').value), out: keep(prev?.out, $('d-out').value), breaks: [] };
    $('d-breaks').querySelectorAll('.row').forEach((r, i) => {
      const s = r.querySelector('.b-start').value, e = r.querySelector('.b-end').value;
      const pb = prev?.breaks?.[i];
      if (s) day.breaks.push({ start: keep(pb?.start, s), end: e ? keep(pb?.end, e) : null });
    });
    if (day.out != null && day.in != null && day.out < day.in) { alert('A saída é anterior à entrada.'); return; }
    if (editingDate && editingDate !== date) delete S.days[editingDate];
    S.days[date] = day;
    save(); renderAll();
  });
  $('d-del').addEventListener('click', () => {
    if (!editingDate || !confirm('Remover o ponto deste dia?')) return;
    delete S.days[editingDate];
    $('dlg-day').close('cancel'); save(); renderAll();
  });

  // ===================== Eventos =====================
  $('tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tab]'); if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('main > section').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + tab));
    renderAll();
  });

  const formFields = () => ({
    name: $('t-name').value.trim(), category: $('t-cat').value.trim(),
    quantity: $('t-qty').value === '' ? '' : Number($('t-qty').value),
  });
  $('task-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = formFields(); if (!f.name) return;
    startTask(f.name, f.category, f.quantity);
    save(); renderAll();
  });
  $('btn-stop').addEventListener('click', () => { stopTask(); save(); renderAll(); });
  $('m-date').value = today();
  $('manual-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = formFields();
    if (!f.name) { alert('Preencha o nome da tarefa no formulário acima.'); $('t-name').focus(); return; }
    const d = parseDur($('m-dur').value);
    if (d == null) { alert('Duração inválida. Use 1h30m, 90m ou 1:30.'); return; }
    addManual(f.name, f.category, f.quantity, $('m-date').value || today(), d);
    $('m-dur').value = '';
    save(); renderAll();
  });

  $('t-filter').addEventListener('change', renderTasks);
  $('t-body').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const id = +b.closest('tr').dataset.id;
    if (b.dataset.act === 'edit') openTaskEditor(id);
    if (b.dataset.act === 'again') {
      const e = S.entries.find((x) => x.id === id);
      startTask(e.name, e.category, e.quantity); save(); renderAll();
    }
  });
  $('t-body').addEventListener('dblclick', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr) openTaskEditor(+tr.dataset.id); });

  $('btn-meet').addEventListener('click', () => {
    if (!S.meeting) {
      S.meeting = { start: Date.now(), name: $('meet-name').value.trim() };
    } else {
      const now = Date.now(), m = S.meeting;
      const name = $('meet-name').value.trim() || m.name || 'Reunião';
      S.entries.push({ id: S.nextId++, name, category: 'reunião', quantity: '', date: ymd(new Date(m.start)),
        start: m.start, end: now, acc: (now - m.start) / 1000, resumedAt: null });
      S.meeting = null; $('meet-name').value = '';
    }
    save(); renderAll();
  });

  $('btn-in').onclick = () => { punchIn(); save(); renderAll(); };
  $('btn-break').onclick = () => { punchBreak(); save(); renderAll(); };
  $('btn-resume').onclick = () => { punchResume(); save(); renderAll(); };
  $('btn-out').onclick = () => {
    if (running() && !confirm('Há uma tarefa em andamento. Ela será parada junto com a saída. Continuar?')) return;
    punchOut(); save(); renderAll();
  };
  $('p-filter').addEventListener('change', renderPonto);
  $('btn-newday').onclick = () => openDayEditor(null);
  $('p-body').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-act]'); if (b) openDayEditor(b.closest('tr').dataset.date); });
  $('p-body').addEventListener('dblclick', (ev) => { const tr = ev.target.closest('tr[data-date]'); if (tr) openDayEditor(tr.dataset.date); });

  ['r-period', 'r-from', 'r-to'].forEach((id) => $(id).addEventListener('change', renderReports));
  $('btn-xlsx').onclick = () => {
    const rg = reportRange();
    Export.download(Export.xlsx(sheetsFor(rg)), `in_clock_${rangeLabel(rg)}.xlsx`);
  };
  $('btn-csv').onclick = () => {
    const rg = reportRange(), sep = $('r-sep').value;
    const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const files = sheetsFor(rg).map((s) => ({ name: `${slug(s.name)}.csv`, data: Export.csv(s.rows, sep) }));
    Export.download(Export.zip(files), `in_clock_csv_${rangeLabel(rg)}.zip`);
  };


  $('settings-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    S.settings.dailyTarget = Number($('s-daily').value) || 0;
    S.settings.weeklyTarget = Number($('s-weekly').value) || 0;
    save(); renderAll(); alert('Ajustes salvos.');
  });
  $('btn-backup').onclick = () => Export.download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), `in_clock_backup_${today()}.json`);
  $('restore').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.entries) || typeof data.days !== 'object') throw new Error('arquivo não parece um backup do in_clock');
      if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(data)); S = load(); renderAll();
    } catch (e) { alert('Não foi possível restaurar: ' + e.message); }
    ev.target.value = '';
  });
  $('btn-wipe').onclick = () => {
    if (!confirm('Apagar TODOS os dados do in_clock neste navegador? Faça um backup antes.')) return;
    S = defaults(); save(); renderAll();
  };

  // ===================== Importação do Clock (Java) =====================
  // Formato: linhas separadas por TAB.
  //   S chave valor                         configurações (só as metas são lidas)
  //   E id início fim segundos origem projeto nome categoria qtd
  //   R nome categoria qtd início pausas    tarefa em andamento (pausas "ini,fim;ini,fim")
  //   J data entrada saída pausas           ponto do dia
  function parseJavaData(text) {
    const ts = (v) => { if (!v) return null; const t = Date.parse(v); return isNaN(t) ? null : t; };
    const pairs = (v) => (v || '').split(';').filter((x) => x.trim()).map((x) => {
      const [a, b] = x.split(','); return { start: ts(a), end: ts(b) };
    }).filter((b) => b.start != null);
    const num = (v) => (v === undefined || v === '' ? '' : Number(v));
    const out = { settings: {}, entries: [], days: {}, running: null };
    for (const line of text.split(/\r?\n/)) {
      const f = line.split('\t');
      switch (f[0]) {
        case 'S':
          if (f[1] === 'daily_target_hours') out.settings.dailyTarget = Number(f[2]);
          if (f[1] === 'weekly_target_hours') out.settings.weeklyTarget = Number(f[2]);
          break;
        case 'E': {
          const start = ts(f[2]), end = ts(f[3]);
          if (start == null) break;
          out.entries.push({ name: f[7] || '(sem nome)', category: f[8] || '', quantity: num(f[9]), project: f[6] || '',
            date: f[2].slice(0, 10), start, end: end ?? start, acc: Number(f[4]) || 0, resumedAt: null,
            manual: f[5] === 'manual' || undefined });
          break;
        }
        case 'R': {
          const start = ts(f[4]); if (start == null) break;
          const pauses = pairs(f[5]);
          // tempo efetivo = segmentos entre as pausas
          let acc = 0, cursor = start, resumedAt = start, paused = false;
          for (const p of pauses) {
            acc += Math.max(0, p.start - cursor) / 1000;
            if (p.end == null) { paused = true; resumedAt = null; break; }
            cursor = resumedAt = p.end;
          }
          out.running = { name: f[1] || '(sem nome)', category: f[2] || '', quantity: num(f[3]), date: f[4].slice(0, 10),
            start, end: null, acc, resumedAt: paused ? null : resumedAt, pausedByPonto: paused };
          break;
        }
        case 'J':
          if (!f[1]) break;
          out.days[f[1]] = { in: ts(f[2]), out: ts(f[3]), breaks: pairs(f[4]) };
          break;
      }
    }
    return out;
  }

  function importJava(text) {
    const d = parseJavaData(text);
    if (!d.entries.length && !Object.keys(d.days).length) throw new Error('nenhum lançamento ou ponto encontrado — é mesmo o clock_data.txt?');
    const starts = new Set(S.entries.map((e) => e.start));
    let nE = 0, nD = 0, nSkip = 0;
    for (const e of d.entries) {
      if (starts.has(e.start)) { nSkip++; continue; }
      S.entries.push(Object.assign({ id: S.nextId++ }, e)); starts.add(e.start); nE++;
    }
    let runMsg = '';
    if (d.running && !starts.has(d.running.start)) {
      if (running()) runMsg = ' A tarefa em andamento do arquivo foi ignorada (já há uma rodando aqui).';
      else {
        S.entries.push(Object.assign({ id: S.nextId++ }, d.running));
        runMsg = ` Tarefa em andamento importada: "${d.running.name}" desde ${brDate(d.running.date)} — confira e pare/ajuste se necessário.`;
      }
    }
    for (const [date, day] of Object.entries(d.days)) {
      if (S.days[date]?.in) continue; // não sobrescreve ponto já lançado aqui
      S.days[date] = day; nD++;
    }
    Object.assign(S.settings, Object.fromEntries(Object.entries(d.settings).filter(([, v]) => isFinite(v) && v > 0)));
    save(); renderAll();
    return `Importados: ${nE} lançamentos, ${nD} dias de ponto${nSkip ? ` (${nSkip} já existiam)` : ''}. Metas: ${S.settings.dailyTarget}h/dia, ${S.settings.weeklyTarget}h/semana.${runMsg}`;
  }
  $('import-java').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { $('import-status').textContent = importJava(await f.text()); }
    catch (e) { $('import-status').textContent = 'Não foi possível importar: ' + e.message; }
    ev.target.value = '';
  });

  // Atalhos de teste/depuração
  window.InClock = { get state() { return S; }, parseDur, fmtDur, range };

  // ===================== Loop =====================
  renderAll();
  let ticks = 0;
  setInterval(() => {
    renderLive();
    if (++ticks % 30 === 0) { if (tab === 'ponto') renderPonto(); if (tab === 'relatorios') renderReports(); }
  }, 1000);
})();
