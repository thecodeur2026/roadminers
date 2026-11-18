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
    insert into trips (title, employees, days)
    values (trim(p_title), emps, coalesce(p_days, '[]'::jsonb))
    returning id into new_id;
  else
    update trips set title = trim(p_title), employees = emps,
           days = coalesce(p_days, '[]'::jsonb)
     where id = p_id;
    new_id := p_id;
  end if;
  return json_build_object('ok', true, 'id', new_id);
end $$;

-- liste des voyages (admin) — employés résolus en code + étiquette
create or replace function admin_list_trips(p_admin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return '[]'::json;
  end if;
  return (select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select tr.id, tr.title, tr.days, tr.created_at,
           (select coalesce(json_agg(json_build_object('code', c.code, 'label', c.label)), '[]'::json)
              from access_codes c where c.code = any(tr.employees)) as employees
      from trips tr order by tr.created_at desc) t);
end $$;

-- supprime un voyage (admin)
create or replace function admin_delete_trip(p_admin text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return false;
  end if;
  delete from trips where id = p_id;
  return found;
end $$;

-- voyages de l'employé connecté (code invité ou admin actif)
create or replace function get_my_trip(p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_code)) and active) then
    return '[]'::json;
  end if;
  return (select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select tr.id, tr.title, tr.days,
           (select coalesce(json_agg(json_build_object('code', c.code, 'label', c.label)), '[]'::json)
              from access_codes c where c.code = any(tr.employees)) as employees
      from trips tr
     where upper(trim(p_code)) = any(tr.employees)
     order by tr.created_at desc) t);
end $$;

grant execute on function admin_save_trip(text, uuid, text, jsonb, jsonb) to anon;
grant execute on function admin_list_trips(text) to anon;
grant execute on function admin_delete_trip(text, uuid) to anon;
grant execute on function get_my_trip(text) to anon;

-- ===== Données de démonstration (tournée de l'image : Luc / Karim, Alberta) =====
insert into access_codes (code, label, role)
values ('LUC-2026', 'Luc Loupien', 'guest'), ('KARIM-2026', 'Karim', 'guest')
on conflict (code) do nothing;

insert into trips (title, employees, days)
select 'Journée d''achat — Alberta (12 au 22 nov.)',
       array['LUC-2026', 'KARIM-2026'],
       '[
 {"date":"2026-11-12","hotel":{"city":"COLD LAKE","name":"Best Western Cold Lake Inn","addr":"4815 52nd Street, Cold Lake","tel":"780-594-4888","conf":"310916597"},"event":null},
 {"date":"2026-11-13","hotel":{"city":"ST. PAUL","name":"Canalta St. Paul","addr":"5008 42 Street, St. Paul","tel":"780-645-5581","conf":"CH68864AFA875"},"event":{"city":"COLD LAKE","name":"Royal Canadian Legion","addr":"1007 - 7th Avenue, Cold Lake","tel":"780-639-3579","urg":"780-812-9298","contact":"Shannon"}},
 {"date":"2026-11-14","hotel":{"city":"VEGREVILLE","name":"Vegreville Suites","addr":"6539 Hwy 16A West, Vegreville","tel":"780-632-2094","conf":"50372"},"event":{"city":"ST. PAUL","name":"Royal Canadian Legion","addr":"4925 - 49th Avenue, St. Paul","tel":"780-645-1828","urg":"780-645-3937","contact":"Harold"}},
 {"date":"2026-11-15","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"VEGREVILLE","name":"Elks Hall","addr":"5002 - 55th Avenue, Vegreville","tel":"780-632-2477","urg":"780-632-7810","contact":"Brenda"}},
 {"date":"2026-11-16","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"MORINVILLE","name":"Royal Canadian Legion","addr":"10120 - 101st Avenue, Morinville","tel":"780-916-5748","urg":"","contact":"Joe"}},
 {"date":"2026-11-17","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"WESTLOCK","name":"Memorial Hall","addr":"9903 - 106th Street, Westlock","tel":"780-349-6899","urg":"780-349-3260","contact":"Anita"}},
 {"date":"2026-11-18","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"BARRHEAD","name":"Agrena","addr":"5607 - 47th Street, Barrhead","tel":"780-674-2532","urg":"","contact":"Jaclyn"}},
 {"date":"2026-11-19","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"FORT SASKATCHEWAN","name":"Hampton Inn","addr":"8709 - 101st Street, Fort Saskatchewan","tel":"780-997-1001","urg":"","contact":"Limone"}},
 {"date":"2026-11-20","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"ST. ALBERT","name":"The Salvation Army and Community Centre","addr":"165 Liberton Drive, St. Albert","tel":"780-458-1937","urg":"","contact":"Dana"}},
 {"date":"2026-11-21","hotel":{"city":"ST. ALBERT","name":"Holiday Inn Express & Suites","addr":"1145 St. Albert Trail, St. Albert","tel":"587-290-1837","conf":"26771391"},"event":{"city":"ST. ALBERT","name":"St. Albert Inn & Suites","addr":"156 St. Albert Trail, St. Albert","tel":"780-459-5551","urg":"","contact":"Anne"}},
 {"date":"2026-11-22","hotel":{"city":"EDMONTON","name":"Best Western Plus Airport Hotel","addr":"5705 50 Street, Edmonton","tel":"780-986-6550","conf":"551916198"},"event":{"city":"SPRUCE GROVE","name":"Pioneer Centre Golden Age Club","addr":"301 Jespersen Avenue, Spruce Grove","tel":"780-962-5020","urg":"","contact":"Brenda"}}
]'::jsonb
where not exists (select 1 from trips where title like 'Journée d''achat — Alberta%');
