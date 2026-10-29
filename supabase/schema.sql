-- ROAD MINERS — schéma Supabase
-- Exécuter dans l'éditeur SQL du projet Supabase.

create table if not exists entries (
  id bigint generated always as identity primary key,
  source text not null default 'guide',        -- 'guide' (prix d'achat) | 'catalogue' (valeur)
  page int,
  section text default '',
  category text default '',
  series text default '',
  date text default '',
  description text default '',
  price numeric,
  uncertain boolean default false,
  content_table boolean default false
);

-- index de recherche plein texte simple
create index if not exists entries_search_idx on entries
  using gin (to_tsvector('simple',
    coalesce(section,'') || ' ' || coalesce(category,'') || ' ' ||
    coalesce(series,'')  || ' ' || coalesce(date,'')     || ' ' ||
    coalesce(description,'')));

-- lecture publique (l'app ne fait que lire)
alter table entries enable row level security;
create policy "lecture publique" on entries for select using (true);

-- cache des cours (rempli par l'Edge Function ou le serveur local)
create table if not exists spot_cache (
  id int primary key default 1,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table spot_cache enable row level security;
create policy "lecture publique spot" on spot_cache for select using (true);
