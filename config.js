// Configuração do totem — preencha a chave e pronto.
// Supabase → Project Settings → API → "anon public" (é pública por natureza; a segurança vem das regras do totem.sql).
window.TOTEM_CONFIG = {
  SUPABASE_URL: "https://mrkomxylwdwbviazgxhm.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_zIh487gWOINVqRmtP8jNVw_paIi6jFh",
  // Domínio do login do sistema (usuário "totem" vira totem@vipgrafica.internal)
  DOMINIO_LOGIN: "vipgrafica.internal"
};
