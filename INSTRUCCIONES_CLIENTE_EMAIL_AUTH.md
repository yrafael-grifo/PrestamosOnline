# TuSocio Financiero - Registro de cliente por correo

## 1. SQL a ejecutar

Ejecuta en Supabase, en este orden:

1. `03_UPDATE_SUPABASE_PORTAL_CLIENTE_FINANZAS.sql`
2. `04_UPDATE_SUPABASE_CLIENTE_EMAIL_AUTH.sql`

El archivo `04` no recrea tus tablas principales ni mete datos ficticios. Agrega:

- `clientes_portal`
- `email` y `cliente_user_id` en `solicitudes_prestamos`
- policies para separar cliente/admin
- funciones RPC que exigen sesión con correo
- cola `notificaciones_email`

## 2. Configurar Supabase Auth

En Supabase entra a:

`Authentication -> URL Configuration`

Agrega como Site URL:

```txt
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html
```

Y en Redirect URLs agrega:

```txt
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html#cuenta
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html#solicitar
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html#seguimiento
```

## 3. Activar acceso por correo

En Supabase entra a:

`Authentication -> Providers -> Email`

Activa Email provider. El cliente recibirá un enlace mágico para iniciar sesión sin contraseña.

## 4. Admin autorizado

El SQL deja autorizado este correo para el panel interno:

```txt
yrafael@acpagro.com
```

Si usas otro correo para entrar al panel, agrégalo con:

```sql
insert into public.admin_usuarios(email, activo)
values ('TU_CORREO_ADMIN@DOMINIO.COM', true)
on conflict (email) do update set activo = true;
```

## 5. Correos de alerta

Supabase Auth sí enviará el correo de registro/inicio de sesión.

Para alertas de estado, el sistema ahora guarda una cola en:

```txt
notificaciones_email
```

Cada vez que una solicitud se crea o cambia de estado, se registra un correo pendiente. Para envío automático real necesitas conectar una Supabase Edge Function con SMTP/Resend/SendGrid. Mientras tanto, el panel admin incluye botón para abrir el correo preparado con `mailto`.
