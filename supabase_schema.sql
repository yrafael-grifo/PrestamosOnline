-- ============================================================
-- PrestaControl — Supabase Schema
-- Ejecutar en: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- ─── EXTENSIONES ──────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── TABLA: prestamistas ──────────────────────────────────
create table if not exists public.prestamistas (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null unique,
  created_at  timestamptz default now(),
  created_by  uuid references auth.users(id)
);

-- ─── TABLA: prestamos ─────────────────────────────────────
create table if not exists public.prestamos (
  id              uuid primary key default uuid_generate_v4(),
  prestamista     text not null,
  deudor          text not null,
  fecha_prestamo  date not null,
  monto           numeric(12,2) not null check (monto > 0),
  meses           int not null check (meses between 1 and 60),
  interes_total   numeric(12,2) not null,
  total_pagar     numeric(12,2) not null,
  fecha_vencimiento date not null,
  monto_pagado    numeric(12,2) not null default 0,
  monto_pendiente numeric(12,2) not null,
  estado          text not null default 'ACTIVO' check (estado in ('ACTIVO','PAGADO','VENCIDO','PARCIAL')),
  notas           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ─── TABLA: pagos ─────────────────────────────────────────
create table if not exists public.pagos (
  id          uuid primary key default uuid_generate_v4(),
  prestamo_id uuid not null references public.prestamos(id) on delete cascade,
  monto       numeric(12,2) not null check (monto > 0),
  fecha_pago  date not null,
  nota        text,
  registrado_por uuid references auth.users(id),
  created_at  timestamptz default now()
);

-- ─── ÍNDICES ──────────────────────────────────────────────
create index if not exists idx_prestamos_estado       on public.prestamos(estado);
create index if not exists idx_prestamos_vencimiento  on public.prestamos(fecha_vencimiento);
create index if not exists idx_prestamos_prestamista  on public.prestamos(prestamista);
create index if not exists idx_pagos_prestamo         on public.pagos(prestamo_id);

-- ─── TRIGGER: updated_at automático ──────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_prestamos_updated_at on public.prestamos;
create trigger trg_prestamos_updated_at
  before update on public.prestamos
  for each row execute function update_updated_at();

-- ─── FUNCIÓN: recalcular estado del préstamo ─────────────
create or replace function recalcular_estado(p_id uuid)
returns void language plpgsql as $$
declare
  v_total    numeric;
  v_pagado   numeric;
  v_pendiente numeric;
  v_vence    date;
  v_estado   text;
begin
  select total_pagar, monto_pagado, monto_pendiente, fecha_vencimiento
  into v_total, v_pagado, v_pendiente, v_vence
  from public.prestamos where id = p_id;

  if v_pendiente <= 0.01 then
    v_estado := 'PAGADO';
  elsif v_vence < current_date then
    v_estado := 'VENCIDO';
  elsif v_pagado > 0 then
    v_estado := 'PARCIAL';
  else
    v_estado := 'ACTIVO';
  end if;

  update public.prestamos
  set estado = v_estado, updated_at = now()
  where id = p_id;
end; $$;

-- ─── FUNCIÓN: registrar pago ──────────────────────────────
create or replace function registrar_pago(
  p_prestamo_id uuid,
  p_monto       numeric,
  p_fecha       date,
  p_nota        text,
  p_user_id     uuid
) returns json language plpgsql as $$
declare
  v_pendiente numeric;
  v_nuevo_pagado numeric;
  v_nuevo_pendiente numeric;
begin
  -- Obtener pendiente actual
  select monto_pendiente, monto_pagado
  into v_pendiente, v_nuevo_pagado
  from public.prestamos where id = p_prestamo_id for update;

  if v_pendiente is null then
    return json_build_object('ok', false, 'error', 'Préstamo no encontrado');
  end if;
  if p_monto > v_pendiente + 0.01 then
    return json_build_object('ok', false, 'error', 'Monto supera el pendiente');
  end if;

  -- Insertar pago
  insert into public.pagos(prestamo_id, monto, fecha_pago, nota, registrado_por)
  values (p_prestamo_id, p_monto, p_fecha, p_nota, p_user_id);

  -- Actualizar préstamo
  v_nuevo_pagado := v_nuevo_pagado + p_monto;
  v_nuevo_pendiente := greatest(0, v_pendiente - p_monto);

  update public.prestamos
  set monto_pagado = v_nuevo_pagado,
      monto_pendiente = v_nuevo_pendiente
  where id = p_prestamo_id;

  -- Recalcular estado
  perform recalcular_estado(p_prestamo_id);

  return json_build_object('ok', true);
end; $$;

-- ─── FUNCIÓN: actualizar estados vencidos (cron) ──────────
create or replace function actualizar_estados_vencidos()
returns void language plpgsql as $$
begin
  update public.prestamos
  set estado = 'VENCIDO', updated_at = now()
  where estado in ('ACTIVO','PARCIAL')
    and fecha_vencimiento < current_date
    and monto_pendiente > 0.01;
end; $$;

-- ─── RLS: Habilitar ───────────────────────────────────────
alter table public.prestamos    enable row level security;
alter table public.pagos        enable row level security;
alter table public.prestamistas enable row level security;

-- ─── RLS POLICIES: prestamistas ───────────────────────────
-- Todos los usuarios autenticados pueden ver prestamistas
create policy "prestamistas_select" on public.prestamistas
  for select to authenticated using (true);

-- Solo admin puede insertar/modificar prestamistas
create policy "prestamistas_insert" on public.prestamistas
  for insert to authenticated
  with check (
    exists (select 1 from auth.users where id = auth.uid()
            and raw_user_meta_data->>'role' = 'admin')
  );

-- ─── RLS POLICIES: prestamos ──────────────────────────────
-- Todos los autenticados pueden ver todos los préstamos
create policy "prestamos_select" on public.prestamos
  for select to authenticated using (true);

-- Todos los autenticados pueden insertar
create policy "prestamos_insert" on public.prestamos
  for insert to authenticated
  with check (auth.uid() is not null);

-- Todos los autenticados pueden actualizar (pagos)
create policy "prestamos_update" on public.prestamos
  for update to authenticated using (true);

-- ─── RLS POLICIES: pagos ──────────────────────────────────
create policy "pagos_select" on public.pagos
  for select to authenticated using (true);

create policy "pagos_insert" on public.pagos
  for insert to authenticated
  with check (auth.uid() is not null);

-- ─── DATOS INICIALES: prestamistas ────────────────────────
insert into public.prestamistas (nombre) values
  ('LESLY'), ('MARIA'), ('YONI'),
  ('VILLANUEVA'), ('CELINDA'), ('LILIANA'), ('YONI/LESLY')
on conflict (nombre) do nothing;

-- ─── DATOS SEMILLA: historial Excel ───────────────────────
-- (Descomenta si quieres importar el historial del Excel)
/*
insert into public.prestamos
  (prestamista,deudor,fecha_prestamo,monto,meses,interes_total,total_pagar,fecha_vencimiento,monto_pagado,monto_pendiente,estado,notas)
values
  ('YONI','CHILENO','2024-11-17',700,3,420,1120,'2025-02-15',1120,0,'PAGADO',''),
  ('CELINDA','JOSE','2024-11-29',600,6,600,1200,'2025-06-27',1200,0,'PAGADO',''),
  ('MARIA','JOSE','2024-12-05',100,3,60,160,'2025-03-05',160,0,'PAGADO',''),
  ('YONI','GENESIS','2025-02-17',100,1,20,120,'2025-03-20',0,120,'VENCIDO',''),
  ('YONI','CHILENO','2025-01-28',400,2,240,640,'2025-03-29',0,640,'VENCIDO',''),
  ('YONI','VICTOR','2025-03-07',150,1,30,180,'2025-04-06',0,180,'ACTIVO',''),
  ('YONI','JOSE','2025-03-08',200,1,40,240,'2025-04-08',0,240,'ACTIVO',''),
  ('YONI','PEDRO','2025-03-09',200,1,40,240,'2025-04-09',0,240,'ACTIVO','');
*/

-- ─── REALTIME ─────────────────────────────────────────────
-- Habilitar Realtime en: Supabase Dashboard > Database > Replication
-- Tablas a activar: prestamos, pagos, prestamistas
