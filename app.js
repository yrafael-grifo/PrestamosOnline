/* =============================================
   TuSocio Financiero — App con Supabase
   ============================================= */

// ─── CONFIGURACIÓN SUPABASE ────────────────────
// REEMPLAZA con tus credenciales reales de Supabase
const SUPABASE_URL = window.PRESTACONTROL_CONFIG?.SUPABASE_URL || 'https://dzemddtxlywwyarkgpng.supabase.co';
const SUPABASE_ANON_KEY = window.PRESTACONTROL_CONFIG?.SUPABASE_ANON_KEY || 'sb_publishable_N5Fm-nUMpxO_8ihhu163aw_pMhKDiiK';

// ─── CLIENTE SUPABASE ─────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

// ─── ESTADO GLOBAL ────────────────────────────
let currentUser    = null;
let loans          = [];
let lenders        = [];
let debtors        = [];
let loanRequests   = [];
let notifTimer     = null;
let realtimeChannel = null;
const DEFAULT_INTEREST_RATE = 20;
const COMPANY_NAME = window.PRESTACONTROL_CONFIG?.COMPANY_NAME || 'TuSocio Financiero';
const COMPANY_SLOGAN = window.PRESTACONTROL_CONFIG?.COMPANY_SLOGAN || 'Tu respaldo cuando más lo necesitas.';
const normalizeText = v =>(v || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');

// ─── ANTI-FUERZA BRUTA (client-side) ──────────
const MAX_ATTEMPTS   = 5;
const LOCK_DURATION  = 15 * 60 * 1000;

function checkBruteForce(email) {
  const lockUntil = parseInt(localStorage.getItem(`pc_lock_${email}`) || '0');
  if (Date.now() < lockUntil) {
    return { locked: true, mins: Math.ceil((lockUntil - Date.now()) / 60000) };
  }
  return { locked: false, attempts: parseInt(localStorage.getItem(`pc_att_${email}`) || '0') };
}
function recordFailedAttempt(email) {
  let att = parseInt(localStorage.getItem(`pc_att_${email}`) || '0') + 1;
  localStorage.setItem(`pc_att_${email}`, att);
  if (att >= MAX_ATTEMPTS) { localStorage.setItem(`pc_lock_${email}`, Date.now() + LOCK_DURATION); return { locked: true }; }
  return { locked: false, remaining: MAX_ATTEMPTS - att };
}
function clearAttempts(email) {
  localStorage.removeItem(`pc_att_${email}`);
  localStorage.removeItem(`pc_lock_${email}`);
}

// ─── AUTH ─────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPass').value;
  const lockEl = document.getElementById('lockMsg');
  const errEl  = document.getElementById('loginError');
  lockEl.classList.add('hidden');
  errEl.classList.add('hidden');

  const bf = checkBruteForce(email);
  if (bf.locked) { lockEl.textContent = ` Cuenta bloqueada. Intenta en ${bf.mins} min.`; lockEl.classList.remove('hidden'); return; }

  setLoginLoading(true);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  setLoginLoading(false);

  if (error) {
    document.getElementById('loginPass').value = '';
    const res = recordFailedAttempt(email);
    if (res.locked) { lockEl.textContent = ' Demasiados intentos. Bloqueado 15 min.'; lockEl.classList.remove('hidden'); }
    else { errEl.textContent = ` Credenciales incorrectas. Intentos restantes: ${res.remaining}`; errEl.classList.remove('hidden'); }
    return;
  }
  clearAttempts(email);
  currentUser = {
    id:    data.user.id,
    email: data.user.email,
    name:  data.user.user_metadata?.name || email.split('@')[0].toUpperCase(),
    role:  data.user.user_metadata?.role || 'prestamista'
  };
  await startApp();
}

async function logout() {
  clearInterval(notifTimer);
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  await sb.auth.signOut();
  loans = []; lenders = []; debtors = []; loanRequests = []; currentUser = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('requestScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

function togglePass() {
  const i = document.getElementById('loginPass');
  i.type = i.type === 'password' ? 'text' : 'password';
}

function setLoginLoading(on) {
  const btn = document.getElementById('btnLogin');
  btn.innerHTML = on ? '<span class="spinner-sm"></span>Ingresando...' : '<span>Ingresar</span><span class="btn-arrow">→</span>';
  btn.disabled = on;
}

// ─── APP INIT ─────────────────────────────────
async function startApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('requestScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('navUsername').textContent = currentUser.name;
  document.getElementById('navAvatar').textContent   = currentUser.name[0].toUpperCase();

  showPageLoader('Cargando datos...');
  await loadAll();
  hidePageLoader();

  applyBranding();
  renderDashboard();
  renderRequests();
  renderLenders();
  populateLenderDropdowns();
  populateDebtorDatalist();
  renderDebtors();
  checkNotifications();
  notifTimer = setInterval(checkNotifications, 60 * 1000);
  setDateDefaults();
  subscribeRealtime();
}

// ─── LOADER OVERLAY ───────────────────────────
function showPageLoader(msg) {
  let el = document.getElementById('pageLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pageLoader';
    el.className = 'page-loader';
    document.getElementById('app').appendChild(el);
  }
  el.innerHTML = `<div class="page-loader-inner"><div class="loader-ring"></div><p>${msg}</p></div>`;
  el.classList.remove('hidden');
}
function hidePageLoader() {
  const el = document.getElementById('pageLoader');
  if (el) el.classList.add('hidden');
}

// ─── CAPA DE DATOS SUPABASE ───────────────────
async function loadAll() {
  const [r1, r2, r3, r4] = await Promise.all([
    fetchLoansQuery(),
    sb.from('prestamistas').select('*').order('nombre'),
    sb.from('deudores').select('*').order('nombre'),
    fetchLoanRequestsQuery()
  ]);
  if (r1.error) { toast('Error DB: ' + r1.error.message, 'error'); return; }
  if (r2.error) { toast('Error DB: ' + r2.error.message, 'error'); return; }
  if (r3.error) { console.warn('Tabla deudores pendiente:', r3.error.message); }
  if (r4.error) { console.warn('Tabla solicitudes_prestamos pendiente:', r4.error.message); }
  loans   = (r1.data || []).map(mapLoan);
  lenders = (r2.data || []).map(l =>({ id: l.id, name: l.nombre }));
  debtors = (r3.data || []).map(d =>({ id: d.id, name: d.nombre, phone: d.telefono || '', dni: d.dni || '', address: d.direccion || '', notes: d.notas || '' }));
  loanRequests = (r4.data || []).map(mapLoanRequest);
  updateRequestBadge();
}

async function fetchLoansQuery() {
  let res = await sb.from('prestamos')
    .select('*, pagos(*), deudores(*), prestamistas(*)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (res.error) {
    res = await sb.from('prestamos').select('*, pagos(*)').order('created_at', { ascending: false });
  }
  return res;
}

async function loadLoans() {
  const { data, error } = await fetchLoansQuery();
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  loans = (data || []).filter(r =>!r.deleted_at).map(mapLoan);
}

async function loadLenders() {
  const { data, error } = await sb.from('prestamistas').select('*').order('nombre');
  if (error) return;
  lenders = (data || []).map(l =>({ id: l.id, name: l.nombre }));
}

async function loadDebtors() {
  const { data, error } = await sb.from('deudores').select('*').order('nombre');
  if (error) { console.warn('Tabla deudores pendiente:', error.message); return; }
  debtors = (data || []).map(d =>({ id: d.id, name: d.nombre, phone: d.telefono || '', dni: d.dni || '', address: d.direccion || '', notes: d.notas || '' }));
}

async function fetchLoanRequestsQuery() {
  return sb.from('solicitudes_prestamos')
    .select('*')
    .order('created_at', { ascending: false });
}

async function loadLoanRequests() {
  const { data, error } = await fetchLoanRequestsQuery();
  if (error) { console.warn('No se pudieron cargar solicitudes:', error.message); return; }
  loanRequests = (data || []).map(mapLoanRequest);
  updateRequestBadge();
}

function mapLoanRequest(row) {
  return {
    id: row.id,
    code: row.codigo_solicitud || '',
    fullName: row.nombre_completo || '',
    dni: row.dni || '',
    phone: row.telefono || '',
    email: row.email || '',
    address: row.direccion || '',
    amount: +row.monto_solicitado || 0,
    months: row.plazo_meses || null,
    income: row.ingresos_mensuales != null ? +row.ingresos_mensuales : null,
    job: row.ocupacion || '',
    purpose: row.motivo || '',
    refName: row.referencia_nombre || '',
    refPhone: row.referencia_telefono || '',
    status: row.estado || 'PENDIENTE',
    reviewNotes: row.notas_revision || '',
    approvedAmount: row.monto_aprobado != null ? +row.monto_aprobado : null,
    approvedMonths: row.plazo_aprobado_meses || null,
    approvedRate: row.interes_mensual_aprobado != null ? +row.interes_mensual_aprobado : null,
    loanId: row.prestamo_id || null,
    createdAt: row.created_at,
    reviewedAt: row.revisado_en || row.aprobado_en || null
  };
}

function mapLoan(row) {
  return {
    id:            row.id,
    lenderId:      row.prestamista_id || null,
    debtorId:      row.deudor_id || null,
    lender:        row.prestamistas?.nombre || row.prestamista,
    debtor:        row.deudores?.nombre || row.deudor,
    loanDate:      row.fecha_prestamo,
    amount:        +row.monto,
    months:        row.meses,
    totalInterest: +row.interes_total,
    totalDue:      +row.total_pagar,
    dueDate:       row.fecha_vencimiento,
    paidAmount:    +row.monto_pagado,
    pendingAmount: +row.monto_pendiente,
    status:        row.estado,
    notes:         row.notas || '',
    debtorPhone:   row.deudores?.telefono || '',
    interestRate:  +(row.interes_mensual ?? 0.20),
    capitalOriginal: +(row.capital_original ?? row.monto ?? 0),
    capitalCurrent:  +(row.capital_actual ?? row.monto ?? 0),
    originalMonths:  +(row.meses_originales ?? row.meses ?? 0),
    extendedMonths:  +(row.meses_extension ?? 0),
    accumulatedInterest: +(row.interes_acumulado ?? row.interes_total ?? 0),
    payments:      (row.pagos || []).sort((a,b) =>new Date(a.created_at)-new Date(b.created_at)).map(p =>({
      id:     p.id,
      amount: +p.monto,
      date:   p.fecha_pago,
      note:   p.nota || '',
      type:   p.tipo_pago || 'PARCIAL',
      capitalPaid: +(p.capital_pagado || 0),
      interestPaid: +(p.interes_pagado || 0),
      moraPaid: +(p.mora_pagada || 0),
      extensionMonths: +(p.meses_extension || 0),
      extensionInterest: +(p.interes_generado_extension || 0)
    })),
    createdAt: row.created_at
  };
}

async function dbInsertLoan(d) {
  const dueDate = new Date(d.loanDate + 'T00:00:00');
  dueDate.setMonth(dueDate.getMonth() + d.months);
  const rate = (Number(d.interestRate || DEFAULT_INTEREST_RATE) / 100);
  const interest = d.amount * rate * d.months;
  const total = d.amount + interest;
  const lender = lenders.find(x =>x.name === normalizeText(d.lender));
  const debtor = debtors.find(x =>x.name === normalizeText(d.debtor));
  const payload = {
    prestamista:       normalizeText(d.lender),
    deudor:            normalizeText(d.debtor),
    prestamista_id:    lender?.id || null,
    deudor_id:         debtor?.id || null,
    fecha_prestamo:    d.loanDate,
    monto:             d.amount,
    meses:             d.months,
    interes_mensual:   rate,
    interes_total:     interest,
    total_pagar:       total,
    fecha_vencimiento: dueDate.toISOString().split('T')[0],
    monto_pagado:      0,
    monto_pendiente:   total,
    estado:            'ACTIVO',
    notas:             d.notes || '',
    created_by:        currentUser.id
  };
  let { data, error } = await sb.from('prestamos').insert(payload).select().single();
  if (error && /prestamista_id|deudor_id|interes_mensual/i.test(error.message)) {
    delete payload.prestamista_id; delete payload.deudor_id; delete payload.interes_mensual;
    ({ data, error } = await sb.from('prestamos').insert(payload).select().single());
  }
  if (error) throw error;
  await logAction('CREÓ PRÉSTAMO', data.id, `${payload.deudor} / S/ ${fmt(total)}`);
  return data;
}

async function dbPayment(loanId, amount, date, note, type='PARCIAL', extensionMonths=0) {
  const payload = {
    p_prestamo_id: loanId,
    p_monto:       amount,
    p_fecha:       date,
    p_tipo_pago:   type || 'PARCIAL',
    p_meses_extension: Number(extensionMonths || 0),
    p_nota:        note || '',
    p_user_id:     currentUser.id
  };

  let { data, error } = await sb.rpc('registrar_pago_financiero', payload);
  if (error) {
    // Compatibilidad: si aun no ejecutaste el SQL nuevo, al menos permite pagos normales sin extension.
    if (/registrar_pago_financiero|function/i.test(error.message) && (!extensionMonths || type === 'PARCIAL')) {
      ({ data, error } = await sb.rpc('registrar_pago', {
        p_prestamo_id: loanId,
        p_monto:       amount,
        p_fecha:       date,
        p_nota:        note || '',
        p_user_id:     currentUser.id
      }));
    }
  }
  if (error) throw error;
  if (data && !data.ok) throw new Error(data.error || 'No se pudo registrar el pago');
  const extra = Number(extensionMonths || 0) >0 ? ` · extension ${extensionMonths} mes(es)` : '';
  await logAction('REGISTRÓ PAGO', loanId, `${type}: S/ ${fmt(amount)} - ${date}${extra}`);
  return data;
}

async function dbInsertLender(name) {
  const { data, error } = await sb.from('prestamistas').insert({ nombre: name, created_by: currentUser.id }).select().single();
  if (error) throw error;
  return data;
}

async function dbUpsertDebtor(d) {
  const payload = {
    nombre: normalizeText(d.name),
    telefono: d.phone || null,
    dni: d.dni || null,
    direccion: d.address || null,
    notas: d.notes || null,
    created_by: currentUser.id
  };
  const query = d.id ? sb.from('deudores').update(payload).eq('id', d.id) : sb.from('deudores').insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

async function ensureDebtor(name) {
  const clean = (name || '').trim().toUpperCase();
  if (!clean || debtors.find(d =>d.name === clean)) return;
  try { await dbUpsertDebtor({ name: clean }); await loadDebtors(); } catch(err) { console.warn('No se pudo crear deudor:', err.message); }
}

async function dbUpdateLoanDates(id, loanDate, dueDate) {
  const { data, error } = await sb.rpc('editar_fechas_prestamo', { p_prestamo_id: id, p_fecha_prestamo: loanDate, p_fecha_vencimiento: dueDate });
  if (error) throw error;
  if (data && !data.ok) throw new Error(data.error);
}

async function dbUpdatePaymentDate(paymentId, date, note) {
  const { data, error } = await sb.rpc('editar_pago', { p_pago_id: paymentId, p_fecha_pago: date, p_nota: note || '' });
  if (error) throw error;
  if (data && !data.ok) throw new Error(data.error);
  await logAction('EDITÓ PAGO', paymentId, `Fecha: ${date}`);
}

async function dbSoftDeleteLoan(id) {
  const { error } = await sb.from('prestamos').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  await logAction('ELIMINÓ PRÉSTAMO', id, 'Soft delete desde frontend');
}

async function logAction(action, refId='', detail='') {
  try {
    await sb.from('logs').insert({
      usuario_id: currentUser?.id || null,
      usuario_email: currentUser?.email || null,
      accion: action,
      referencia_id: refId || null,
      detalle: detail || null
    });
  } catch (_) {}
}

async function dbUpdateLoanRequest(id, payload) {
  const { data, error } = await sb.from('solicitudes_prestamos').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function ensureDebtorFromRequest(req) {
  const clean = normalizeText(req.fullName);
  const existing = debtors.find(d =>normalizeText(d.name) === clean);
  const notes = existing?.notes || `Solicitud web registrada el ${fmtDate((req.createdAt || '').split('T')[0] || new Date().toISOString().split('T')[0])}`;
  const payload = {
    id: existing?.id || '',
    name: clean,
    phone: existing?.phone || req.phone || '',
    dni: existing?.dni || req.dni || '',
    address: existing?.address || req.address || '',
    notes
  };
  const saved = await dbUpsertDebtor(payload);
  await loadDebtors();
  return saved;
}

// ─── REALTIME ─────────────────────────────────
function subscribeRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('pc-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prestamos' }, async () =>{
      await loadLoans();
      renderDashboard();
      const pid = document.querySelector('.page.active')?.id;
      if (pid === 'page-loans')   renderLoans();
      if (pid === 'page-alerts')  renderAlerts();
      if (pid === 'page-reports') generateReport();
      checkNotifications();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prestamistas' }, async () =>{
      await loadLenders(); renderLenders(); populateLenderDropdowns();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deudores' }, async () =>{
      await loadDebtors(); renderDebtors(); populateDebtorDatalist();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, async () =>{
      await loadLoans(); renderDashboard();
      const pid = document.querySelector('.page.active')?.id;
      if (pid === 'page-loans') renderLoans();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_prestamos' }, async () =>{
      await loadLoanRequests();
      renderDashboard();
      const pid = document.querySelector('.page.active')?.id;
      if (pid === 'page-requests') renderRequests();
    })
    .subscribe();
}

// ─── NAVEGACIÓN ───────────────────────────────
function navigate(page, el) {
  document.querySelectorAll('.page').forEach(p =>{ p.classList.remove('active'); p.classList.add('hidden'); });
  document.querySelectorAll('.nav-item').forEach(n =>n.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  if (pg) { pg.classList.remove('hidden'); pg.classList.add('active'); }
  if (el) el.classList.add('active');
  const titles = { dashboard:'Dashboard', requests:'Solicitudes', loans:'Préstamos', 'new-loan':'Nuevo Préstamo', alerts:'Alertas', lenders:'Prestamistas', debtors:'Deudores', reports:'Reportes' };
  document.getElementById('topTitle').textContent = titles[page] || page;
  if (window.innerWidth <= 900) closeSidebar();
  if (page === 'requests') renderRequests();
  if (page === 'loans')    { renderLoans(); populateLenderFilter(); }
  if (page === 'alerts')   renderAlerts();
  if (page === 'reports')  generateReport();
  if (page === 'debtors')  renderDebtors();
  if (page === 'new-loan') resetForm();
  if (page === 'dashboard') renderDashboard();
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('open'); }
function closeSidebar()  { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }

// ─── DASHBOARD ────────────────────────────────
function renderDashboard() {
  const active  = loans.filter(l =>['ACTIVO','PARCIAL'].includes(l.status));
  const overdue = loans.filter(l =>l.status === 'VENCIDO');
  const paid    = loans.filter(l =>l.status === 'PAGADO');
  const totPend = loans.reduce((s,l) =>s + l.pendingAmount, 0);
  const totPaid = loans.reduce((s,l) =>s + l.paidAmount, 0);

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card" style="--card-color:var(--blue)">
      <div class="stat-label">Activos</div><div class="stat-value">${active.length}</div>
      <div class="stat-icon"></div><div class="stat-sub">${overdue.length} vencidos</div>
    </div>
    <div class="stat-card" style="--card-color:var(--accent)">
      <div class="stat-label">Por Cobrar</div><div class="stat-value money">${fmt(totPend)}</div>
      <div class="stat-icon"></div><div class="stat-sub">${active.length+overdue.length} préstamos</div>
    </div>
    <div class="stat-card" style="--card-color:var(--green)">
      <div class="stat-label">Cobrado Total</div><div class="stat-value money">${fmt(totPaid)}</div>
      <div class="stat-icon"></div><div class="stat-sub">${paid.length} pagados</div>
    </div>
    <div class="stat-card" style="--card-color:var(--red)">
      <div class="stat-label">Vencidos</div><div class="stat-value">${overdue.length}</div>
      <div class="stat-icon"></div><div class="stat-sub">Requieren seguimiento</div>
    </div>
    <div class="stat-card" style="--card-color:var(--orange)">
      <div class="stat-label">Solicitudes</div><div class="stat-value">${loanRequests.filter(r =>['PENDIENTE','EN_REVISION'].includes(r.status)).length}</div>
      <div class="stat-icon"></div><div class="stat-sub">Pendientes de evaluación</div>
    </div>`;

  const today = new Date(); today.setHours(0,0,0,0);
  const upcoming = loans.filter(l =>l.status !== 'PAGADO' && l.pendingAmount >0)
    .map(l =>({ ...l, dd: daysDiff(today, new Date(l.dueDate)) }))
    .sort((a,b) =>a.dd - b.dd).slice(0,5);

  document.getElementById('upcomingList').innerHTML = upcoming.length
    ? upcoming.map(l =>{
        const c = l.dd<0 ? 'var(--red)' : l.dd<=7 ? 'var(--orange)' : 'var(--blue)';
        const lbl = l.dd<0 ? `Vencido ${Math.abs(l.dd)}d` : l.dd===0 ? 'Hoy' : `${l.dd}d`;
        return `<div class="upcoming-item">
          <div class="upcoming-dot" style="background:${c}"></div>
          <div class="upcoming-info">
            <div class="upcoming-name">${l.debtor} <span style="color:var(--text3);font-size:12px">/ ${l.lender}</span></div>
            <div class="upcoming-date">${fmtDate(l.dueDate)} · ${lbl}</div>
          </div>
          <div class="upcoming-amt">S/ ${fmt(l.pendingAmount)}</div>
        </div>`;
      }).join('')
    : '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Sin vencimientos próximos</div>';

  const byL = {}; loans.forEach(l =>{ if (!byL[l.lender]) byL[l.lender]={p:0}; byL[l.lender].p+=l.pendingAmount; });
  const maxP = Math.max(...Object.values(byL).map(v=>v.p), 1);
  document.getElementById('lenderChart').innerHTML = Object.entries(byL).filter(([,v])=>v.p>0).sort((a,b)=>b[1].p-a[1].p)
    .map(([n,v]) =>`<div class="lender-bar-item">
      <div class="lender-bar-label"><span class="lender-bar-name">${n}</span><span class="lender-bar-val">S/ ${fmt(v.p)}</span></div>
      <div class="lender-bar-track"><div class="lender-bar-fill" style="width:${(v.p/maxP*100).toFixed(1)}%"></div></div>
    </div>`).join('') || '<p style="color:var(--text3);font-size:13px">Sin pendientes</p>';

  document.getElementById('recentActivity').innerHTML = loans.slice(0,8).map(l =>{
    const c = statusColor(l.status);
    return `<div class="activity-item">
      <div class="act-badge" style="background:${c.bg}">${statusEmoji(l.status)}</div>
      <div class="act-info">
        <div class="act-title">${l.debtor} <span style="color:var(--text3)">← ${l.lender}</span></div>
        <div class="act-meta">${fmtDate(l.loanDate)} · ${l.months} mes${l.months>1?'es':''}</div>
      </div>
      <div class="act-amt" style="color:${c.text}">S/ ${fmt(l.totalDue)}</div>
    </div>`;
  }).join('') || '<p style="color:var(--text3)">Sin actividad</p>';
}

// ─── LISTA DE PRÉSTAMOS ───────────────────────
function renderLoans(list = null) {
  const data = list || loans;
  document.getElementById('noLoans').classList.toggle('hidden', data.length >0);
  document.getElementById('loansBody').innerHTML = data.map(l =>{
    const dl = daysLeft(l.dueDate);
    return `<tr>
      <td data-label="Prestamista"><strong>${l.lender}</strong></td>
      <td data-label="Deudor"><strong>${l.debtor}</strong></td>
      <td data-label="F. Préstamo">${fmtDate(l.loanDate)}</td>
      <td data-label="Capital" class="money">S/ ${fmt(l.amount)}</td>
      <td data-label="Interés" class="money">S/ ${fmt(l.totalInterest)}</td>
      <td data-label="Total" class="money" style="color:var(--accent)"><strong>S/ ${fmt(l.totalDue)}</strong></td>
      <td data-label="F. Pago" style="color:${dl<0?'var(--red)':'inherit'}">${fmtDate(l.dueDate)}</td>
      <td data-label="Meses">${l.months}</td>
      <td data-label="M. Pagado" class="money text-green">S/ ${fmt(l.paidAmount)}</td>
      <td data-label="M. Pendiente" class="money" style="color:${l.pendingAmount>0?'var(--red)':'var(--green)'}">S/ ${fmt(l.pendingAmount)}</td>
      <td data-label="Estado"><span class="status-badge status-${l.status}">${l.status}</span></td>
      <td data-label="Acciones">
        <div class="action-btns">
          <button class="action-btn" onclick="viewLoan('${l.id}')">Ver</button>
          <button class="action-btn" onclick="generateContractPDF('${l.id}')">Contrato</button>
          <button class="action-btn" onclick="openEditLoanDates('${l.id}')">Fechas</button>
          ${l.status!=='PAGADO'?`<button class="action-btn pay" onclick="openPayment('${l.id}')">Pagar</button><button class="action-btn" onclick="openPayment('${l.id}','INTERES')">Extender</button>`:''}
          ${l.debtorPhone?`<button class="action-btn" onclick="openWhatsApp('${l.id}')">WhatsApp</button>`:''}
          <button class="action-btn danger" onclick="deleteLoan('${l.id}')">Eliminar</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterLoans() {
  const q  = document.getElementById('searchInput').value.toLowerCase();
  const s  = document.getElementById('statusFilter').value;
  const lf = document.getElementById('lenderFilter').value;
  renderLoans(loans.filter(l =>
    (!q  || [l.debtor,l.lender,l.status,l.notes,l.amount,l.totalDue,l.pendingAmount,l.loanDate,l.dueDate].join(' ').toLowerCase().includes(q)) &&
    (!s  || l.status === s) && (!lf || l.lender === lf)
  ));
}
function populateLenderFilter() {
  const sel = document.getElementById('lenderFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + lenders.map(l=>`<option value="${l.name}"${cur===l.name?' selected':''}>${l.name}</option>`).join('');
}

// ─── ALERTAS ──────────────────────────────────
function renderAlerts() {
  const today  = new Date(); today.setHours(0,0,0,0);
  const ov     = loans.filter(l =>l.status==='VENCIDO');
  const w7     = loans.filter(l =>['ACTIVO','PARCIAL'].includes(l.status) && (d=>d>=0&&d<=7)(daysDiff(today,new Date(l.dueDate))));
  const w14    = loans.filter(l =>['ACTIVO','PARCIAL'].includes(l.status) && (d=>d>7&&d<=14)(daysDiff(today,new Date(l.dueDate))));
  const badge  = ov.length + w7.length;
  document.getElementById('alertBadge').textContent = badge;
  document.getElementById('alertBadge').classList.toggle('hidden', badge===0);
  document.getElementById('notifDot').classList.toggle('hidden', badge===0);
  let html = '';
  if (ov.length)  html += `<div class="alert-section"><div class="alert-section-title">Vencidos (${ov.length})</div>${ov.map(l=>alertCard(l,today,'danger')).join('')}</div>`;
  if (w7.length)  html += `<div class="alert-section"><div class="alert-section-title">Vence en 7 días (${w7.length})</div>${w7.map(l=>alertCard(l,today,'warning')).join('')}</div>`;
  if (w14.length) html += `<div class="alert-section"><div class="alert-section-title">Próximos 8-14 días (${w14.length})</div>${w14.map(l=>alertCard(l,today,'upcoming')).join('')}</div>`;
  if (!html) html = `<div class="empty-state"><div class="empty-icon"></div><p>¡Sin alertas! Todo al día.</p></div>`;
  document.getElementById('alertsContainer').innerHTML = html;
}

function alertCard(l, today, cls) {
  const d = daysDiff(today, new Date(l.dueDate));
  const lbl = d<0 ? `Vencido hace ${Math.abs(d)}d` : d===0 ? 'Vence HOY' : `Vence en ${d}d`;
  return `<div class="alert-card ${cls}">
    <div class="alert-ico"></div>
    <div class="alert-info"><div class="alert-title">${l.debtor} → ${l.lender}</div>
      <div class="alert-meta">Capital: S/ ${fmt(l.amount)} · ${fmtDate(l.loanDate)}</div></div>
    <div style="text-align:right">
      <div class="alert-amt">S/ ${fmt(l.pendingAmount)}</div>
      <div class="alert-days ${d<0?'overdue':'soon'}">${lbl}</div>
      <button class="action-btn pay" style="margin-top:8px" onclick="openPayment('${l.id}')">Pagar</button>
    </div>
  </div>`;
}

// ─── NOTIFICACIONES BROWSER ───────────────────
function checkNotifications() {
  const today = new Date(); today.setHours(0,0,0,0);
  const alerts = loans.filter(l =>l.status!=='PAGADO' && daysDiff(today, new Date(l.dueDate))<=7);
  const badge  = alerts.length;
  document.getElementById('alertBadge').textContent = badge;
  document.getElementById('alertBadge').classList.toggle('hidden', badge===0);
  document.getElementById('notifDot').classList.toggle('hidden', badge===0);
  if (badge>0 && 'Notification' in window && Notification.permission==='granted') {
    const last = parseInt(localStorage.getItem('pc_last_notif')||'0');
    if (Date.now()-last >4*3600*1000) {
      const ov = alerts.filter(l =>daysDiff(today,new Date(l.dueDate))<0);
      new Notification(ov.length ? `${COMPANY_NAME} — Pagos vencidos` : `${COMPANY_NAME} — Vence pronto`, {
        body: (ov.length ? ov : alerts).map(l=>l.debtor).join(', '),
        tag: 'tusocio-financiero'
      });
      localStorage.setItem('pc_last_notif', Date.now());
    }
  }
}

// ─── MARCA Y SOLICITUD PÚBLICA ───────────────
function applyBranding() {
  document.title = `${COMPANY_NAME} — Gestión de Préstamos`;
  document.querySelectorAll('.brand-name').forEach(el =>el.textContent = COMPANY_NAME);
  document.querySelectorAll('.brand-slogan').forEach(el =>el.textContent = COMPANY_SLOGAN);
}

function showPublicRequest() {
  window.location.href = './cliente.html#solicitar';
}

function showLoginScreen() {
  document.getElementById('requestScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  history.replaceState(null, '', location.pathname + location.search);
}

function resetPublicRequestForm() {
  document.getElementById('loanRequestForm').reset();
  document.getElementById('loanRequestForm').classList.remove('hidden');
  document.getElementById('requestSuccess').classList.add('hidden');
  document.getElementById('requestError').classList.add('hidden');
}

async function submitLoanRequest(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitRequest');
  const err = document.getElementById('requestError');
  err.classList.add('hidden');
  const payload = {
    nombre_completo: normalizeText(document.getElementById('reqFullName').value),
    dni: document.getElementById('reqDni').value.trim(),
    telefono: document.getElementById('reqPhone').value.trim(),
    direccion: document.getElementById('reqAddress').value.trim() || null,
    monto_solicitado: parseFloat(document.getElementById('reqAmount').value),
    plazo_meses: parseInt(document.getElementById('reqMonths').value),
    ocupacion: document.getElementById('reqJob').value.trim() || null,
    ingresos_mensuales: document.getElementById('reqIncome').value ? parseFloat(document.getElementById('reqIncome').value) : null,
    motivo: document.getElementById('reqPurpose').value.trim() || null,
    referencia_nombre: document.getElementById('reqRefName').value.trim() || null,
    referencia_telefono: document.getElementById('reqRefPhone').value.trim() || null,
    estado: 'PENDIENTE',
    origen: 'web'
  };
  if (!payload.nombre_completo || !payload.dni || !payload.telefono || !payload.monto_solicitado || !payload.plazo_meses) {
    err.textContent = 'Completa los campos obligatorios.';
    err.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>Enviando...';
  try {
    const { error } = await sb.from('solicitudes_prestamos').insert(payload);
    if (error) throw error;
    document.getElementById('loanRequestForm').classList.add('hidden');
    document.getElementById('requestSuccess').classList.remove('hidden');
  } catch (ex) {
    err.textContent = 'No se pudo enviar la solicitud: ' + ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Enviar solicitud</span><span class="btn-arrow">→</span>';
  }
}


function publicPortalUrl() {
  const base = new URL('cliente.html', window.location.href);
  return base.href;
}
function publicTrackingUrl(code='', dni='') {
  const url = new URL('cliente.html', window.location.href);
  url.hash = 'seguimiento';
  if (code) url.searchParams.set('codigo', code);
  if (dni) url.searchParams.set('dni', dni);
  return url.href;
}
function requestStatusLabel(status) {
  return String(status || 'PENDIENTE').replace(/_/g, ' ');
}
function copyText(value, okMsg='Copiado') {
  navigator.clipboard?.writeText(value).then(() =>toast(okMsg, 'success')).catch(() =>prompt('Copia el texto:', value));
}
function sendRequestTrackingWhatsApp(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  const phone = (r.phone || '').replace(/\D/g, '');
  if (!phone) return toast('La solicitud no tiene telefono', 'error');
  const pePhone = phone.startsWith('51') ? phone : '51' + phone;
  const link = publicTrackingUrl(r.code, r.dni);
  const msg = `Hola ${r.fullName}, te saludamos de ${COMPANY_NAME}.\n\nTu codigo de seguimiento es: ${r.code || 'PENDIENTE'}\nPuedes consultar tu solicitud aqui:\n${link}\n\n${COMPANY_SLOGAN}`;
  window.open(`https://wa.me/${pePhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function sendRequestTrackingEmail(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  if (!r.email) return toast('La solicitud no tiene correo', 'error');
  const link = publicTrackingUrl(r.code, r.dni);
  const subject = `Seguimiento de solicitud ${r.code || ''} - ${COMPANY_NAME}`;
  const body = `Hola ${r.fullName},

Te saludamos de ${COMPANY_NAME}.

Tu codigo de seguimiento es: ${r.code || 'PENDIENTE'}
Estado actual: ${requestStatusLabel(r.status)}

Puedes consultar tu solicitud aqui:
${link}

${COMPANY_SLOGAN}`;
  window.location.href = `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function observeRequest(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  const note = prompt(`Observacion para ${r.fullName}:`, r.reviewNotes || 'Falta validar informacion/documentos');
  if (note === null) return;
  try {
    await dbUpdateLoanRequest(id, { estado: 'OBSERVADO', notas_revision: note, revisado_por: currentUser.id, revisado_en: new Date().toISOString() });
    await logAction('OBSERVÓ SOLICITUD', id, `${r.fullName}: ${note}`);
    await loadLoanRequests(); renderRequests(); renderDashboard(); toast('Solicitud observada', 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}
async function markRequestDisbursed(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  if (!confirm(`Marcar como DESEMBOLSADO el prestamo de ${r.fullName}?`)) return;
  try {
    await dbUpdateLoanRequest(id, { estado: 'DESEMBOLSADO', fecha_desembolso: new Date().toISOString(), revisado_por: currentUser.id, revisado_en: new Date().toISOString() });
    await logAction('DESEMBOLSÓ SOLICITUD', r.loanId || id, r.fullName);
    await loadLoanRequests(); renderRequests(); renderDashboard(); toast('Solicitud marcada como desembolsada', 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function updateRequestBadge() {
  const el = document.getElementById('requestBadge');
  if (!el) return;
  const pending = loanRequests.filter(r =>['PENDIENTE','EN_REVISION','OBSERVADO'].includes(r.status)).length;
  el.textContent = pending;
  el.classList.toggle('hidden', pending === 0);
}

function renderRequests() {
  const el = document.getElementById('requestsContainer');
  if (!el) return;
  updateRequestBadge();
  const q = (document.getElementById('requestSearch')?.value || '').toLowerCase();
  const st = document.getElementById('requestStatusFilter')?.value || '';
  const list = loanRequests.filter(r =>
    (!st || r.status === st) &&
    (!q || [r.code, r.fullName, r.dni, r.phone, r.email, r.job, r.purpose, r.refName].join(' ').toLowerCase().includes(q))
  );
  el.innerHTML = list.length ? list.map(requestCard).join('') : '<div class="empty-state"><div class="empty-icon"></div><p>No hay solicitudes con esos filtros.</p></div>';
}

function requestCard(r) {
  const status = r.status || 'PENDIENTE';
  const canManage = ['PENDIENTE','EN_REVISION','OBSERVADO'].includes(status);
  const canDisburse = status === 'APROBADA' && r.loanId;
  const phone = (r.phone || '').replace(/\D/g, '');
  const wa = phone ? (phone.startsWith('51') ? phone : '51' + phone) : '';
  const track = publicTrackingUrl(r.code, r.dni);
  return `<div class="request-card">
    <div class="request-card-head">
      <div>
        <div class="request-name">${r.fullName || 'SIN NOMBRE'}</div>
        <div class="request-meta">Código: <strong>${r.code || 'SIN CÓDIGO'}</strong>· DNI: ${r.dni || '—'} · ${r.phone || 'Sin teléfono'} · ${r.email || 'Sin correo'} · ${fmtDate((r.createdAt || '').split('T')[0])}</div>
      </div>
      <span class="status-badge status-${status}">${requestStatusLabel(status)}</span>
    </div>
    <div class="request-amount-row">
      <div><span>Monto solicitado</span><strong>S/ ${fmt(r.amount)}</strong></div>
      <div><span>Plazo</span><strong>${r.months || '—'} mes${r.months === 1 ? '' : 'es'}</strong></div>
      <div><span>Ingreso aprox.</span><strong>${r.income != null ? 'S/ ' + fmt(r.income) : '—'}</strong></div>
    </div>
    <div class="request-detail-grid">
      <div><span>Ocupación</span><p>${r.job || '—'}</p></div>
      <div><span>Dirección</span><p>${r.address || '—'}</p></div>
      <div><span>Motivo</span><p>${r.purpose || '—'}</p></div>
      <div><span>Referencia</span><p>${r.refName || '—'}${r.refPhone ? ' · ' + r.refPhone : ''}</p></div>
      ${r.reviewNotes ? `<div class="public-wide"><span>Notas de revisión</span><p>${r.reviewNotes}</p></div>` : ''}
      ${r.approvedAmount ? `<div><span>Aprobado</span><p>S/ ${fmt(r.approvedAmount)} · ${r.approvedMonths || r.months} mes(es)</p></div>` : ''}
    </div>
    <div class="tracking-mini">
      <span>Seguimiento cliente:</span>
      <button class="mini-link" onclick="copyText('${track}', 'Link de seguimiento copiado')">Copiar link</button>
      ${r.code ? `<button class="mini-link" onclick="copyText('${r.code}', 'Codigo copiado')">Copiar código</button>` : ''}
    </div>
    <div class="request-actions">
      ${wa ? `<button class="action-btn" onclick="sendRequestTrackingWhatsApp('${r.id}')">Enviar seguimiento</button>` : ''}
      ${r.email ? `<button class="action-btn" onclick="sendRequestTrackingEmail('${r.id}')">Enviar correo</button>` : ''}
      ${canManage ? `<button class="action-btn" onclick="markRequestInReview('${r.id}')">En revisión</button><button class="action-btn" onclick="observeRequest('${r.id}')">Observar</button><button class="action-btn pay" onclick="openApproveRequest('${r.id}')">Aprobar</button><button class="action-btn danger" onclick="rejectRequest('${r.id}')">Rechazar</button>` : ''}
      ${canDisburse ? `<button class="action-btn pay" onclick="markRequestDisbursed('${r.id}')">Marcar desembolso</button>` : ''}
      ${r.loanId ? `<button class="action-btn" onclick="viewLoan('${r.loanId}')">Ver préstamo creado</button>` : ''}
    </div>
  </div>`;
}

async function markRequestInReview(id) {
  try {
    await dbUpdateLoanRequest(id, { estado: 'EN_REVISION', revisado_por: currentUser.id, revisado_en: new Date().toISOString() });
    await loadLoanRequests(); renderRequests(); renderDashboard(); toast('Solicitud marcada en revisión', 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function openApproveRequest(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('requestApprovalBody').innerHTML = `
    <div class="payment-info">
      <div class="payment-info-row"><span>Solicitante</span><strong>${r.fullName}</strong></div>
      <div class="payment-info-row"><span>DNI</span><strong>${r.dni || '—'}</strong></div>
      <div class="payment-info-row"><span>Teléfono</span><strong>${r.phone || '—'}</strong></div>
      <div class="payment-info-row"><span>Monto solicitado</span><strong>S/ ${fmt(r.amount)}</strong></div>
      <div class="payment-info-row"><span>Plazo solicitado</span><strong>${r.months || '—'} mes${r.months === 1 ? '' : 'es'}</strong></div>
    </div>
    <div class="multi-note" style="margin-bottom:18px">El contrato y los comprobantes saldrán a nombre de <strong>${COMPANY_NAME}</strong>. El prestamista interno queda solo para gestión interna.</div>
    <div class="form-grid compact">
      <div class="field-group">
        <label>Prestamista interno / cuenta *</label>
        <select id="apprLender" class="form-input" onchange="calcApprovePreview()">
          <option value="">Seleccionar...</option>
          ${lenders.map(l =>`<option value="${l.name}">${l.name}</option>`).join('')}
        </select>
        <span class="field-err" id="errApprLender"></span>
      </div>
      <div class="field-group">
        <label>Fecha de préstamo *</label>
        <input type="date" id="apprDate" class="form-input" value="${today}" oninput="calcApprovePreview()">
      </div>
      <div class="field-group">
        <label>Monto aprobado (S/) *</label>
        <input type="number" id="apprAmount" class="form-input" min="1" step="0.01" value="${r.amount || ''}" oninput="calcApprovePreview()">
        <span class="field-err" id="errApprAmount"></span>
      </div>
      <div class="field-group">
        <label>Plazo aprobado *</label>
        <select id="apprMonths" class="form-input" onchange="calcApprovePreview()">
          ${[1,2,3,4,5,6].map(m =>`<option value="${m}"${Number(r.months)===m?' selected':''}>${m} mes${m>1?'es':''}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label>Interés mensual (%) *</label>
        <input type="number" id="apprRate" class="form-input" min="0" step="0.01" value="${DEFAULT_INTEREST_RATE}" oninput="calcApprovePreview()">
      </div>
      <div class="field-group">
        <label>Notas de aprobación</label>
        <input type="text" id="apprNotes" class="form-input" placeholder="Condiciones, observaciones...">
      </div>
    </div>
    <div id="approvePreview" class="loan-preview" style="margin-top:12px"></div>
    <div class="modal-footer">
      <button class="btn-back" onclick="closeModal('requestApprovalModal')">Cancelar</button>
      <button class="btn-save" id="btnApproveRequest" onclick="approveRequest('${id}')">Aprobar y crear préstamo</button>
    </div>`;
  showModal('requestApprovalModal');
  calcApprovePreview();
}

function calcApprovePreview() {
  const a = parseFloat(document.getElementById('apprAmount')?.value) || 0;
  const m = parseInt(document.getElementById('apprMonths')?.value) || 0;
  const rate = parseFloat(document.getElementById('apprRate')?.value || DEFAULT_INTEREST_RATE);
  const dt = document.getElementById('apprDate')?.value;
  const el = document.getElementById('approvePreview');
  if (!el || !a || !m || !dt) return;
  const interest = a * (rate / 100) * m;
  const due = new Date(dt + 'T00:00:00'); due.setMonth(due.getMonth() + m);
  el.innerHTML = `<h4>Resumen aprobado</h4><div class="preview-grid">
    <div class="prev-item"><span>Capital</span><strong>S/ ${fmt(a)}</strong></div>
    <div class="prev-item"><span>Interés</span><strong>S/ ${fmt(interest)}</strong></div>
    <div class="prev-item"><span>Total</span><strong class="total-big">S/ ${fmt(a + interest)}</strong></div>
    <div class="prev-item"><span>Vencimiento</span><strong>${fmtDate(due.toISOString().split('T')[0])}</strong></div>
  </div>`;
}

async function approveRequest(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  const lender = document.getElementById('apprLender').value;
  const amount = parseFloat(document.getElementById('apprAmount').value);
  const months = parseInt(document.getElementById('apprMonths').value);
  const rate = parseFloat(document.getElementById('apprRate').value || DEFAULT_INTEREST_RATE);
  const loanDate = document.getElementById('apprDate').value;
  const notes = document.getElementById('apprNotes').value.trim();
  document.getElementById('errApprLender').textContent = !lender ? 'Selecciona una cuenta interna' : '';
  document.getElementById('errApprAmount').textContent = !amount || amount <= 0 ? 'Monto inválido' : '';
  if (!lender || !amount || amount <= 0 || !months || !loanDate) return;
  const btn = document.getElementById('btnApproveRequest');
  btn.disabled = true; btn.textContent = 'Aprobando...';
  try {
    await ensureDebtorFromRequest(r);
    const created = await dbInsertLoan({
      lender,
      debtor: r.fullName,
      loanDate,
      amount,
      months,
      interestRate: rate,
      notes: [notes, `Solicitud web aprobada: ${r.id}`].filter(Boolean).join(' | ')
    });
    await dbUpdateLoanRequest(id, {
      estado: 'APROBADA',
      monto_aprobado: amount,
      plazo_aprobado_meses: months,
      interes_mensual_aprobado: rate / 100,
      notas_revision: notes || null,
      aprobado_por: currentUser.id,
      aprobado_en: new Date().toISOString(),
      revisado_por: currentUser.id,
      revisado_en: new Date().toISOString(),
      prestamo_id: created.id
    });
    await logAction('APROBÓ SOLICITUD', created.id, `${r.fullName} / S/ ${fmt(amount)}`);
    closeModal('requestApprovalModal');
    toast('Solicitud aprobada y préstamo creado', 'success');
    await loadLoanRequests(); await loadLoans(); renderRequests(); renderDashboard();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Aprobar y crear préstamo'; }
}

async function rejectRequest(id) {
  const r = loanRequests.find(x =>x.id === id); if (!r) return;
  const reason = prompt(`Motivo de rechazo para ${r.fullName}:`, r.reviewNotes || 'No califica por el momento');
  if (reason === null) return;
  try {
    await dbUpdateLoanRequest(id, { estado: 'RECHAZADA', notas_revision: reason, revisado_por: currentUser.id, revisado_en: new Date().toISOString() });
    await logAction('RECHAZÓ SOLICITUD', id, `${r.fullName}: ${reason}`);
    await loadLoanRequests(); renderRequests(); renderDashboard(); toast('Solicitud rechazada', 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ─── FORMULARIO NUEVO PRÉSTAMO ────────────────
function resetForm() {
  ['chk1','chk2','chk3','chk4'].forEach(id =>document.getElementById(id).checked = false);
  ['fDebtor','fAmount','fNotes'].forEach(id =>document.getElementById(id).value = '');
  document.getElementById('fMonths').value = '';
  const rateEl = document.getElementById('fInterestRate'); if (rateEl) rateEl.value = DEFAULT_INTEREST_RATE;
  document.getElementById('fLender').value = '';
  setDateDefaults();
  checkQualify();
  showStep(1);
  document.getElementById('loanPreview').classList.add('hidden');
  document.getElementById('btnNext2').disabled = true;
}
function setDateDefaults() { document.getElementById('fDate').value = new Date().toISOString().split('T')[0]; }

function checkQualify() {
  const n   = ['chk1','chk2','chk3','chk4'].filter(id =>document.getElementById(id).checked).length;
  const btn = document.getElementById('btnNext1');
  const res = document.getElementById('qualifyResult');
  btn.disabled = n < 4;
  if (n===4) { res.classList.remove('hidden'); res.style.cssText='background:var(--green-soft);border:1px solid rgba(34,197,94,0.3);color:var(--green)'; res.textContent='Califica. Puede continuar.'; }
  else if (n>0) { res.classList.remove('hidden'); res.style.cssText='background:var(--orange-soft);border:1px solid rgba(249,115,22,0.3);color:var(--orange)'; res.textContent=`Faltan ${4-n} criterio${4-n>1?'s':''}.`; }
  else res.classList.add('hidden');
}

function calcLoan() {
  const a = parseFloat(document.getElementById('fAmount').value)||0;
  const m = parseInt(document.getElementById('fMonths').value)||0;
  const d = document.getElementById('fDate').value;
  if (!a||!m||!d) { document.getElementById('loanPreview').classList.add('hidden'); return; }
  const ratePct = parseFloat(document.getElementById('fInterestRate')?.value || DEFAULT_INTEREST_RATE);
  const int = a*(ratePct/100)*m, tot = a+int;
  const due = new Date(d+'T00:00:00'); due.setMonth(due.getMonth()+m);
  document.getElementById('prvCapital').textContent    = `S/ ${fmt(a)}`;
  document.getElementById('prvInterest').textContent   = `S/ ${fmt(int)}`;
  document.getElementById('prvTotal').textContent      = `S/ ${fmt(tot)}`;
  document.getElementById('prvDueDate').textContent    = fmtDate(due.toISOString().split('T')[0]);
  document.getElementById('prvMonths').textContent     = `${m} mes${m>1?'es':''}`;
  document.getElementById('prvMonthlyInt').textContent = `S/ ${fmt(a*(ratePct/100))}/mes`;
  const label = document.getElementById('prvInterestLabel'); if (label) label.textContent = `Interés ${fmt(ratePct).replace('.00','')}% mensual`;
  document.getElementById('multiMonthNote').classList.toggle('hidden', m<=1);
  document.getElementById('loanPreview').classList.remove('hidden');
}

function validateForm() {
  const lender=document.getElementById('fLender').value, debtor=document.getElementById('fDebtor').value.trim(),
        date=document.getElementById('fDate').value, amount=parseFloat(document.getElementById('fAmount').value),
        months=document.getElementById('fMonths').value, rate=parseFloat(document.getElementById('fInterestRate')?.value || DEFAULT_INTEREST_RATE);
  let ok=true;
  const e=(fid,eid,msg)=>{ document.getElementById(eid).textContent=msg; document.getElementById(fid).classList.toggle('error',!!msg); if(msg)ok=false; };
  e('fLender','errLender',!lender?'Selecciona prestamista':'');
  e('fDebtor','errDebtor',!debtor?'Ingresa el deudor':debtor.length<2?'Mínimo 2 caracteres':'');
  e('fDate','errDate',!date?'Selecciona fecha':'');
  e('fAmount','errAmount',!amount||amount<=0?'Monto inválido':'');
  e('fMonths','errMonths',!months?'Selecciona plazo':'');
  if (document.getElementById('fInterestRate')) e('fInterestRate','errInterestRate',!rate||rate<0?'Interés inválido':'');
  document.getElementById('btnNext2').disabled=!ok;
  return ok;
}

function goStep(n) { if(n===3&&!validateForm())return; if(n===3)buildConfirm(); showStep(n); }
function showStep(n) { [1,2,3].forEach(i=>{ document.getElementById('step'+i).classList.toggle('hidden',i!==n); document.getElementById('step'+i).classList.toggle('active',i===n); }); }

function buildConfirm() {
  const l=document.getElementById('fLender').value, d=document.getElementById('fDebtor').value.trim(),
        dt=document.getElementById('fDate').value, a=parseFloat(document.getElementById('fAmount').value),
        m=parseInt(document.getElementById('fMonths').value), n=document.getElementById('fNotes').value;
  const ratePct=parseFloat(document.getElementById('fInterestRate')?.value || DEFAULT_INTEREST_RATE);
  const int=a*(ratePct/100)*m, tot=a+int, due=new Date(dt+'T00:00:00');
  due.setMonth(due.getMonth()+m);
  document.getElementById('confirmSummary').innerHTML = `
    <div class="confirm-summary">
      <div class="confirm-row"><span>Prestamista</span><strong>${l}</strong></div>
      <div class="confirm-row"><span>Deudor</span><strong>${d}</strong></div>
      <div class="confirm-row"><span>Fecha Préstamo</span><strong>${fmtDate(dt)}</strong></div>
      <div class="confirm-row"><span>Capital</span><strong>S/ ${fmt(a)}</strong></div>
      <div class="confirm-row"><span>Interés ${fmt(ratePct).replace('.00','')}% × ${m} mes${m>1?'es':''}</span><strong>S/ ${fmt(int)}</strong></div>
      <div class="confirm-row confirm-total"><span>TOTAL A PAGAR</span><strong>S/ ${fmt(tot)}</strong></div>
      <div class="confirm-row"><span>Fecha Vencimiento</span><strong>${fmtDate(due.toISOString().split('T')[0])}</strong></div>
      ${n?`<div class="confirm-row"><span>Notas</span><strong>${n}</strong></div>`:''}
    </div>`;
}

async function saveLoan() {
  const btn = document.querySelector('#step3 .btn-save');
  btn.disabled=true; btn.textContent='Guardando...';
  try {
    const debtorName = document.getElementById('fDebtor').value.trim();
    await ensureDebtor(debtorName);
    await dbInsertLoan({
      lender:   document.getElementById('fLender').value,
      debtor:   debtorName,
      loanDate: document.getElementById('fDate').value,
      amount:   parseFloat(document.getElementById('fAmount').value),
      months:   parseInt(document.getElementById('fMonths').value),
      notes:    document.getElementById('fNotes').value,
      interestRate: parseFloat(document.getElementById('fInterestRate')?.value || DEFAULT_INTEREST_RATE)
    });
    toast('Préstamo registrado', 'success');
    await loadLoans();
    setTimeout(()=>navigate('loans', document.querySelector('[data-page=loans]')), 500);
  } catch(err) { toast('Error: '+err.message, 'error'); }
  finally { btn.disabled=false; btn.textContent='Registrar préstamo'; }
}

// ─── PAGO ─────────────────────────────────────
function openPayment(id, defaultType='PARCIAL') {
  const l = loans.find(x=>x.id===id); if(!l) return;
  const monthlyInterest = Number(l.capitalCurrent || l.amount || 0) * Number(l.interestRate || 0.20);
  const defaultAmount = defaultType === 'INTERES' ? monthlyInterest : l.pendingAmount;
  document.getElementById('paymentModalBody').innerHTML = `
    <div class="payment-info">
      <div class="payment-info-row"><span>Deudor</span><strong>${l.debtor}</strong></div>
      <div class="payment-info-row"><span>Empresa</span><strong>${COMPANY_NAME}</strong></div>
      <div class="payment-info-row"><span>Capital actual</span><strong>S/ ${fmt(l.capitalCurrent || l.amount)}</strong></div>
      <div class="payment-info-row"><span>Interés mensual base</span><strong>S/ ${fmt(monthlyInterest)}/mes</strong></div>
      <div class="payment-info-row"><span>Total préstamo</span><strong>S/ ${fmt(l.totalDue)}</strong></div>
      <div class="payment-info-row"><span>Ya pagado</span><strong style="color:var(--green)">S/ ${fmt(l.paidAmount)}</strong></div>
      <div class="payment-info-row"><span>Pendiente</span><strong style="color:var(--red)">S/ ${fmt(l.pendingAmount)}</strong></div>
      <div class="payment-info-row"><span>Vencimiento actual</span><strong>${fmtDate(l.dueDate)}</strong></div>
    </div>
    ${l.payments.length?`<div class="payment-history"><h4>Historial</h4>${l.payments.map((p,i)=>`<div class="payment-entry"><span>${fmtDate(p.date)} · ${p.type || 'PARCIAL'}${p.extensionMonths ? ' · +' + p.extensionMonths + ' mes(es)' : ''}${p.note?' · '+p.note:''}</span><strong>+ S/ ${fmt(p.amount)}</strong><button class="mini-link" onclick="generatePaymentReceiptPDF('${id}','${p.id}')">Comprobante</button><button class="mini-link" onclick="openEditPayment('${p.id}','${id}')">Editar</button></div>`).join('')}</div>`:''}
    <div class="field-group">
      <label>Tipo de pago *</label>
      <select id="payType" class="form-input" onchange="togglePaymentExtension('${id}')">
        <option value="PARCIAL" ${defaultType==='PARCIAL'?'selected':''}>Pago parcial normal</option>
        <option value="INTERES" ${defaultType==='INTERES'?'selected':''}>Pago de interés / renovación</option>
        <option value="CAPITAL" ${defaultType==='CAPITAL'?'selected':''}>Abono a capital</option>
        <option value="CANCELACION" ${defaultType==='CANCELACION'?'selected':''}>Cancelación total</option>
      </select>
    </div>
    <div class="field-group">
      <label>Monto recibido (S/) *</label>
      <input type="number" id="payAmount" class="form-input" min="0.01" step="0.01" value="${fmt(defaultAmount).replace(/,/g,'')}" oninput="previewPaymentFinance('${id}')">
      <span class="field-err" id="errPayAmount"></span>
    </div>
    <div id="extensionFields" class="extension-box hidden">
      <div class="multi-note" style="margin-bottom:12px">Si el cliente paga solo interés y renuevas el préstamo, el capital no baja. El sistema suma el nuevo interés al total y mueve la fecha de vencimiento.</div>
      <div class="field-group">
        <label>Meses que se extiende</label>
        <input type="number" id="payExtensionMonths" class="form-input" min="0" step="1" value="1" oninput="previewPaymentFinance('${id}')">
      </div>
    </div>
    <div class="field-group">
      <label>Fecha de Pago</label>
      <input type="date" id="payDate" class="form-input" value="${new Date().toISOString().split('T')[0]}">
    </div>
    <div class="field-group">
      <label>Nota (opcional)</label>
      <input type="text" id="payNote" class="form-input" placeholder="Yapeo, efectivo, transferencia, pago de interés...">
    </div>
    <div id="paymentFinancePreview" class="loan-preview compact-preview"></div>
    <div class="modal-footer">
      <button class="btn-back" onclick="closeModal('paymentModal')">Cancelar</button>
      <button class="btn-save" id="btnPay" onclick="registerPayment('${id}')">Registrar pago</button>
    </div>`;
  showModal('paymentModal');
  togglePaymentExtension(id);
}

function togglePaymentExtension(id) {
  const l = loans.find(x=>x.id===id); if(!l) return;
  const type = document.getElementById('payType')?.value || 'PARCIAL';
  const ext = document.getElementById('extensionFields');
  ext?.classList.toggle('hidden', type !== 'INTERES');
  const amountEl = document.getElementById('payAmount');
  if (amountEl) {
    const monthlyInterest = Number(l.capitalCurrent || l.amount || 0) * Number(l.interestRate || 0.20);
    if (type === 'INTERES') amountEl.value = fmt(monthlyInterest).replace(/,/g,'');
    if (type === 'CANCELACION') amountEl.value = fmt(l.pendingAmount).replace(/,/g,'');
  }
  previewPaymentFinance(id);
}

function previewPaymentFinance(id) {
  const l = loans.find(x=>x.id===id); if(!l) return;
  const type = document.getElementById('payType')?.value || 'PARCIAL';
  const amount = parseFloat(document.getElementById('payAmount')?.value || '0') || 0;
  const extMonths = type === 'INTERES' ? (parseInt(document.getElementById('payExtensionMonths')?.value || '0') || 0) : 0;
  const baseCapital = Number(l.capitalCurrent || l.amount || 0);
  const addInterest = type === 'INTERES' && extMonths >0 ? baseCapital * Number(l.interestRate || 0.20) * extMonths : 0;
  const newPending = Math.max(0, Number(l.pendingAmount || 0) - amount + addInterest);
  const newTotal = Number(l.totalDue || 0) + addInterest;
  const due = new Date((l.dueDate || new Date().toISOString().split('T')[0]) + 'T00:00:00');
  if (extMonths >0) due.setMonth(due.getMonth() + extMonths);
  const el = document.getElementById('paymentFinancePreview');
  if (!el) return;
  el.innerHTML = `<h4>Resultado estimado</h4><div class="preview-grid">
    <div class="prev-item"><span>Pago recibido</span><strong>S/ ${fmt(amount)}</strong></div>
    <div class="prev-item"><span>Interés nuevo por extensión</span><strong>S/ ${fmt(addInterest)}</strong></div>
    <div class="prev-item"><span>Nuevo total</span><strong>S/ ${fmt(newTotal)}</strong></div>
    <div class="prev-item"><span>Nuevo saldo</span><strong class="total-big">S/ ${fmt(newPending)}</strong></div>
    <div class="prev-item"><span>Nuevo vencimiento</span><strong>${extMonths >0 ? fmtDate(due.toISOString().split('T')[0]) : fmtDate(l.dueDate)}</strong></div>
    <div class="prev-item"><span>Capital actual</span><strong>S/ ${fmt(type === 'CAPITAL' ? Math.max(0, baseCapital - amount) : baseCapital)}</strong></div>
  </div>`;
}

async function registerPayment(id) {
  const l=loans.find(x=>x.id===id), amt=parseFloat(document.getElementById('payAmount').value),
        date=document.getElementById('payDate').value, note=document.getElementById('payNote').value,
        type=document.getElementById('payType')?.value || 'PARCIAL',
        extMonths=type === 'INTERES' ? (parseInt(document.getElementById('payExtensionMonths')?.value || '0') || 0) : 0;
  const errEl=document.getElementById('errPayAmount');
  if(!amt||amt<=0){errEl.textContent='Monto inválido';return;}
  if(type !== 'INTERES' && amt>l.pendingAmount+0.01){errEl.textContent=`Máximo S/ ${fmt(l.pendingAmount)}`;return;}
  const btn=document.getElementById('btnPay'); btn.disabled=true; btn.textContent='Guardando...';
  try {
    await dbPayment(id, amt, date, note, type, extMonths);
    closeModal('paymentModal');
    toast(`Pago de S/ ${fmt(amt)} registrado`, 'success');
    await loadLoans(); renderLoans(); renderDashboard(); checkNotifications();
  } catch(err) { toast('Error: '+err.message, 'error'); btn.disabled=false; btn.textContent='Registrar pago'; }
}



// ─── EDICIÓN DE FECHAS ───────────────────────
function openEditLoanDates(id) {
  const l = loans.find(x =>x.id === id); if (!l) return;
  document.getElementById('editLoanDatesBody').innerHTML = `
    <div class="payment-info" style="margin-bottom:16px">
      <div class="payment-info-row"><span>Deudor</span><strong>${l.debtor}</strong></div>
      <div class="payment-info-row"><span>Empresa</span><strong>${COMPANY_NAME}</strong></div>
    </div>
    <div class="field-group">
      <label>Fecha de préstamo *</label>
      <input type="date" id="editLoanDate" class="form-input" value="${l.loanDate}">
      <span class="field-err" id="errEditLoanDate"></span>
    </div>
    <div class="field-group">
      <label>Fecha de pago / vencimiento *</label>
      <input type="date" id="editDueDate" class="form-input" value="${l.dueDate}">
      <span class="field-err" id="errEditDueDate"></span>
    </div>
    <div class="modal-footer">
      <button class="btn-back" onclick="closeModal('editLoanDatesModal')">Cancelar</button>
      <button class="btn-save" id="btnEditLoanDates" onclick="saveLoanDates('${id}')">Guardar cambios</button>
    </div>`;
  showModal('editLoanDatesModal');
}

async function saveLoanDates(id) {
  const loanDate = document.getElementById('editLoanDate').value;
  const dueDate = document.getElementById('editDueDate').value;
  document.getElementById('errEditLoanDate').textContent = !loanDate ? 'Selecciona fecha' : '';
  document.getElementById('errEditDueDate').textContent = !dueDate ? 'Selecciona fecha' : '';
  if (!loanDate || !dueDate) return;
  const btn = document.getElementById('btnEditLoanDates'); btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await dbUpdateLoanDates(id, loanDate, dueDate);
    closeModal('editLoanDatesModal');
    toast('Fechas actualizadas', 'success');
    await loadLoans(); renderLoans(); renderDashboard(); checkNotifications();
  } catch(err) { toast('Error: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
}

function openEditPayment(paymentId, loanId) {
  const l = loans.find(x =>x.id === loanId); if (!l) return;
  const p = l.payments.find(x =>x.id === paymentId); if (!p) return;
  document.getElementById('editPaymentBody').innerHTML = `
    <div class="payment-info" style="margin-bottom:16px">
      <div class="payment-info-row"><span>Deudor</span><strong>${l.debtor}</strong></div>
      <div class="payment-info-row"><span>Monto</span><strong>S/ ${fmt(p.amount)}</strong></div>
    </div>
    <div class="field-group">
      <label>Fecha de pago *</label>
      <input type="date" id="editPaymentDate" class="form-input" value="${p.date}">
      <span class="field-err" id="errEditPaymentDate"></span>
    </div>
    <div class="field-group">
      <label>Nota</label>
      <input type="text" id="editPaymentNote" class="form-input" value="${p.note}">
    </div>
    <div class="modal-footer">
      <button class="btn-back" onclick="closeModal('editPaymentModal')">Cancelar</button>
      <button class="btn-save" id="btnEditPayment" onclick="savePaymentDate('${paymentId}')">Guardar cambios</button>
    </div>`;
  showModal('editPaymentModal');
}

async function savePaymentDate(paymentId) {
  const date = document.getElementById('editPaymentDate').value;
  const note = document.getElementById('editPaymentNote').value;
  document.getElementById('errEditPaymentDate').textContent = !date ? 'Selecciona fecha' : '';
  if (!date) return;
  const btn = document.getElementById('btnEditPayment'); btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await dbUpdatePaymentDate(paymentId, date, note);
    closeModal('editPaymentModal'); closeModal('detailModal'); closeModal('paymentModal');
    toast('Pago actualizado', 'success');
    await loadLoans(); renderLoans(); renderDashboard(); checkNotifications();
  } catch(err) { toast('Error: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
}

// ─── DETALLE ──────────────────────────────────
function viewLoan(id) {
  const l=loans.find(x=>x.id===id); if(!l) return;
  const today=new Date(); today.setHours(0,0,0,0);
  const d=daysDiff(today,new Date(l.dueDate));
  const dLbl = d<0?`Vencido hace ${Math.abs(d)} días`:d===0?'Vence hoy':`Vence en ${d} días`;
  document.getElementById('detailModalBody').innerHTML = `
    <div class="payment-info" style="margin-bottom:20px">
      <div class="payment-info-row"><span>Empresa</span><strong>${COMPANY_NAME}</strong></div>
      <div class="payment-info-row"><span>Deudor</span><strong>${l.debtor}</strong></div>
      <div class="payment-info-row"><span>Fecha Préstamo</span><strong>${fmtDate(l.loanDate)}</strong></div>
      <div class="payment-info-row"><span>Plazo</span><strong>${l.months} mes${l.months>1?'es':''}</strong></div>
      <div class="payment-info-row"><span>Capital original</span><strong>S/ ${fmt(l.amount)}</strong></div>
      <div class="payment-info-row"><span>Capital actual</span><strong>S/ ${fmt(l.capitalCurrent || l.amount)}</strong></div>
      <div class="payment-info-row"><span>Interés Total</span><strong>S/ ${fmt(l.totalInterest)}</strong></div>
      <div class="payment-info-row"><span>Meses extendidos</span><strong>${l.extendedMonths || 0}</strong></div>
      <div class="payment-info-row"><span>Total a Pagar</span><strong style="color:var(--accent);font-size:18px">S/ ${fmt(l.totalDue)}</strong></div>
      <div class="payment-info-row"><span>Fecha Vencimiento</span><strong style="color:${d<0?'var(--red)':'inherit'}">${fmtDate(l.dueDate)} · ${dLbl}</strong></div>
      <div class="payment-info-row"><span>Pagado</span><strong style="color:var(--green)">S/ ${fmt(l.paidAmount)}</strong></div>
      <div class="payment-info-row"><span>Pendiente</span><strong style="color:${l.pendingAmount>0?'var(--red)':'var(--green)'}">S/ ${fmt(l.pendingAmount)}</strong></div>
      <div class="payment-info-row"><span>Estado</span><strong><span class="status-badge status-${l.status}">${l.status}</span></strong></div>
      ${l.notes?`<div class="payment-info-row"><span>Notas</span><strong>${l.notes}</strong></div>`:''}
    </div>
    ${l.months>1?`<div class="multi-note" style="margin-bottom:20px"><strong>Interés mensual:</strong> S/ ${fmt(l.amount*(l.interestRate||0.20))}/mes sobre capital S/ ${fmt(l.amount)}</div>`:''}
    ${l.payments.length?`<h4 style="font-size:14px;font-weight:600;color:var(--text2);margin-bottom:10px">Pagos (${l.payments.length})</h4>${l.payments.map((p,i)=>`<div class="payment-entry"><span>#${i+1} · ${fmtDate(p.date)} · ${p.type || 'PARCIAL'}${p.extensionMonths ? ' · +' + p.extensionMonths + ' mes(es)' : ''}${p.note?' · '+p.note:''}</span><strong>+ S/ ${fmt(p.amount)}</strong><button class="mini-link" onclick="generatePaymentReceiptPDF('${id}','${p.id}')">Comprobante</button><button class="mini-link" onclick="openEditPayment('${p.id}','${id}')">Editar</button></div>`).join('')}`:'<p style="color:var(--text3);font-size:13px">Sin pagos registrados</p>'}
    <div class="modal-footer" style="margin-top:20px"><button class="btn-back" onclick="generateContractPDF('${l.id}')">Contrato</button>${l.debtorPhone?`<button class="btn-back" onclick="openWhatsApp('${l.id}')">WhatsApp</button>`:''}${l.status!=='PAGADO'?`<button class="btn-back" onclick="closeModal('detailModal');openPayment('${l.id}','INTERES')">Extender plazo</button><button class="btn-save" onclick="closeModal('detailModal');openPayment('${l.id}')">Registrar pago</button>`:''}</div>`;
  showModal('detailModal');
}

// ─── PRESTAMISTAS ─────────────────────────────
function renderLenders() {
  const colors=['#f0b429','#22c55e','#3b82f6','#f97316','#a855f7','#ec4899','#14b8a6'];
  document.getElementById('lendersGrid').innerHTML = lenders.map((l,i)=>{
    const ll=loans.filter(x=>x.lender===l.name);
    return `<div class="lender-card">
      <div class="lender-avatar" style="background:${colors[i%colors.length]}">${l.name[0]}</div>
      <div class="lender-name">${l.name}</div>
      <div class="lender-stats">
        <div class="lender-stat"><span>Total</span><strong>${ll.length}</strong></div>
        <div class="lender-stat"><span>Activos</span><strong>${ll.filter(x=>x.status!=='PAGADO').length}</strong></div>
        <div class="lender-stat"><span>Pendiente</span><strong style="color:var(--accent)">S/${fmt(ll.reduce((s,x)=>s+x.pendingAmount,0))}</strong></div>
      </div>
    </div>`;
  }).join('');
}
function openLenderModal() { document.getElementById('lenderName').value=''; document.getElementById('errLenderName').textContent=''; showModal('lenderModal'); }
async function saveLender() {
  const name=document.getElementById('lenderName').value.trim().toUpperCase();
  if(!name){document.getElementById('errLenderName').textContent='Ingresa un nombre';return;}
  if(lenders.find(l=>l.name===name)){document.getElementById('errLenderName').textContent='Ya existe';return;}
  try { await dbInsertLender(name); await loadLenders(); renderLenders(); populateLenderDropdowns(); closeModal('lenderModal'); toast('Prestamista agregado','success'); }
  catch(err){ document.getElementById('errLenderName').textContent=err.message; }
}
function populateLenderDropdowns() {
  document.getElementById('fLender').innerHTML='<option value="">Seleccionar prestamista...</option>'+lenders.map(l=>`<option value="${l.name}">${l.name}</option>`).join('');
}



// ─── DEUDORES ─────────────────────────────────
function renderDebtors() {
  const el = document.getElementById('debtorsGrid'); if (!el) return;
  const q = (document.getElementById('debtorSearch')?.value || '').toLowerCase();
  const list = debtors.filter(d =>!q || d.name.toLowerCase().includes(q) || d.phone.includes(q) || d.dni.includes(q));
  el.innerHTML = list.length ? list.map(d =>{
    const dl = loans.filter(l =>l.debtor.toUpperCase() === d.name);
    const pending = dl.reduce((s,l)=>s+l.pendingAmount,0);
    return `<div class="lender-card debtor-card">
      <div class="lender-avatar">${d.name[0]}</div>
      <div class="lender-name">${d.name}</div>
      <div class="debtor-meta">${d.dni ? 'DNI: '+d.dni+' · ' : ''}${d.phone || 'Sin teléfono'}</div>
      ${d.address ? `<div class="debtor-meta">${d.address}</div>` : ''}
      <div class="lender-stats">
        <div class="lender-stat"><span>Préstamos</span><strong>${dl.length}</strong></div>
        <div class="lender-stat"><span>Pendiente</span><strong style="color:var(--accent)">S/ ${fmt(pending)}</strong></div>
      </div>
      <button class="action-btn" onclick="openDebtorModal('${d.id}')">Editar</button>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon"></div><p>No hay deudores registrados</p></div>';
}

function openDebtorModal(id='') {
  const d = debtors.find(x =>x.id === id) || { id:'', name:'', phone:'', dni:'', address:'', notes:'' };
  document.getElementById('debtorId').value = d.id;
  document.getElementById('debtorName').value = d.name;
  document.getElementById('debtorPhone').value = d.phone;
  document.getElementById('debtorDni').value = d.dni;
  document.getElementById('debtorAddress').value = d.address;
  document.getElementById('debtorNotes').value = d.notes;
  document.getElementById('errDebtorName').textContent = '';
  showModal('debtorModal');
}

async function saveDebtor() {
  const id = document.getElementById('debtorId').value;
  const oldName = debtors.find(x =>x.id === id)?.name || '';
  const name = normalizeText(document.getElementById('debtorName').value);
  if (!name) { document.getElementById('errDebtorName').textContent = 'Ingresa el nombre'; return; }
  try {
    await dbUpsertDebtor({
      id, name,
      phone: document.getElementById('debtorPhone').value.trim(),
      dni: document.getElementById('debtorDni').value.trim(),
      address: document.getElementById('debtorAddress').value.trim(),
      notes: document.getElementById('debtorNotes').value.trim()
    });
    if (id && oldName && oldName !== name) {
      await sb.from('prestamos').update({ deudor: name, deudor_id: id }).eq('deudor_id', id);
      await sb.from('prestamos').update({ deudor: name, deudor_id: id }).ilike('deudor', oldName);
      await logAction('EDITÓ DEUDOR', id, `${oldName} =>${name}`);
    }
    await loadDebtors(); await loadLoans(); renderDebtors(); populateDebtorDatalist(); closeModal('debtorModal'); toast('Deudor guardado','success');
  } catch(err) { document.getElementById('errDebtorName').textContent = err.message; }
}

function populateDebtorDatalist() {
  const el = document.getElementById('debtorOptions'); if (!el) return;
  el.innerHTML = debtors.map(d =>`<option value="${d.name}">${d.phone || d.dni || ''}</option>`).join('');
}


function openWhatsApp(id) {
  const l = loans.find(x =>x.id === id); if (!l) return;
  const phone = (l.debtorPhone || '').replace(/\D/g, '');
  if (!phone) { toast('Este deudor no tiene teléfono registrado', 'error'); return; }
  const pePhone = phone.startsWith('51') ? phone : '51' + phone;
  const msg = `Hola ${l.debtor}, te saludamos de ${COMPANY_NAME}. Te recordamos que tienes un saldo pendiente de S/ ${fmt(l.pendingAmount)} con fecha de pago ${fmtDate(l.dueDate)}. Gracias.`;
  window.open(`https://wa.me/${pePhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

async function deleteLoan(id) {
  const l = loans.find(x =>x.id === id); if (!l) return;
  if (!confirm(`¿Eliminar préstamo de ${l.debtor}? No se borra de la base: queda como eliminado.`)) return;
  try {
    await dbSoftDeleteLoan(id);
    toast('Eliminar Préstamo ocultado correctamente', 'success');
    await loadLoans(); renderLoans(); renderDashboard();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function exportLoansCSV() {
  const rows = loans.map(l =>({
    prestamista: l.lender, deudor: l.debtor, fecha_prestamo: l.loanDate, fecha_pago: l.dueDate,
    capital: l.amount, interes_total: l.totalInterest, total: l.totalDue,
    pagado: l.paidAmount, pendiente: l.pendingAmount, estado: l.status, notas: l.notes
  }));
  downloadCSV(rows, 'prestamos.csv');
}

function exportPaymentsCSV() {
  const rows = loans.flatMap(l =>l.payments.map(p =>({
    prestamo_id: l.id, deudor: l.debtor, prestamista: l.lender, fecha_pago: p.date, monto: p.amount, nota: p.note
  })));
  downloadCSV(rows, 'pagos.csv');
}

function backupJSON() {
  downloadBlob(JSON.stringify({ empresa: COMPANY_NAME, prestamos: loans, deudores, prestamistas: lenders, solicitudes: loanRequests, exportado_en: new Date().toISOString() }, null, 2), 'backup-tusocio-financiero.json', 'application/json');
}

function downloadCSV(rows, filename) {
  if (!rows.length) { toast('No hay datos para exportar', 'error'); return; }
  const cols = Object.keys(rows[0]);
  const esc = v =>`"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map(r =>cols.map(c =>esc(r[c])).join(','))].join('\n');
  downloadBlob(csv, filename, 'text/csv;charset=utf-8;');
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}


// ─── PDFs: CONTRATO Y COMPROBANTE ─────────────
function getPDFDoc() {
  if (!window.jspdf?.jsPDF) {
    toast('No se pudo cargar jsPDF. Revisa tu conexión a internet.', 'error');
    return null;
  }
  const { jsPDF } = window.jspdf;
  return new jsPDF({ unit: 'mm', format: 'a4' });
}

function pdfSafe(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function pdfMoney(v) { return `S/ ${fmt(Number(v || 0))}`; }
function pdfFileName(prefix, name) {
  return `${prefix}-${normalizeText(name).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'DOCUMENTO'}.pdf`;
}
function addWrapped(doc, text, x, y, maxWidth = 178, lineHeight = 6) {
  const lines = doc.splitTextToSize(pdfSafe(text), maxWidth);
  doc.text(lines, x, y);
  return y + (lines.length * lineHeight);
}
function debtorExtra(l) {
  const d = debtors.find(x =>x.id === l.debtorId || normalizeText(x.name) === normalizeText(l.debtor));
  return d || { dni: '', phone: '', address: '', notes: '' };
}
function drawPDFHeader(doc, title) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(COMPANY_NAME, 16, 17);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(COMPANY_SLOGAN, 16, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(title, 105, 38, { align: 'center' });
  doc.setDrawColor(40);
  doc.line(16, 43, 194, 43);
}
function drawPDFSignatures(doc, y) {
  const base = Math.max(y, 250);
  doc.line(25, base, 85, base);
  doc.line(125, base, 185, base);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Firma autorizada de la empresa', 55, base + 7, { align: 'center' });
  doc.text('Firma del deudor', 155, base + 7, { align: 'center' });
}

function generateContractPDF(loanId) {
  const l = loans.find(x =>x.id === loanId);
  if (!l) return toast('No se encontro el prestamo', 'error');
  const doc = getPDFDoc(); if (!doc) return;
  const d = debtorExtra(l);
  drawPDFHeader(doc, 'CONTRATO DE PRESTAMO');

  let y = 54;
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  y = addWrapped(doc, `Conste por el presente documento el contrato de prestamo que celebran, de una parte ${COMPANY_NAME}, en calidad de LA EMPRESA ACREEDORA; y de la otra parte ${l.debtor}${d.dni ? ', identificado(a) con DNI ' + d.dni : ''}${d.address ? ', con domicilio en ' + d.address : ''}, en calidad de DEUDOR(A), bajo las siguientes condiciones:`, 16, y);

  y += 4;
  const rows = [
    ['Empresa', COMPANY_NAME],
    ['Fecha de prestamo', fmtDate(l.loanDate)],
    ['Fecha de vencimiento / pago', fmtDate(l.dueDate)],
    ['Capital prestado', pdfMoney(l.amount)],
    ['Capital actual', pdfMoney(l.capitalCurrent || l.amount)],
    ['Interes mensual', `${fmt((l.interestRate || 0) * 100)}%`],
    ['Interes total', pdfMoney(l.totalInterest)],
    ['Total a pagar', pdfMoney(l.totalDue)],
    ['Plazo vigente', `${l.months} mes${l.months === 1 ? '' : 'es'}`],
    ['Meses extendidos', `${l.extendedMonths || 0}`],
    ['Monto pagado a la fecha', pdfMoney(l.paidAmount)],
    ['Saldo pendiente', pdfMoney(l.pendingAmount)],
    ['Estado', l.status]
  ];
  doc.setFontSize(10);
  rows.forEach(([k,v]) =>{
    doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, 20, y);
    doc.setFont('helvetica', 'normal'); doc.text(pdfSafe(v), 75, y);
    y += 7;
  });

  y += 4;
  doc.setFont('helvetica', 'bold'); doc.text('CLAUSULAS:', 16, y); y += 8;
  doc.setFont('helvetica', 'normal');
  y = addWrapped(doc, `1. EL DEUDOR declara haber recibido de ${COMPANY_NAME} el capital indicado, obligandose a devolver el total pactado en la fecha de vencimiento senalada.`, 16, y);
  y += 2;
  y = addWrapped(doc, `2. Los pagos parciales seran descontados del saldo pendiente y quedaran registrados en el sistema como historial de pagos del prestamo.`, 16, y);
  y += 2;
  y = addWrapped(doc, `3. En caso de retraso, el prestamo podra figurar como vencido hasta la cancelacion o regularizacion correspondiente.`, 16, y);
  if (l.notes) { y += 3; y = addWrapped(doc, `Observaciones: ${l.notes}`, 16, y); }

  doc.setFontSize(10);
  doc.text(`Emitido el ${fmtDate(new Date().toISOString().split('T')[0])}`, 16, 235);
  drawPDFSignatures(doc, y + 15);
  doc.save(pdfFileName('contrato', l.debtor));
  logAction('GENERÓ CONTRATO PDF', loanId, l.debtor).catch(()=>{});
}

function generatePaymentReceiptPDF(loanId, paymentId) {
  const l = loans.find(x =>x.id === loanId);
  if (!l) return toast('No se encontro el prestamo', 'error');
  const p = l.payments.find(x =>x.id === paymentId);
  if (!p) return toast('No se encontro el pago', 'error');
  const doc = getPDFDoc(); if (!doc) return;
  const number = String(l.payments.findIndex(x =>x.id === paymentId) + 1).padStart(3, '0');
  drawPDFHeader(doc, 'COMPROBANTE DE PAGO');

  let y = 56;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold'); doc.text(`Comprobante Nro: ${number}`, 16, y); y += 10;
  doc.setFontSize(10.5);
  const rows = [
    ['Fecha de pago', fmtDate(p.date)],
    ['Deudor', l.debtor],
    ['Empresa', COMPANY_NAME],
    ['Monto recibido', pdfMoney(p.amount)],
    ['Tipo de pago', p.type || 'PARCIAL'],
    ['Meses extendidos', `${p.extensionMonths || 0}`],
    ['Interes generado por extension', pdfMoney(p.extensionInterest || 0)],
    ['Concepto', p.note || 'Pago parcial / amortizacion de prestamo'],
    ['Fecha de prestamo', fmtDate(l.loanDate)],
    ['Fecha de vencimiento', fmtDate(l.dueDate)],
    ['Total del prestamo', pdfMoney(l.totalDue)],
    ['Total pagado acumulado', pdfMoney(l.paidAmount)],
    ['Saldo pendiente', pdfMoney(l.pendingAmount)],
    ['Estado actual', l.status]
  ];
  rows.forEach(([k,v]) =>{
    doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, 20, y);
    doc.setFont('helvetica', 'normal'); doc.text(pdfSafe(v), 78, y);
    y += 8;
  });

  y += 8;
  doc.setFont('helvetica', 'normal');
  y = addWrapped(doc, `Se deja constancia de la recepcion del monto indicado, correspondiente al prestamo registrado a nombre de ${l.debtor}.`, 16, y);
  doc.text(`Emitido el ${fmtDate(new Date().toISOString().split('T')[0])}`, 16, 235);
  drawPDFSignatures(doc, y + 25);
  doc.save(pdfFileName(`comprobante-${number}`, l.debtor));
  logAction('GENERÓ COMPROBANTE PDF', loanId, `${l.debtor} / ${pdfMoney(p.amount)}`).catch(()=>{});
}

// ─── REPORTES ─────────────────────────────────
function generateReport() {
  const period=document.getElementById('reportPeriod').value, now=new Date();
  let f=loans;
  if(period==='month')   f=loans.filter(l=>{const d=new Date(l.loanDate);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
  if(period==='quarter') {const q=Math.floor(now.getMonth()/3);f=loans.filter(l=>{const d=new Date(l.loanDate);return Math.floor(d.getMonth()/3)===q&&d.getFullYear()===now.getFullYear();});}
  if(period==='year')    f=loans.filter(l=>new Date(l.loanDate).getFullYear()===now.getFullYear());
  const sum=k=>f.reduce((s,l)=>s+l[k],0);
  const byL={};
  f.forEach(l=>{if(!byL[l.lender])byL[l.lender]={count:0,capital:0,pending:0,collected:0};byL[l.lender].count++;byL[l.lender].capital+=l.amount;byL[l.lender].pending+=l.pendingAmount;byL[l.lender].collected+=l.paidAmount;});
  document.getElementById('reportContent').innerHTML = `
    <div class="report-grid">
      <div class="report-card"><div class="report-card-label">Total</div><div class="report-card-val">${f.length}</div></div>
      <div class="report-card"><div class="report-card-label">Capital</div><div class="report-card-val yellow">S/ ${fmt(sum('amount'))}</div></div>
      <div class="report-card"><div class="report-card-label">Interés</div><div class="report-card-val green">S/ ${fmt(sum('totalInterest'))}</div></div>
      <div class="report-card"><div class="report-card-label">Cobrado</div><div class="report-card-val green">S/ ${fmt(sum('paidAmount'))}</div></div>
      <div class="report-card"><div class="report-card-label">Pendiente</div><div class="report-card-val red">S/ ${fmt(sum('pendingAmount'))}</div></div>
      <div class="report-card"><div class="report-card-label">Vencidos</div><div class="report-card-val red">${f.filter(l=>l.status==='VENCIDO').length}</div></div>
    </div>
    <div class="dash-card"><h3>Por Prestamista</h3>
      <div class="table-wrap" style="border:none">
        <table class="loans-table" style="min-width:400px">
          <thead><tr><th>Prestamista</th><th>Préstamos</th><th>Capital</th><th>Cobrado</th><th>Pendiente</th></tr></thead>
          <tbody>${Object.entries(byL).map(([n,v])=>`<tr><td><strong>${n}</strong></td><td>${v.count}</td><td class="money">S/ ${fmt(v.capital)}</td><td class="money text-green">S/ ${fmt(v.collected)}</td><td class="money" style="color:var(--accent)">S/ ${fmt(v.pending)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ─── HELPERS ──────────────────────────────────
const showModal  = id =>document.getElementById(id).classList.remove('hidden');
const closeModal = id =>document.getElementById(id).classList.add('hidden');

function toast(msg, type='') {
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast'+(type?' '+type:''); el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'), 3500);
}

const fmt      = n =>Number(n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDate  = d =>{ if(!d)return'—'; return new Date(d+(d.includes('T')?'':'T00:00:00')).toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'}); };
const daysDiff = (from,to) =>Math.round((to-from)/(1000*60*60*24));
const daysLeft = d =>{ const t=new Date(); t.setHours(0,0,0,0); return daysDiff(t,new Date(d+'T00:00:00')); };
const statusColor = s =>({ACTIVO:{bg:'var(--blue-soft)',text:'var(--blue)'},PAGADO:{bg:'var(--green-soft)',text:'var(--green)'},VENCIDO:{bg:'var(--red-soft)',text:'var(--red)'},PARCIAL:{bg:'var(--orange-soft)',text:'var(--orange)'},PENDIENTE:{bg:'var(--orange-soft)',text:'var(--orange)'},EN_REVISION:{bg:'var(--blue-soft)',text:'var(--blue)'},OBSERVADO:{bg:'var(--red-soft)',text:'var(--red)'},APROBADA:{bg:'var(--green-soft)',text:'var(--green)'},DESEMBOLSADO:{bg:'var(--green-soft)',text:'var(--green)'},RECHAZADA:{bg:'var(--red-soft)',text:'var(--red)'}}[s]||{bg:'var(--bg3)',text:'var(--text2)'});
const statusEmoji = s => ({ ACTIVO:'AC', PAGADO:'OK', VENCIDO:'VE', PARCIAL:'PA' }[s] || '');

// ─── BOOT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () =>{
  applyBranding();
  if (location.hash === '#solicitar') { window.location.replace('./cliente.html#solicitar'); return; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  if ('Notification' in window && Notification.permission==='default') setTimeout(()=>Notification.requestPermission(), 2000);

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = {
      id:    session.user.id,
      email: session.user.email,
      name:  session.user.user_metadata?.name || session.user.email.split('@')[0].toUpperCase(),
      role:  session.user.user_metadata?.role || 'prestamista'
    };
    await startApp();
  }

  sb.auth.onAuthStateChange(async (event) =>{
    if (event === 'SIGNED_OUT') {
      document.getElementById('app').classList.add('hidden');
      document.getElementById('requestScreen').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
    }
  });
});
