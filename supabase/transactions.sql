-- ===== ROAD MINERS — transactions (achats comptoir) =====
-- Données clients (PII) : table INACCESSIBLE en lecture publique.
-- Insertion via RPC avec code employé actif ; lecture via RPC admin seulement.

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  seller_code text not null default '',
  client jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  total numeric not null default 0
);
alter table transactions enable row level security;
-- aucune policy → invisible pour l'anon en lecture comme en écriture

-- enregistre une transaction (code employé ou admin actif requis)
create or replace function save_transaction(
  p_code text, p_client jsonb, p_items jsonb, p_photos jsonb, p_total numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_code)) and active) then
    return false;
  end if;
  insert into transactions (seller_code, client, items, photos, total)
  values (upper(trim(p_code)),
          coalesce(p_client, '{}'::jsonb),
          coalesce(p_items, '[]'::jsonb),
          coalesce(p_photos, '[]'::jsonb),
          coalesce(p_total, 0));
  return true;
end $$;

-- liste des transactions (admin) — avec client et articles, sans les photos
drop function if exists admin_list_transactions(text);
create function admin_list_transactions(p_admin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return '[]'::json;
  end if;
  return (select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select id, created_at, seller_code, client, items,
           jsonb_array_length(photos) as nb_photos, total
      from transactions order by created_at desc limit 500) t);
end $$;

-- détail complet d'une transaction, photos incluses (admin)
create or replace function admin_get_transaction(p_admin text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from access_codes
                 where code = upper(trim(p_admin)) and role = 'admin' and active) then
    return 'null'::json;
  end if;
  return (select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select * from transactions where id = p_id) t);
end $$;

grant execute on function save_transaction(text, jsonb, jsonb, jsonb, numeric) to anon;
grant execute on function admin_list_transactions(text) to anon;
grant execute on function admin_get_transaction(text, uuid) to anon;
