# TuSocio Financiero - Portal cliente y finanzas

## 1. SQL que debes ejecutar

Ejecuta en Supabase SQL Editor este archivo:

```txt
03_UPDATE_SUPABASE_PORTAL_CLIENTE_FINANZAS.sql
```

Este update es incremental: no recrea `prestamos`, `pagos`, `prestamistas` ni `deudores`, y no inserta datos ficticios.

Agrega:

- Código público de solicitud: `TSF-AAAA-000001`.
- Seguimiento seguro por código + DNI.
- Historial de eventos de solicitud.
- Estados nuevos: `OBSERVADO`, `DESEMBOLSADO`, `FINALIZADO`.
- Funciones RPC públicas seguras:
  - `crear_solicitud_publica(...)`
  - `consultar_solicitud_publica(codigo, dni)`
- Pagos financieros por tipo:
  - `PARCIAL`
  - `INTERES`
  - `CAPITAL`
  - `CANCELACION`
  - `MORA`
- Extensión de plazo por pago de interés.

## 2. Link para clientes

Tu web pública para clientes queda en:

```txt
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html
```

Formulario directo:

```txt
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html#solicitar
```

Seguimiento directo:

```txt
https://yrafael-grifo.github.io/PrestamosOnline/cliente.html#seguimiento
```

## 3. Link del panel interno

Tu panel interno queda en:

```txt
https://yrafael-grifo.github.io/PrestamosOnline/index.html
```

El cliente no necesita entrar al panel interno.

## 4. Cómo funciona el seguimiento

Cuando el cliente envía su solicitud, el sistema devuelve un código como:

```txt
TSF-2026-000001
```

Para consultar, debe ingresar:

- código de solicitud
- DNI registrado

No se habilita lectura pública directa de la tabla `solicitudes_prestamos`. La consulta usa una función RPC con validación de código + DNI.

## 5. Pago de interés con extensión de plazo

En el panel interno, al registrar pago elige:

```txt
Pago de interés / renovación
```

Luego indica los meses que se extiende.

Ejemplo:

- Capital actual: S/ 1,000
- Interés mensual: 10%
- Cliente paga: S/ 100 de interés
- Extensión: 1 mes

Resultado:

- Capital actual sigue: S/ 1,000
- Se suma S/ 100 de interés nuevo
- La fecha de vencimiento se mueve 1 mes
- El saldo pendiente queda actualizado automáticamente

