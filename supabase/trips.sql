-- ===== ROAD MINERS — voyages (tournées employés) =====
-- trips : illisible publiquement. Admin gère via RPC ; l'employé lit
-- UNIQUEMENT ses propres voyages via get_my_trip (code d'accès actif).

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null default '',
  employees text[] not null default '{}',   -- codes d'accès des employés
  days jsonb not null default '[]'::jsonb   -- [{date, hotel:{city,name,addr,tel,conf}, event:{city,name,addr,tel,urg,contact}}]
);
alter table trips enable row level security;

-- crée / modifie un voyage (admin)
create or replace function admin_save_trip(p_admin text, p_id uuid, p_title text, p_employees jsonb, p_days jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare emps text[];
declare new_id uuid;
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return json_build_object('ok', false);
  end if;
  select coalesce(array_agg(upper(trim(x))), '{}') into emps
    from jsonb_array_elements_text(coalesce(p_employees, '[]'::jsonb)) x;
  if p_id is null then
    -- (la tournée Saskatchewan est insérée en base ; voir l'historique
-- git ou l'onglet Voyages de l'admin pour les données jour par jour)
