# PrestaControl — Guía de Configuración con Supabase

## PASO 1 — Crear proyecto en Supabase
1. Ve a https://supabase.com y crea una cuenta gratuita
2. Clic en "New project"
3. Pon un nombre (ej: prestacontrol), elige región más cercana (us-east o sa-east), define contraseña DB
4. Espera ~2 min a que se cree el proyecto

## PASO 2 — Ejecutar el Schema SQL
1. En tu proyecto Supabase ve a: **SQL Editor → New Query**
2. Copia y pega todo el contenido del archivo `supabase_schema.sql`
3. Clic en **Run** (botón verde)
4. Verifica que no haya errores

## PASO 3 — Crear usuarios en Supabase Auth
1. Ve a: **Authentication → Users → Add user**
2. Crea cada usuario con su email y contraseña:

| Email                        | Contraseña    | Nombre (metadata) |
|------------------------------|---------------|-------------------|
| admin@prestacontrol.com      | Admin2024!    | ADMIN             |
| lesly@prestacontrol.com      | Lesly2024!    | LESLY             |
| maria@prestacontrol.com      | Maria2024!    | MARIA             |
| yoni@prestacontrol.com       | Yoni2024!     | YONI              |

3. Para cada usuario, en "User Metadata" agrega:
   - admin: `{"name": "ADMIN", "role": "admin"}`
   - otros: `{"name": "LESLY", "role": "prestamista"}`

## PASO 4 — Obtener credenciales API
1. En Supabase ve a: **Settings → API**
2. Copia:
   - **Project URL** → ej: https://xyzxyzxyz.supabase.co
   - **anon public key** → empieza con eyJhbGci...

## PASO 5 — Configurar el app.js
Abre `app.js` y reemplaza las líneas 7-8:
```javascript
const SUPABASE_URL      = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...TU-ANON-KEY';
```

## PASO 6 — Habilitar Realtime (opcional pero recomendado)
1. Ve a: **Database → Replication**
2. Activa las tablas: `prestamos`, `pagos`, `prestamistas`

## PASO 7 — Subir a internet (hosting gratuito)

### Opción A: Netlify (recomendado, más fácil)
1. Ve a https://netlify.com
2. Crea cuenta gratuita
3. Arrastra la carpeta `prestamos` al área de deploy
4. ¡Listo! Te da una URL como: https://prestacontrol.netlify.app

### Opción B: Vercel
1. Ve a https://vercel.com
2. Importa desde GitHub o sube los archivos
3. Deploy automático

### Opción C: GitHub Pages
1. Sube los archivos a un repositorio GitHub
2. Settings → Pages → Deploy from branch main
3. URL: https://tuusuario.github.io/prestamos

## RESUMEN ARQUITECTURA
```
Browser (index.html + app.js)
        ↕ HTTPS
Supabase (PostgreSQL + Auth + Realtime)
  ├── prestamistas (tabla)
  ├── prestamos (tabla)  ← RLS: solo autenticados
  └── pagos (tabla)     ← RLS: solo autenticados
```

## SEGURIDAD IMPLEMENTADA
- ✅ Auth real con Supabase (bcrypt en servidor)
- ✅ Tokens JWT con auto-refresh
- ✅ Row Level Security (RLS) en todas las tablas
- ✅ Bloqueo por intentos fallidos (5 max, 15 min)
- ✅ Sesión persistente con expiración automática
- ✅ Realtime: cambios se sincronizan en todos los dispositivos
