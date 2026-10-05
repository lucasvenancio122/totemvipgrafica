-- =====================================================================
-- Totem de autoatendimento — envio por QR Code
-- Rodar uma vez no Supabase: SQL Editor → New query → colar → Run
-- =====================================================================

-- 1) Sessões de envio (uma por pedido no totem)
create table if not exists public.totem_sessoes (
  token          text primary key,              -- aleatório, vai dentro do QR
  status         text not null default 'aguardando', -- aguardando | conectado | enviado
  arquivo_path   text,
  arquivo_nome   text,
  arquivo_tipo   text,
  arquivo_bytes  bigint,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

alter table public.totem_sessoes enable row level security;

-- O totem entra com um usuário do sistema (authenticated) e gerencia as sessões.
drop policy if exists "totem gerencia sessoes" on public.totem_sessoes;
create policy "totem gerencia sessoes" on public.totem_sessoes
  for all to authenticated using (true) with check (true);

-- 2) O celular do cliente NÃO faz login. Ele só pode chamar estas funções,
--    e só para um token válido criado na última 1 hora.
create or replace function public.totem_token_valido(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.totem_sessoes
    where token = p_token and status <> 'enviado' and criado_em > now() - interval '1 hour'
  );
$$;

create or replace function public.totem_sessao_abrir(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare s text;
begin
  update public.totem_sessoes
     set status = case when status = 'aguardando' then 'conectado' else status end,
         atualizado_em = now()
   where token = p_token and criado_em > now() - interval '1 hour'
  returning status into s;
  return s; -- null = QR inválido ou expirado
end $$;

create or replace function public.totem_sessao_enviado(
  p_token text, p_path text, p_nome text, p_tipo text, p_bytes bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_path not like p_token || '/%' then return false; end if;
  update public.totem_sessoes
     set status = 'enviado', arquivo_path = p_path, arquivo_nome = left(p_nome, 200),
         arquivo_tipo = p_tipo, arquivo_bytes = p_bytes, atualizado_em = now()
   where token = p_token and status <> 'enviado' and criado_em > now() - interval '1 hour';
  return found;
end $$;

revoke all on function public.totem_token_valido(text) from public;
revoke all on function public.totem_sessao_abrir(text) from public;
revoke all on function public.totem_sessao_enviado(text, text, text, text, bigint) from public;
grant execute on function public.totem_token_valido(text) to anon, authenticated;
grant execute on function public.totem_sessao_abrir(text) to anon, authenticated;
grant execute on function public.totem_sessao_enviado(text, text, text, text, bigint) to anon, authenticated;

-- 3) Bucket privado para os arquivos (máx. 20 MB, só PDF/JPG/PNG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('totem-uploads', 'totem-uploads', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Celular: só pode ENVIAR, e só para a pasta de um token válido. Não lê nem lista nada.
drop policy if exists "totem celular envia" on storage.objects;
create policy "totem celular envia" on storage.objects
  for insert to anon
  with check (bucket_id = 'totem-uploads'
              and public.totem_token_valido((storage.foldername(name))[1]));

-- Totem (logado): lê e apaga os arquivos.
drop policy if exists "totem le arquivos" on storage.objects;
create policy "totem le arquivos" on storage.objects
  for select to authenticated using (bucket_id = 'totem-uploads');
drop policy if exists "totem apaga arquivos" on storage.objects;
create policy "totem apaga arquivos" on storage.objects
  for delete to authenticated using (bucket_id = 'totem-uploads');

-- 4) Avisar o totem na hora (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.totem_sessoes;
exception when duplicate_object then null; end $$;
