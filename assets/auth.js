// Login compartilhado por todos os sistemas do portal.
// Uso numa página protegida:
//   <script src="../assets/vendor/supabase-2.119.0.js"></script>
//   <script src="../assets/config.js"></script>
//   <script src="../assets/auth.js" data-root="../" data-protect></script>
//   ...  Auth.ready.then(({ user }) => { ...inicia o sistema... })
(function () {
  'use strict';
  const script = document.currentScript;
  const root = script?.dataset.root ?? './';
  const protect = script?.hasAttribute('data-protect');
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
  }

  const ready = sb.auth.getSession().then(({ data }) => {
    const user = data.session?.user ?? null;
    if (protect && !user) { location.replace(loginUrl()); return new Promise(() => {}); }
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
