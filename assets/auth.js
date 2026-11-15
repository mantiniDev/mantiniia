// Login compartilhado por todos os sistemas do portal.
// Uso numa página protegida:
//   <script src="../assets/vendor/supabase-2.119.0.js"></script>
//   <script src="../assets/config.js"></script>
//   <script src="../assets/auth.js" data-root="../" data-protect></script>
//   ...  Auth.ready.then(({ user }) => { ...inicia o sistema... })
// Com data-sistema="processos", a página também exige acesso àquele sistema (definido no admin).
// Quem está com senha temporária é levado ao login para criar a própria senha.
(function () {
  'use strict';
  const script = document.currentScript;
  const root = script?.dataset.root ?? './';
  const protect = script?.hasAttribute('data-protect');
  const sistema = script?.dataset.sistema || null;
  const cfg = window.MANTINI_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  if (protect) document.documentElement.classList.add('auth-pending');

  const loginUrl = () => root + 'login/?next=' + encodeURIComponent(location.pathname + location.search + location.hash);

  function renderUser(user) {
    const slot = document.getElementById('user-slot');
    if (!slot) return;
    if (!user) { slot.innerHTML = `<a class="btn" href="${root}login/">Entrar</a>`; return; }
    slot.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'muted small'; span.textContent = user.email;
    const btn = document.createElement('button');
    btn.textContent = 'Sair'; btn.onclick = () => Auth.signOut();
    slot.append(span, btn);
    // link do admin só para quem é admin
    sb.rpc('sou_admin').then(({ data }) => {
      if (data && !slot.querySelector('.admin-link')) {
        const a = document.createElement('a');
        a.className = 'btn admin-link'; a.href = root + 'admin/'; a.textContent = '🔐 Admin';
        slot.prepend(a);
      }
    });
  }

  function semAcesso() {
    const show = () => {
      const main = document.querySelector('main');
      if (main) main.innerHTML = `<div class="card" style="max-width:520px;margin:8vh auto;text-align:center">
        <h2>Sem acesso a este sistema</h2>
        <p class="muted">Sua conta não tem permissão para usar este sistema. Fale com o administrador.</p>
        <p><a class="btn" href="${root}">← Voltar ao início</a></p></div>`;
      document.documentElement.classList.remove('auth-pending');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  }

  const ready = sb.auth.getSession().then(async ({ data }) => {
    const user = data.session?.user ?? null;
    if (protect && !user) { location.replace(loginUrl()); return new Promise(() => {}); }
    if (protect && user?.user_metadata?.trocar_senha) { location.replace(loginUrl() + '&trocar=1'); return new Promise(() => {}); }
    if (protect && sistema) {
      const { data: ok } = await sb.rpc('tem_acesso', { p_sistema: sistema });
      if (!ok) { semAcesso(); if (document.readyState !== 'loading') renderUser(user); else document.addEventListener('DOMContentLoaded', () => renderUser(user)); return new Promise(() => {}); }
    }
    document.documentElement.classList.remove('auth-pending');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => renderUser(user));
    else renderUser(user);
    return { user, session: data.session };
  });

  // Se a sessão expirar ou o usuário sair em outra aba, volta para o login.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && protect) location.replace(loginUrl());
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') renderUser(session?.user ?? null);
  });

  window.Auth = {
    sb, ready, loginUrl,
    async signOut() { await sb.auth.signOut(); location.href = root; },
  };
})();
