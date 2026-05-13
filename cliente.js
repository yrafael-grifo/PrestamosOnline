/* TuSocio Financiero - portal publico de solicitudes y seguimiento */

const SUPABASE_URL =
  window.PRESTACONTROL_CONFIG?.SUPABASE_URL ||
  'https://dzemddtxlywwyarkgpng.supabase.co';

const SUPABASE_ANON_KEY =
  window.PRESTACONTROL_CONFIG?.SUPABASE_ANON_KEY ||
  'sb_publishable_N5Fm-nUMpxO_8ihhu163aw_pMhKDiiK';

const COMPANY_NAME =
  window.PRESTACONTROL_CONFIG?.COMPANY_NAME ||
  'TuSocio Financiero';

const COMPANY_SLOGAN =
  window.PRESTACONTROL_CONFIG?.COMPANY_SLOGAN ||
  'Tu respaldo cuando más lo necesitas.';

const CLIENTE_URL =
  'https://yrafael-grifo.github.io/PrestamosOnline/cliente.html';

const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  }
);

let currentSession = null;

const $ = id =>document.getElementById(id);

const normalizeName = v =>
  String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const digits = v =>
  String(v || '').replace(/\D/g, '');

const fmt = n =>
  Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const fmtDate = d =>
  d
    ? new Date(
        String(d).includes('T') ? d : d + 'T00:00:00'
      ).toLocaleDateString('es-PE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    : '—';

let themeRefreshTimer = null;
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 6;

function isNightTime(now = new Date()) {
  const hour = now.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getAdaptiveTheme() {
  const systemTheme = getSystemTheme();
  if (systemTheme === 'dark') return 'dark';
  return isNightTime() ? 'dark' : 'light';
}

function updateThemeLogos(mode) {
  document.querySelectorAll('[data-logo-light][data-logo-dark]').forEach(img => {
    img.src = mode === 'dark' ? img.dataset.logoDark : img.dataset.logoLight;
  });
}

function applyAdaptiveTheme() {
  const mode = getAdaptiveTheme();
  const source = getSystemTheme() === 'dark' ? 'system' : (isNightTime() ? 'time' : 'system');
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.setAttribute('data-theme-source', source);
  document.documentElement.style.colorScheme = mode;
  updateThemeLogos(mode);
  return mode;
}

function msUntilNextThemeBoundary(now = new Date()) {
  const next = new Date(now);
  const hour = now.getHours();
  if (hour < NIGHT_END_HOUR) {
    next.setHours(NIGHT_END_HOUR, 0, 1, 0);
  } else if (hour < NIGHT_START_HOUR) {
    next.setHours(NIGHT_START_HOUR, 0, 1, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(NIGHT_END_HOUR, 0, 1, 0);
  }
  return Math.max(60000, next.getTime() - now.getTime());
}

function scheduleAdaptiveThemeRefresh() {
  if (themeRefreshTimer) clearTimeout(themeRefreshTimer);
  themeRefreshTimer = setTimeout(() => {
    applyAdaptiveTheme();
    scheduleAdaptiveThemeRefresh();
  }, msUntilNextThemeBoundary());
}

function initAdaptiveTheme() {
  applyAdaptiveTheme();
  scheduleAdaptiveThemeRefresh();
  const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const refreshTheme = () => {
    applyAdaptiveTheme();
    scheduleAdaptiveThemeRefresh();
  };
  if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', refreshTheme);
  else if (systemThemeQuery?.addListener) systemThemeQuery.addListener(refreshTheme);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshTheme();
  });
}

function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;

  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.remove('hidden');

  setTimeout(() =>{
    el.classList.add('hidden');
  }, 3500);
}

function setLoading(btn, on, text) {
  if (!btn) return;

  btn.disabled = on;
  btn.textContent = on ? 'Procesando...' : text;
}

function copyCode(value) {
  navigator.clipboard
    ?.writeText(value)
    .then(() =>toast('Copiado', 'success'))
    .catch(() =>prompt('Copia este dato:', value));
}

async function initAuthSession() {
  const { data, error } = await sb.auth.getSession();

  if (error) {
    console.error('Error leyendo sesión:', error);
    currentSession = null;
    updateAuthUI();
    return;
  }

  currentSession = data?.session || null;
  updateAuthUI();

  if (currentSession && location.hash === '#cuenta') {
    location.hash = '#solicitar';
  }
}

async function refreshClientSession() {
  const { data, error } = await sb.auth.getSession();

  if (error) {
    console.error('Error refrescando sesión:', error);
    currentSession = null;
  } else {
    currentSession = data?.session || null;
  }

  updateAuthUI();
}

function clientEmail() {
  return currentSession?.user?.email || '';
}

function updateAuthUI() {
  const logged = !!currentSession;
  const email = clientEmail();

  [
    'authLoggedOut',
    'loginRequiredRequest',
    'loginRequiredTrack'
  ].forEach(id =>{
    const el = $(id);
    if (el) el.classList.toggle('hidden', logged);
  });

  [
    'authLoggedIn',
    'publicRequestForm',
    'trackForm'
  ].forEach(id =>{
    const el = $(id);
    if (el) el.classList.toggle('hidden', !logged);
  });

  [
    'sessionEmail',
    'requestSessionEmail',
    'trackSessionEmail'
  ].forEach(id =>{
    const el = $(id);
    if (el) el.textContent = email || '—';
  });
}

function authError(message, type = 'error') {
  const err = $('authError');
  if (!err) return;
  err.textContent = message;
  err.classList.remove('hidden', 'info-box', 'error-box');
  err.classList.add(type === 'success' || type === 'info' ? 'info-box' : 'error-box');
}

function readAuthFields() {
  return {
    email: ($('clientEmail')?.value || '').trim().toLowerCase(),
    password: $('clientPassword')?.value || ''
  };
}

function validateEmailPassword(email, password, requirePassword = true) {
  if (!email || !email.includes('@')) return 'Ingresa un correo válido.';
  if (requirePassword && password.length < 6) return 'La contraseña debe tener mínimo 6 caracteres.';
  return '';
}

async function registerClient() {
  $('authError')?.classList.add('hidden');
  const { email, password } = readAuthFields();
  const validation = validateEmailPassword(email, password, true);
  if (validation) return authError(validation);

  const btn = $('btnRegister');
  setLoading(btn, true, 'Crear cuenta');

  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: CLIENTE_URL + '#solicitar',
        data: { tipo_usuario: 'cliente' }
      }
    });

    if (error) throw error;

    if (data?.session) {
      currentSession = data.session;
      updateAuthUI();
      toast('Cuenta creada correctamente.', 'success');
      location.hash = '#solicitar';
      return;
    }

    authError('Cuenta creada. Revisa tu correo para confirmar tu cuenta y luego inicia sesión.', 'info');
    toast('Cuenta creada. Confirma tu correo.', 'success');
  } catch (ex) {
    authError('No se pudo crear la cuenta: ' + ex.message);
  } finally {
    setLoading(btn, false, 'Crear cuenta');
  }
}

async function loginClient() {
  $('authError')?.classList.add('hidden');
  const { email, password } = readAuthFields();
  const validation = validateEmailPassword(email, password, true);
  if (validation) return authError(validation);

  const btn = $('btnLogin');
  setLoading(btn, true, 'Iniciar sesión');

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    currentSession = data?.session || null;
    updateAuthUI();
    toast('Sesión iniciada.', 'success');
    location.hash = '#solicitar';
  } catch (ex) {
    authError('No se pudo iniciar sesión: ' + ex.message);
  } finally {
    setLoading(btn, false, 'Iniciar sesión');
  }
}

async function recoverClientPassword() {
  $('authError')?.classList.add('hidden');
  const email = ($('clientEmail')?.value || '').trim().toLowerCase();
  const validation = validateEmailPassword(email, '', false);
  if (validation) return authError(validation);

  const btn = $('btnRecover');
  setLoading(btn, true, 'Recuperar contraseña');

  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: CLIENTE_URL.replace('cliente.html', 'reset.html')
    });
    if (error) throw error;

    authError('Te enviamos un correo para crear una nueva contraseña.', 'info');
    toast('Revisa tu correo.', 'success');
  } catch (ex) {
    authError('No se pudo enviar recuperación: ' + ex.message);
  } finally {
    setLoading(btn, false, 'Olvidé mi contraseña');
  }
}

async function clientLogout() {
  await sb.auth.signOut();

  currentSession = null;
  updateAuthUI();

  toast('Sesión cerrada');
  location.hash = 'cuenta';
}

function trackingLink(code, dni) {
  const url = new URL(CLIENTE_URL);

  url.hash = 'seguimiento';

  if (code) url.searchParams.set('codigo', code);
  if (dni) url.searchParams.set('dni', dni);

  return url.href;
}

async function submitPublicRequest(event) {
  event.preventDefault();

  const err = $('requestError');
  err?.classList.add('hidden');

  const dni = digits($('dni')?.value);
  const phone = digits($('phone')?.value);

  if (!currentSession) {
    location.hash = 'cuenta';
    toast('Primero valida tu correo.', 'error');
    return;
  }

  const payload = {
    p_user_id: currentSession.user.id,
    p_email: clientEmail(),
    p_nombre_completo: normalizeName($('fullName')?.value),
    p_dni: dni,
    p_telefono: phone,
    p_direccion: $('address')?.value.trim() || null,
    p_monto_solicitado: Number($('amount')?.value || 0),
    p_plazo_meses: Number($('months')?.value || 0),
    p_ocupacion: $('job')?.value.trim() || null,
    p_ingresos_mensuales: $('income')?.value
      ? Number($('income')?.value)
      : null,
    p_motivo: $('purpose')?.value.trim() || null,
    p_referencia_nombre: $('refName')?.value.trim() || null,
    p_referencia_telefono:
      digits($('refPhone')?.value) || null
  };

  if (
    !payload.p_nombre_completo ||
    dni.length < 8 ||
    phone.length < 9 ||
    payload.p_monto_solicitado <= 0 ||
    payload.p_plazo_meses <= 0
  ) {
    if (err) {
      err.textContent =
        'Completa correctamente nombre, DNI, teléfono, monto y plazo.';
      err.classList.remove('hidden');
    }
    return;
  }

  const btn = $('btnSendRequest');
  setLoading(btn, true, 'Enviar solicitud');

  try {
    const { data, error } =
      await sb.rpc('crear_solicitud_publica', payload);

    if (error) throw error;

    if (!data?.ok) {
      throw new Error(
        data?.error || 'No se pudo registrar la solicitud'
      );
    }

    const code = data.codigo_solicitud;
    const link = trackingLink(code, dni);

    $('requestResult').innerHTML = `
      <div class="success-icon"></div>
      <h3>Solicitud registrada</h3>
      <p>Guarda este código. Lo necesitarás para consultar el seguimiento junto con tu DNI.</p>
      <div class="code-box">
        <span>${code}</span>
        <button type="button" onclick="copyCode('${code}')">Copiar código</button>
      </div>
      <div class="result-actions">
        <button class="btn-secondary" type="button" onclick="copyCode('${link}')">
          Copiar link de seguimiento
       </button>
        <a class="btn-primary" href="${link}">
          Consultar ahora
        </a>
      </div>
    `;

    $('requestResult').classList.remove('hidden');
    $('publicRequestForm').reset();

    if ($('trackCode')) $('trackCode').value = code;
    if ($('trackDni')) $('trackDni').value = dni;

    location.hash = 'seguimiento';
  } catch (ex) {
    if (err) {
      err.textContent =
        'No se pudo enviar la solicitud: ' + ex.message;
      err.classList.remove('hidden');
    }
  } finally {
    setLoading(btn, false, 'Enviar solicitud');
  }
}

async function trackRequest(event) {
  event?.preventDefault();

  if (!currentSession) {
    location.hash = 'cuenta';
    toast(
      'Primero inicia sesión con tu correo.',
      'error'
    );
    return;
  }

  const code =
    $('trackCode')?.value.trim().toUpperCase();

  const dni =
    digits($('trackDni')?.value);

  const err = $('trackError');
  const result = $('trackResult');

  err?.classList.add('hidden');
  result?.classList.add('hidden');

  if (!code || dni.length < 8) {
    if (err) {
      err.textContent =
        'Ingresa tu código de solicitud y DNI.';
      err.classList.remove('hidden');
    }
    return;
  }

  const btn = $('btnTrack');
  setLoading(btn, true, 'Consultar estado');

  try {
    const { data, error } =
      await sb.rpc('consultar_solicitud_publica', {
        p_codigo: code,
        p_dni: dni,
        p_email: clientEmail()
      });

    if (error) throw error;

    if (!data?.ok) {
      throw new Error(
        data?.error ||
        'No encontramos una solicitud con esos datos.'
      );
    }

    renderTracking(data);
  } catch (ex) {
    if (err) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  } finally {
    setLoading(btn, false, 'Consultar estado');
  }
}

function renderTracking(data) {
  const s = data.solicitud || {};
  const loan = data.prestamo || null;
  const payments = Array.isArray(data.pagos)
    ? data.pagos
    : [];

  const events = Array.isArray(data.eventos)
    ? data.eventos
    : [];

  const result = $('trackResult');

  if (!result) return;

  result.innerHTML = `
    <div class="tracking-head">
      <div>
        <span>Código</span>
        <strong>${s.codigo_solicitud || '—'}</strong>
      </div>
      <div>
        <span>Estado</span>
        <strong class="pill ${s.estado || ''}">
          ${statusLabel(s.estado)}
        </strong>
      </div>
      <div>
        <span>Solicitante</span>
        <strong>${s.nombre_completo || '—'}</strong>
      </div>
      <div>
        <span>Monto solicitado</span>
        <strong>S/ ${fmt(s.monto_solicitado)}</strong>
      </div>
    </div>

    ${
      s.notas_revision
        ? `<div class="notice">
            <strong>Observación:</strong>${s.notas_revision}
          </div>`
        : ''
    }

    ${loan ? renderLoanSummary(loan, payments) : ''}

    <h3>Historial de seguimiento</h3>

    <div class="timeline">
      ${
        events.length
          ? events
              .map(
                e =>`
                  <div class="timeline-item">
                    <span></span>
                    <div>
                      <strong>${statusLabel(e.estado)}</strong>
                      <p>${e.comentario || e.titulo || ''}</p>
                      <small>${fmtDate(e.created_at)}</small>
                    </div>
                  </div>
                `
              )
              .join('')
          : '<p>Aún no hay eventos registrados.</p>'
      }
    </div>
  `;

  result.classList.remove('hidden');
}

function renderLoanSummary(loan, payments) {
  return `
    <div class="loan-summary">
      <h3>Préstamo asociado</h3>

      <div class="summary-grid">
        <div>
          <span>Capital</span>
          <strong>S/ ${fmt(loan.monto)}</strong>
        </div>
        <div>
          <span>Total a pagar</span>
          <strong>S/ ${fmt(loan.total_pagar)}</strong>
        </div>
        <div>
          <span>Pagado</span>
          <strong>S/ ${fmt(loan.monto_pagado)}</strong>
        </div>
        <div>
          <span>Saldo pendiente</span>
          <strong>S/ ${fmt(loan.monto_pendiente)}</strong>
        </div>
        <div>
          <span>Vencimiento</span>
          <strong>${fmtDate(loan.fecha_vencimiento)}</strong>
        </div>
        <div>
          <span>Estado préstamo</span>
          <strong>${loan.estado || '—'}</strong>
        </div>
      </div>

      <h4>Pagos registrados</h4>

      ${
        payments.length
          ? `<div class="payments-list">
              ${payments
                .map(
                  p =>`
                    <div>
                      <span>
                        ${fmtDate(p.fecha_pago)} · ${p.tipo_pago || 'PAGO'}
                      </span>
                      <strong>S/ ${fmt(p.monto)}</strong>
                    </div>
                  `
                )
                .join('')}
            </div>`
          : '<p class="muted">Todavía no tienes pagos registrados.</p>'
      }
    </div>
  `;
}

function statusLabel(status) {
  return String(status || 'PENDIENTE')
    .replace(/_/g, ' ');
}

window.addEventListener('DOMContentLoaded', async () =>{
  document.title =
    `${COMPANY_NAME} — Solicita tu préstamo`;

  document
    .querySelectorAll('.brand-name')
    .forEach(el =>{
      el.textContent = COMPANY_NAME;
    });

  document
    .querySelectorAll('.brand-slogan')
    .forEach(el =>{
      el.textContent = COMPANY_SLOGAN;
    });

  updateThemeLogos(document.documentElement.getAttribute('data-theme') || getAdaptiveTheme());

  const params = new URLSearchParams(location.search);

  const code = params.get('codigo');
  const dni = params.get('dni');

  if (code && $('trackCode')) {
    $('trackCode').value = code.toUpperCase();
  }

  if (dni && $('trackDni')) {
    $('trackDni').value = dni;
  }

  await initAuthSession();

  sb.auth.onAuthStateChange(
    async (event, session) =>{
      currentSession = session || null;
      updateAuthUI();

      if (session && location.hash === '#cuenta') {
        location.hash = '#solicitar';
      }

      if (
        session &&
        location.hash === '#seguimiento' &&
        $('trackCode')?.value &&
        $('trackDni')?.value
      ) {
        trackRequest();
      }
    }
  );

  if (
    !currentSession &&
    (
      location.hash === '#solicitar' ||
      location.hash === '#seguimiento'
    )
  ) {
    setTimeout(() =>{
      location.hash = 'cuenta';
    }, 300);
  }

  if (
    currentSession &&
    location.hash === '#seguimiento' &&
    code &&
    dni
  ) {
    trackRequest();
  }
});
