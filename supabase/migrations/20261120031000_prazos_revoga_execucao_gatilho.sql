-- função de gatilho: não deve ser chamada pela API
revoke execute on function public.prazo_confere_dono() from public, anon, authenticated;
