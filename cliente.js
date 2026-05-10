/* TuSocio Financiero - portal publico de solicitudes y seguimiento */
const SUPABASE_URL = window.PRESTACONTROL_CONFIG?.SUPABASE_URL || 'https://dzemddtxlywwyarkgpng.supabase.co';
const SUPABASE_ANON_KEY = window.PRESTACONTROL_CONFIG?.SUPABASE_ANON_KEY || 'sb_publishable_N5Fm-nUMpxO_8ihhu163aw_pMhKDiiK';
const COMPANY_NAME = window.PRESTACONTROL_CONFIG?.COMPANY_NAME || 'TuSocio Financiero';
const COMPANY_SLOGAN = window.PRESTACONTROL_CONFIG?.COMPANY_SLOGAN || 'Tu respaldo cuando más lo necesitas.';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const $ = id => document.getElementById(id);
const normalizeName = v => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
const digits = v => String(v || '').replace(/\D/g, '');
const fmt = n => Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => d ? new Date(String(d).includes('T') ? d : d + 'T00:00:00').toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' }) : '—';

function toast(msg, type='') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}
function setLoading(btn, on, text) {
  btn.disabled = on;
  btn.textContent = on ? 'Procesando...' : text;
}
function copyCode(value) {
  navigator.clipboard?.writeText(value).then(() => toast('Copiado', 'success')).catch(() => prompt('Copia este dato:', value));
}
function trackingLink(code, dni) {
  const url = new URL(window.location.href.split('#')[0]);
  url.hash = 'seguimiento';
  if (code) url.searchParams.set('codigo', code);
  if (dni) url.searchParams.set('dni', dni);
  return url.href;
}

async function submitPublicRequest(event) {
  event.preventDefault();
  const err = $('requestError');
  err.classList.add('hidden');
  const dni = digits($('dni').value);
  const phone = digits($('phone').value);
  const payload = {
    p_nombre_completo: normalizeName($('fullName').value),
    p_dni: dni,
    p_telefono: phone,
    p_direccion: $('address').value.trim() || null,
    p_monto_solicitado: Number($('amount').value || 0),
    p_plazo_meses: Number($('months').value || 0),
    p_ocupacion: $('job').value.trim() || null,
    p_ingresos_mensuales: $('income').value ? Number($('income').value) : null,
    p_motivo: $('purpose').value.trim() || null,
    p_referencia_nombre: $('refName').value.trim() || null,
    p_referencia_telefono: digits($('refPhone').value) || null
  };
  if (!payload.p_nombre_completo || dni.length < 8 || phone.length < 9 || payload.p_monto_solicitado <= 0 || payload.p_plazo_meses <= 0) {
    err.textContent = 'Completa correctamente nombre, DNI, teléfono, monto y plazo.';
    err.classList.remove('hidden');
    return;
  }
  const btn = $('btnSendRequest');
  setLoading(btn, true, 'Enviar solicitud');
  try {
    const { data, error } = await sb.rpc('crear_solicitud_publica', payload);
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'No se pudo registrar la solicitud');
    const code = data.codigo_solicitud;
    const link = trackingLink(code, dni);
    $('requestResult').innerHTML = `
      <div class="success-icon">✅</div>
      <h3>Solicitud registrada</h3>
      <p>Guarda este código. Lo necesitarás para consultar el seguimiento junto con tu DNI.</p>
      <div class="code-box"><span>${code}</span><button type="button" onclick="copyCode('${code}')">Copiar código</button></div>
      <div class="result-actions">
        <button class="btn-secondary" type="button" onclick="copyCode('${link}')">Copiar link de seguimiento</button>
        <a class="btn-primary" href="${link}">Consultar ahora</a>
      </div>`;
    $('requestResult').classList.remove('hidden');
    $('publicRequestForm').reset();
    $('trackCode').value = code;
    $('trackDni').value = dni;
    location.hash = 'seguimiento';
  } catch (ex) {
    err.textContent = 'No se pudo enviar la solicitud: ' + ex.message;
    err.classList.remove('hidden');
  } finally {
    setLoading(btn, false, 'Enviar solicitud');
  }
}

async function trackRequest(event) {
  event?.preventDefault();
  const code = $('trackCode').value.trim().toUpperCase();
  const dni = digits($('trackDni').value);
  const err = $('trackError');
  const result = $('trackResult');
  err.classList.add('hidden');
  result.classList.add('hidden');
  if (!code || dni.length < 8) {
    err.textContent = 'Ingresa tu código de solicitud y DNI.';
    err.classList.remove('hidden');
    return;
  }
  const btn = $('btnTrack');
  setLoading(btn, true, 'Consultar estado');
  try {
    const { data, error } = await sb.rpc('consultar_solicitud_publica', { p_codigo: code, p_dni: dni });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'No encontramos una solicitud con esos datos.');
    renderTracking(data);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally {
    setLoading(btn, false, 'Consultar estado');
  }
}

function renderTracking(data) {
  const s = data.solicitud || {};
  const loan = data.prestamo || null;
  const payments = Array.isArray(data.pagos) ? data.pagos : [];
  const events = Array.isArray(data.eventos) ? data.eventos : [];
  const result = $('trackResult');
  result.innerHTML = `
    <div class="tracking-head">
      <div><span>Código</span><strong>${s.codigo_solicitud || '—'}</strong></div>
      <div><span>Estado</span><strong class="pill ${s.estado || ''}">${statusLabel(s.estado)}</strong></div>
      <div><span>Solicitante</span><strong>${s.nombre_completo || '—'}</strong></div>
      <div><span>Monto solicitado</span><strong>S/ ${fmt(s.monto_solicitado)}</strong></div>
    </div>
    ${s.notas_revision ? `<div class="notice"><strong>Observación:</strong> ${s.notas_revision}</div>` : ''}
    ${loan ? renderLoanSummary(loan, payments) : ''}
    <h3>Historial de seguimiento</h3>
    <div class="timeline">
      ${events.length ? events.map(e => `<div class="timeline-item"><span></span><div><strong>${statusLabel(e.estado)}</strong><p>${e.comentario || e.titulo || ''}</p><small>${fmtDate(e.created_at)}</small></div></div>`).join('') : '<p>Aún no hay eventos registrados.</p>'}
    </div>`;
  result.classList.remove('hidden');
}

function renderLoanSummary(loan, payments) {
  return `<div class="loan-summary">
    <h3>Préstamo asociado</h3>
    <div class="summary-grid">
      <div><span>Capital</span><strong>S/ ${fmt(loan.monto)}</strong></div>
      <div><span>Total a pagar</span><strong>S/ ${fmt(loan.total_pagar)}</strong></div>
      <div><span>Pagado</span><strong>S/ ${fmt(loan.monto_pagado)}</strong></div>
      <div><span>Saldo pendiente</span><strong>S/ ${fmt(loan.monto_pendiente)}</strong></div>
      <div><span>Vencimiento</span><strong>${fmtDate(loan.fecha_vencimiento)}</strong></div>
      <div><span>Estado préstamo</span><strong>${loan.estado || '—'}</strong></div>
    </div>
    <h4>Pagos registrados</h4>
    ${payments.length ? `<div class="payments-list">${payments.map(p => `<div><span>${fmtDate(p.fecha_pago)} · ${p.tipo_pago || 'PAGO'}</span><strong>S/ ${fmt(p.monto)}</strong></div>`).join('')}</div>` : '<p class="muted">Todavía no tienes pagos registrados.</p>'}
  </div>`;
}
function statusLabel(status) {
  return String(status || 'PENDIENTE').replace(/_/g, ' ');
}

window.addEventListener('DOMContentLoaded', () => {
  document.title = `${COMPANY_NAME} — Solicita tu préstamo`;
  document.querySelectorAll('.brand-name').forEach(el => el.textContent = COMPANY_NAME);
  document.querySelectorAll('.brand-slogan').forEach(el => el.textContent = COMPANY_SLOGAN);
  const params = new URLSearchParams(location.search);
  const code = params.get('codigo');
  const dni = params.get('dni');
  if (code) $('trackCode').value = code.toUpperCase();
  if (dni) $('trackDni').value = dni;
  if (location.hash === '#seguimiento' && code && dni) trackRequest();
});
