-- ACTUALIZACION: deudores + edicion de fechas y pagos
-- Ejecutar tambien si ya tienes la BD creada
-- ============================================================

create table if not exists public.deudores (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null unique,
  telefono    text,
  dni         text,
  direccion   text,
  notas       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_deudores_nombre on public.deudores(nombre);

alter table public.deudores enable row level security;

drop policy if exists "deudores_select" on public.deudores;
create policy "deudores_select" on public.deudores
  for select to authenticated using (true);

drop policy if exists "deudores_insert" on public.deudores;
create policy "deudores_insert" on public.deudores
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists "deudores_update" on public.deudores;
create policy "deudores_update" on public.deudores
  for update to authenticated using (true) with check (auth.uid() is not null);

drop trigger if exists trg_deudores_updated_at on public.deudores;
create trigger trg_deudores_updated_at
  before update on public.deudores
  for each row execute function update_updated_at();

-- Crear deudores iniciales desde prestamos existentes
insert into public.deudores(nombre)
select distinct upper(trim(deudor))
from public.prestamos
where deudor is not null and trim(deudor) <> ''
on conflict (nombre) do nothing;

-- Editar fecha de prestamo y fecha de pago/vencimiento del prestamo
create or replace function editar_fechas_prestamo(
  p_prestamo_id uuid,
  p_fecha_prestamo date,
  p_fecha_vencimiento date
) returns json language plpgsql as $$
begin
  if p_fecha_prestamo is null or p_fecha_vencimiento is null then
    return json_build_object('ok', false, 'error', 'Fechas invalidas');
  end if;

  update public.prestamos
  set fecha_prestamo = p_fecha_prestamo,
      fecha_vencimiento = p_fecha_vencimiento
  where id = p_prestamo_id;

  if not found then
    return json_build_object('ok', false, 'error', 'Prestamo no encontrado');
  end if;

  perform recalcular_estado(p_prestamo_id);
  return json_build_object('ok', true);
end; $$;

-- Editar fecha y nota de un pago ya registrado
create or replace function editar_pago(
  p_pago_id uuid,
  p_fecha_pago date,
  p_nota text
) returns json language plpgsql as $$
begin
  if p_fecha_pago is null then
    return json_build_object('ok', false, 'error', 'Fecha invalida');
  end if;

  update public.pagos
  set fecha_pago = p_fecha_pago,
      nota = coalesce(p_nota, nota)
  where id = p_pago_id;

  if not found then
    return json_build_object('ok', false, 'error', 'Pago no encontrado');
  end if;

  return json_build_object('ok', true);
end; $$;

drop policy if exists "pagos_update" on public.pagos;
create policy "pagos_update" on public.pagos
  for update to authenticated using (true) with check (auth.uid() is not null);
