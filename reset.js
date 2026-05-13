const SUPABASE_URL = window.PRESTACONTROL_CONFIG?.SUPABASE_URL || 'https://dzemddtxlywwyarkgpng.supabase.co';
const SUPABASE_ANON_KEY = window.PRESTACONTROL_CONFIG?.SUPABASE_ANON_KEY || 'sb_publishable_N5Fm-nUMpxO_8ihhu163aw_pMhKDiiK';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const $ = id => document.getElementById(id);

function showError(message, type = 'error') {
  const el = $('resetError');
  el.textContent = message;
  el.classList.remove('hidden', 'info-box', 'error-box');
  el.classList.add(type === 'success' || type === 'info' ? 'info-box' : 'error-box');
}

async function updatePassword() {
  const password = $('newPassword').value || '';
  const confirm = $('confirmPassword').value || '';

  if (password.length < 6) return showError('La contraseña debe tener mínimo 6 caracteres.');
  if (password !== confirm) return showError('Las contraseñas no coinciden.');

  const btn = $('btnReset');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    showError('Contraseña actualizada. Ya puedes iniciar sesión.', 'success');
    setTimeout(() => { window.location.href = 'cliente.html#cuenta'; }, 1500);
  } catch (ex) {
    showError('No se pudo actualizar la contraseña: ' + ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar nueva contraseña';
  }
}

window.updatePassword = updatePassword;
