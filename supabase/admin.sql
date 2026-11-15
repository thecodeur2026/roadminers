-- ===== ROAD MINERS — contrôle d'accès & tableau de bord admin =====
-- Tables : app_control (état du site) + access_codes (codes invités/admin).
-- Les codes ne sont JAMAIS lisibles publiquement (RLS, aucun SELECT anon) :
-- toute vérification passe par des fonctions RPC security definer.

create table if not exists app_control (
  id int primary key default 1,
  blocked boolean not null default false,
  message text not null default 'Application temporairement indisponible.',
  updated_at timestamptz not null default now()
);
insert into app_control (id) values (1) on conflict (id) do nothing;

alter table app_control enable row level security;
-- l'app doit pouvoir LIRE l'état du site (bloqué ou non) sans code
drop policy if exists "lecture publique" on app_control;
create policy "lecture publique" on app_control for select using (true);

create table if not exists access_codes (
  code text primary key,
  label text not null default '',
  role text not null default 'guest' check (role in ('guest', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table access_codes enable row level security;
-- aucune policy → table invisible en lecture/écriture pour l'anon

-- code admin initial — À CHANGER dans le tableau de bord après la 1re connexion
insert into access_codes (code, label, role)
values ('RM-ADMIN-2026', 'admin initial', 'admin')
on conflict (code) do nothing;

-- vérifie un code : renvoie 'guest' | 'admin' | 'denied'
create or replace function verify_access(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from access_codes
   where code = upper(trim(p_code)) and active;
  return coalesce(r, 'denied');
end $$;

-- bloque / débloque le site (admin seulement)
create or replace function admin_set_blocked(p_admin text, p_blocked boolean, p_message text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return false;
  end if;
  update app_control
     set blocked = p_blocked,
         message = coalesce(nullif(trim(p_message), ''), message),
         updated_at = now()
   where id = 1;
  return true;
end $$;

-- liste des codes (admin)
drop function if exists admin_list_codes(text);
create function admin_list_codes(p_admin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return '[]'::json;
  end if;
  return (select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select c.code, c.label, c.role, c.active, c.created_at
      from access_codes c order by c.created_at desc) t);
end $$;

-- ajoute un code (admin)
create or replace function admin_add_code(p_admin text, p_code text, p_label text default '', p_role text default 'guest')
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return false;
  end if;
  if length(trim(p_code)) < 4 then return false; end if;
  insert into access_codes (code, label, role)
  values (upper(trim(p_code)), trim(p_label), case when p_role = 'admin' then 'admin' else 'guest' end)
  on conflict (code) do update
    set label = excluded.label, role = excluded.role, active = true;
  return true;
end $$;

-- active / désactive un code (admin)
create or replace function admin_set_active(p_admin text, p_code text, p_active boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return false;
  end if;
  update access_codes set active = p_active where code = upper(trim(p_code));
  return found;
end $$;

-- supprime un code (admin) — impossible de supprimer le dernier admin actif
create or replace function admin_delete_code(p_admin text, p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return false;
  end if;
  select role into target_role from access_codes where code = upper(trim(p_code));
  if target_role = 'admin' and
     (select count(*) from access_codes where role = 'admin' and active) <= 1 then
    return false;
  end if;
  delete from access_codes where code = upper(trim(p_code));
  return found;
end $$;

grant execute on function verify_access(text) to anon;
grant execute on function admin_set_blocked(text, boolean, text) to anon;
grant execute on function admin_list_codes(text) to anon;
grant execute on function admin_add_code(text, text, text, text) to anon;
grant execute on function admin_set_active(text, text, boolean) to anon;
grant execute on function admin_delete_code(text, text) to anon;
