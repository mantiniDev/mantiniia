// Agenda compartilhada (audiências): contador de dias, notificações do navegador e
// arquivo de calendário (.ics) com lembretes. Usado pelo portal e pelo sistema Processos.
(function () {
  'use strict';
  const KEY_DIAS = 'mantini.agenda.avisoDias';
  const KEY_AVISADO = 'mantini.agenda.avisado';
  const pad = (n) => String(n).padStart(2, '0');

  /** Dias de calendário entre hoje e a data (0 = hoje, 1 = amanhã, negativo = passou). */
  function diasAte(iso) {
    const d = new Date(iso), h = new Date();
    const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const b = Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
    return Math.round((a - b) / 86400000);
  }
  function rotulo(iso) {
    const n = diasAte(iso);
    if (n < 0) return n === -1 ? 'ontem' : `há ${-n} dias`;
    return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`;
  }
  /** classe de urgência: hoje/amanhã e até 7 dias = urgente; até 30 = perto */
  const urgencia = (iso) => { const n = diasAte(iso); return n < 0 ? 'passou' : n <= 7 ? 'urgente' : n <= 30 ? 'perto' : 'longe'; };
  const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const avisoDias = () => Number(localStorage.getItem(KEY_DIAS)) || 7;
  const setAvisoDias = (n) => localStorage.setItem(KEY_DIAS, Math.max(1, Number(n) || 7));

  /** Audiências futuras (não realizadas) dentro da janela de aviso. */
  const proximas = (lista) => lista.filter((a) => !a.realizada && diasAte(a.data_hora) >= 0 && diasAte(a.data_hora) <= avisoDias())
    .sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

  // ---------- Notificações do navegador ----------
  const suportaNotificacao = () => 'Notification' in window;
  const notificacaoAtiva = () => suportaNotificacao() && Notification.permission === 'granted';
  async function pedirPermissao() {
    if (!suportaNotificacao()) return 'unsupported';
    return Notification.requestPermission();
  }
  /** Notifica cada audiência próxima no máximo 1 vez por dia. processoDe(a) -> {numero, titulo}. */
  function notificar(lista, processoDe, urlDe) {
    if (!notificacaoAtiva()) return;
    const hoje = new Date().toDateString();
    const feitos = JSON.parse(localStorage.getItem(KEY_AVISADO) || '{}');
    for (const k of Object.keys(feitos)) if (feitos[k] !== hoje) delete feitos[k];
    for (const a of proximas(lista)) {
      if (feitos[a.id] === hoje) continue;
      const p = processoDe(a) || {};
      const n = new Notification(`Audiência ${rotulo(a.data_hora)} — ${dataHora(a.data_hora)}`, {
        body: [a.tipo, p.numero, p.titulo, a.local].filter(Boolean).join(' · '),
        icon: '/assets/icon-512.png', tag: 'aud-' + a.id,
      });
      if (urlDe) n.onclick = () => { window.focus(); location.href = urlDe(a); };
      feitos[a.id] = hoje;
    }
    localStorage.setItem(KEY_AVISADO, JSON.stringify(feitos));
  }

  // ---------- Calendário ----------
  const icsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function titulo(a, p) { return `Audiência${a.tipo ? ' de ' + a.tipo : ''} — ${p.titulo || p.numero}`; }
  function descricao(a, p) { return [`Processo ${p.numero}`, p.tribunal, a.observacao].filter(Boolean).join('\n'); }

  /** Arquivo .ics com lembretes 1 dia e 2 horas antes. */
  function ics(a, p) {
    const ini = new Date(a.data_hora), fim = new Date(ini.getTime() + 60 * 60000);
    const alarm = (t, txt) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${t}`, `DESCRIPTION:${icsEsc(txt)}`, 'END:VALARM'];
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mantini.ia.br//Processos//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:aud-${a.id}@mantini.ia.br`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(ini)}`, `DTEND:${icsDate(fim)}`,
      `SUMMARY:${icsEsc(titulo(a, p))}`, `DESCRIPTION:${icsEsc(descricao(a, p))}`, a.local ? `LOCATION:${icsEsc(a.local)}` : null,
      ...alarm('-P1D', 'Audiência amanhã'), ...alarm('-PT2H', 'Audiência em 2 horas'),
      'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n') + '\r\n';
  }
  function baixarIcs(a, p) {
    const blob = new Blob([ics(a, p)], { type: 'text/calendar;charset=utf-8' });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = `audiencia_${p.numero.replace(/\D/g, '')}_${new Date(a.data_hora).toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(el); el.click();
    setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 1000);
  }
  function googleUrl(a, p) {
    const ini = new Date(a.data_hora), fim = new Date(ini.getTime() + 60 * 60000);
    const q = new URLSearchParams({ action: 'TEMPLATE', text: titulo(a, p), dates: `${icsDate(ini)}/${icsDate(fim)}`, details: descricao(a, p), location: a.local || '' });
    return 'https://calendar.google.com/calendar/render?' + q;
  }

  window.Agenda = { diasAte, rotulo, urgencia, dataHora, avisoDias, setAvisoDias, proximas,
    suportaNotificacao, notificacaoAtiva, pedirPermissao, notificar, ics, baixarIcs, googleUrl };
})();
