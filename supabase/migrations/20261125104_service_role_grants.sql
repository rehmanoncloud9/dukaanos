-- DukaanOS · 20261125104 · Ensure service_role has explicit table/sequence privileges on public schema

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
