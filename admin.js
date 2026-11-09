// =========================================================
// admin.js — Gestión de CUENTAS (Panel de administración · Liga Lombarda)
//
// - Alterna entre las vistas "Usuarios" (expedientes) y "Cuentas".
// - Crea cuentas de acceso (email + contraseña) sin cerrar la sesión del admin.
// - Define si la cuenta puede usar el formulario y a qué sección:
//   Lombardos, Inmigrantes o ambas.
// - Edita nombre interno, email y contraseña. La contraseña actual nunca se
//   puede ver (Firebase solo guarda un hash); solo se puede reemplazar.
//
// Estructura guardada en Realtime Database:
//   usuarios/{uid} = {
//     nombre, email, admin,
//     formulario: { acceso: true|false, lombardos: true|false, inmigrantes: true|false },
//     createdAt, createdBy, updatedAt
//   }
// =========================================================

import {
    auth,
    database,
    ref,
    set,
    update,
    remove,
    onValue
} from "./firebase-init.js";

// IMPORTANTE: usá la misma versión del SDK que está en tu firebase-init.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
    signOut as signOutSecundario
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// =========================================================
// CONFIG
// =========================================================
const FUNCTIONS_REGION = 'us-central1';          // región de tus Cloud Functions
const MIN_PASSWORD = 6;                          // mínimo que exige Firebase Auth
const SECONDARY_APP_NAME = 'cuentas-secundaria'; // app auxiliar para crear cuentas

// =========================================================
// REFERENCIAS DOM
// =========================================================
const $ = (id) => document.getElementById(id);

const viewUsuarios = $('viewUsuarios');
const viewCuentas = $('viewCuentas');
const adminTitle = $('adminTitle');
const adminDesc = $('adminDesc');
const viewTabs = document.querySelectorAll('.view-switch [data-view]');

const cuentasContainer = $('cuentasContainer');
const cuentasSearch = $('cuentasSearch');
const cuentasFilter = $('cuentasFilter');
const cuentaNewBtn = $('cuentaNewBtn');

const cuentaModal = $('cuentaModal');
const cuentaModalTitle = $('cuentaModalTitle');
const cuentaModalSubtitle = $('cuentaModalSubtitle');
const cuentaNombre = $('cuentaNombre');
const cuentaEmail = $('cuentaEmail');
const cuentaPassword = $('cuentaPassword');
const cuentaPassLabel = $('cuentaPassLabel');
const cuentaPassHint = $('cuentaPassHint');
const cuentaPassToggle = $('cuentaPassToggle');
const cuentaPassGen = $('cuentaPassGen');
const cuentaHashNote = $('cuentaHashNote');
const cuentaAcceso = $('cuentaAcceso');
const cuentaAccesoState = $('cuentaAccesoState');
const cuentaSeccionWrap = $('cuentaSeccionWrap');
const cuentaSeccionInputs = document.querySelectorAll('input[name="cuentaSeccion"]');
const cuentaModalCancel = $('cuentaModalCancel');
const cuentaModalSave = $('cuentaModalSave');

const cuentaDeleteModal = $('cuentaDeleteModal');
const cuentaDeleteName = $('cuentaDeleteName');
const cuentaDeleteCancel = $('cuentaDeleteCancel');
const cuentaDeleteConfirm = $('cuentaDeleteConfirm');

// =========================================================
// ESTADO
// =========================================================
let cuentasData = [];
let unsubscribeCuentas = null;
let adminUser = null;
let iniciado = false;
let editingUid = null;   // null = creando una cuenta nueva
let deleteUid = null;
let guardando = false;

// =========================================================
// UTILIDADES
// =========================================================
function toast(message, type = 'info', duration = 4000) {
    if (typeof window.showToast === 'function') window.showToast(message, type, duration);
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generarPassword(largo = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const arr = new Uint32Array(largo);
    crypto.getRandomValues(arr);
    return Array.from(arr, n => chars[n % chars.length]).join('');
}

// Traduce errores de Firebase Auth / Database / Functions a mensajes claros
function mensajeError(err) {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');

    const mapa = {
        'auth/email-already-in-use': 'Ya existe una cuenta con ese email.',
        'auth/invalid-email': 'El email no es válido.',
        'auth/weak-password': `La contraseña es muy débil (mínimo ${MIN_PASSWORD} caracteres).`,
        'auth/operation-not-allowed': 'El acceso con email y contraseña está desactivado en Firebase Authentication.',
        'auth/network-request-failed': 'Sin conexión con Firebase. Revisá tu internet.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá un momento y probá de nuevo.',
        'auth/user-not-found': 'No existe una cuenta con ese email.',
        'functions/unreachable': 'No se pudo contactar la Cloud Function. Verificá que esté desplegada.',
        'functions/404': 'La Cloud Function todavía no está desplegada.',
        'functions/NOT_FOUND': 'La Cloud Function todavía no está desplegada.',
        'functions/PERMISSION_DENIED': 'Tu cuenta no figura como administrador en el servidor.',
        'functions/UNAUTHENTICATED': 'Tu sesión expiró. Volvé a iniciar sesión.',
        'functions/ALREADY_EXISTS': 'Ya existe una cuenta con ese email.'
    };
    if (mapa[code]) return mapa[code];
    if (code === 'PERMISSION_DENIED' || msg.includes('PERMISSION_DENIED') || msg.toLowerCase().includes('permission denied')) {
        return 'La base de datos rechazó la operación. Revisá las reglas de "usuarios".';
    }
    return msg || 'Ocurrió un error inesperado.';
}

// =========================================================
// CAMBIO DE VISTA: USUARIOS / CUENTAS
// =========================================================
const VISTAS = {
    usuarios: {
        titulo: 'Gestión de Expedientes',
        icono: 'fa-shield-halved',
        desc: 'Visualizá, editá y eliminá expedientes del archivo central. Agregá antecedentes, notas internas y warns.'
    },
    cuentas: {
        titulo: 'Gestión de Cuentas',
        icono: 'fa-key',
        desc: 'Creá cuentas de acceso y definí si pueden usar el formulario y a qué sección. Las contraseñas están protegidas y no se pueden ver.'
    }
};

function setVista(nombre, { actualizarHash = true } = {}) {
    if (!VISTAS[nombre]) nombre = 'usuarios';
    const v = VISTAS[nombre];

    viewUsuarios.style.display = nombre === 'usuarios' ? '' : 'none';
    viewCuentas.style.display = nombre === 'cuentas' ? '' : 'none';

    viewTabs.forEach(btn => {
        const activo = btn.dataset.view === nombre;
        btn.classList.toggle('active', activo);
        btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });

    adminTitle.innerHTML = `<i class="fas ${v.icono}"></i> ${escapeHtml(v.titulo)}`;
    adminDesc.textContent = v.desc;

    if (actualizarHash) {
        try {
            history.replaceState(null, '', nombre === 'cuentas' ? '#cuentas' : location.pathname + location.search);
        } catch (e) { /* no crítico */ }
    }
}

viewTabs.forEach(btn => btn.addEventListener('click', () => setVista(btn.dataset.view)));
window.addEventListener('hashchange', () => {
    setVista(location.hash === '#cuentas' ? 'cuentas' : 'usuarios', { actualizarHash: false });
});
setVista(location.hash === '#cuentas' ? 'cuentas' : 'usuarios', { actualizarHash: false });

// =========================================================
// MODELO DE CUENTA
// =========================================================
function normalizarCuenta(uid, v) {
    v = v || {};
    const f = v.formulario || {};
    const acceso = f.acceso === true;
    return {
        uid,
        nombre: v.nombre || v.displayName || '',
        email: v.email || '',
        admin: v.admin === true,
        acceso,
        lombardos: acceso && f.lombardos === true,
        inmigrantes: acceso && f.inmigrantes === true,
        createdAt: v.createdAt || ''
    };
}

function getSeccionKey(c) {
    if (c.lombardos && c.inmigrantes) return 'ambas';
    if (c.lombardos) return 'lombardos';
    if (c.inmigrantes) return 'inmigrantes';
    return '';
}

function nombreVisible(c) {
    return c.nombre || c.email || c.uid;
}

// =========================================================
// CARGA EN TIEMPO REAL
// =========================================================
function cargarCuentas() {
    if (unsubscribeCuentas) unsubscribeCuentas();

    unsubscribeCuentas = onValue(ref(database, 'usuarios'), (snapshot) => {
        cuentasData = [];
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                cuentasData.push(normalizarCuenta(child.key, child.val()));
            });
            cuentasData.sort((a, b) => nombreVisible(a).localeCompare(nombreVisible(b), 'es', { sensitivity: 'base' }));
        }
        actualizarStatsCuentas();
        renderCuentas();
    }, (error) => {
        console.error('Error al cargar cuentas:', error);
        cuentasContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>No se pudieron cargar las cuentas</h3>
                <p>${escapeHtml(mensajeError(error))}</p>
            </div>
        `;
        toast('❌ Error al cargar cuentas', 'error', 4000);
    });
}

function actualizarStatsCuentas() {
    $('statCuentasTotal').textContent = cuentasData.length;
    $('statCuentasForm').textContent = cuentasData.filter(c => c.acceso).length;
    $('statCuentasSin').textContent = cuentasData.filter(c => !c.acceso).length;
    $('statCuentasAdmin').textContent = cuentasData.filter(c => c.admin).length;
}

// =========================================================
// FILTRO + RENDER
// =========================================================
function getCuentasFiltradas() {
    const q = cuentasSearch.value.trim().toLowerCase();
    const f = cuentasFilter.value;

    return cuentasData.filter(c => {
        if (f === 'con' && !c.acceso) return false;
        if (f === 'sin' && c.acceso) return false;
        if (f === 'lombardos' && !c.lombardos) return false;
        if (f === 'inmigrantes' && !c.inmigrantes) return false;
        if (f === 'ambas' && !(c.lombardos && c.inmigrantes)) return false;
        if (q) {
            const texto = `${c.nombre} ${c.email}`.toLowerCase();
            if (!texto.includes(q)) return false;
        }
        return true;
    });
}

function renderCuentas() {
    const lista = getCuentasFiltradas();

    if (lista.length === 0) {
        const total = cuentasData.length;
        cuentasContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-${total === 0 ? 'user-plus' : 'search'}"></i>
                <h3>${total === 0 ? 'Todavía no hay cuentas' : 'Sin resultados'}</h3>
                <p>${total === 0 ? 'Creá la primera con el botón NUEVA CUENTA.' : 'Probá con otros filtros o búsqueda.'}</p>
            </div>
        `;
        return;
    }

    const header = `
        <div class="cuentas-header">
            <span>Cuenta</span>
            <span>Formulario</span>
            <span>Secciones</span>
            <span>Contraseña</span>
            <span style="text-align:right;">Acciones</span>
        </div>`;

    const rows = lista.map(c => {
        const nombre = nombreVisible(c);
        const inicial = nombre.trim().charAt(0).toUpperCase() || '?';
        const esYo = adminUser && c.uid === adminUser.uid;

        const accesoBadge = c.acceso
            ? `<span class="badge badge-activo"><i class="fas fa-check"></i> Sí</span>`
            : `<span class="badge badge-inactivo"><i class="fas fa-xmark"></i> No</span>`;

        let seccionesHtml = '<span style="color:var(--text-soft);">—</span>';
        if (c.acceso) {
            const partes = [];
            if (c.lombardos) partes.push(`<span class="badge badge-ciudadano"><i class="fas fa-user-shield"></i> Lombardos</span>`);
            if (c.inmigrantes) partes.push(`<span class="badge badge-inmigrante"><i class="fas fa-passport"></i> Inmigrantes</span>`);
            seccionesHtml = partes.length
                ? partes.join('')
                : '<span style="color:var(--text-soft);">Sin sección asignada</span>';
        }

        const adminBadge = c.admin
            ? `<span class="badge badge-admin"><i class="fas fa-crown"></i> Admin</span>`
            : '';
        const yoBadge = esYo
            ? `<span class="badge badge-inactivo">Vos</span>`
            : '';

        return `
            <div class="cuenta-row" data-uid="${escapeHtml(c.uid)}">
                <div class="cell-name">
                    <div class="cuenta-avatar" aria-hidden="true">${escapeHtml(inicial)}</div>
                    <div class="name-info">
                        <div class="cuenta-title">
                            <strong>${escapeHtml(nombre)}</strong>${adminBadge}${yoBadge}
                        </div>
                        <small title="${escapeHtml(c.email || c.uid)}"><i class="fas fa-envelope"></i> ${escapeHtml(c.email || 'Sin email registrado')}</small>
                    </div>
                </div>
                <div class="cuenta-cell" data-label="Formulario">${accesoBadge}</div>
                <div class="cuenta-cell" data-label="Secciones">${seccionesHtml}</div>
                <div class="cuenta-cell" data-label="Contraseña">
                    <span class="pass-mask" title="Protegida (hash). No se puede ver.">••••••••</span>
                    <i class="fas fa-lock" style="font-size:11px;color:var(--text-soft);"></i>
                </div>
                <div class="cell-actions">
                    <button class="action-btn edit" title="Editar cuenta" data-caction="edit" data-uid="${escapeHtml(c.uid)}">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="action-btn view" title="Enviar mail para restablecer contraseña" data-caction="reset" data-uid="${escapeHtml(c.uid)}" ${c.email ? '' : 'disabled'}>
                        <i class="fas fa-envelope"></i>
                    </button>
                    ${(c.admin || esYo) ? '' : `<button class="action-btn delete" title="Eliminar cuenta" data-caction="delete" data-uid="${escapeHtml(c.uid)}">
                        <i class="fas fa-trash"></i>
                    </button>`}
                </div>
            </div>
        `;
    }).join('');

    cuentasContainer.innerHTML = header + rows;
}

cuentasContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-caction]');
    if (!btn || btn.disabled) return;
    const uid = btn.dataset.uid;
    const accion = btn.dataset.caction;
    if (accion === 'edit') abrirCuentaModal(uid);
    else if (accion === 'reset') enviarReset(uid);
    else if (accion === 'delete') abrirDeleteCuenta(uid);
});

cuentasSearch.addEventListener('input', renderCuentas);
cuentasFilter.addEventListener('change', renderCuentas);

// =========================================================
// MODAL CREAR / EDITAR CUENTA
// =========================================================
function setPassVisible(visible) {
    cuentaPassword.type = visible ? 'text' : 'password';
    cuentaPassToggle.innerHTML = `<i class="fas fa-eye${visible ? '-slash' : ''}"></i>`;
}

function sincronizarAccesoUI() {
    const on = cuentaAcceso.checked;
    cuentaAccesoState.textContent = on ? 'Sí' : 'No';
    cuentaSeccionWrap.classList.toggle('disabled', !on);
    cuentaSeccionInputs.forEach(i => { i.disabled = !on; });
}

function getSeccionElegida() {
    const el = document.querySelector('input[name="cuentaSeccion"]:checked');
    return el ? el.value : 'lombardos';
}

function setSeccionElegida(valor) {
    cuentaSeccionInputs.forEach(i => { i.checked = i.value === valor; });
}

function abrirCuentaModal(uid = null) {
    const c = uid ? cuentasData.find(x => x.uid === uid) : null;
    if (uid && !c) return;

    editingUid = uid;
    setPassVisible(false);
    cuentaPassword.value = '';

    if (c) {
        cuentaModalTitle.innerHTML = '<i class="fas fa-user-pen"></i> Editar cuenta';
        cuentaModalSubtitle.textContent = c.email || c.uid;
        cuentaNombre.value = c.nombre || '';
        cuentaEmail.value = c.email || '';
        cuentaPassLabel.innerHTML = '<i class="fas fa-lock"></i> Nueva contraseña';
        cuentaPassHint.textContent = 'Dejalo vacío para mantener la actual.';
        cuentaHashNote.style.display = '';
        cuentaAcceso.checked = c.acceso;
        setSeccionElegida(getSeccionKey(c) || 'lombardos');
        cuentaModalSave.innerHTML = '<i class="fas fa-save"></i> GUARDAR CAMBIOS';
    } else {
        cuentaModalTitle.innerHTML = '<i class="fas fa-user-plus"></i> Nueva cuenta';
        cuentaModalSubtitle.textContent = 'Se crea con email y contraseña';
        cuentaNombre.value = '';
        cuentaEmail.value = '';
        cuentaPassLabel.innerHTML = '<i class="fas fa-lock"></i> Contraseña';
        cuentaPassHint.textContent = `Mínimo ${MIN_PASSWORD} caracteres.`;
        cuentaHashNote.style.display = 'none';
        cuentaAcceso.checked = false;
        setSeccionElegida('lombardos');
        cuentaModalSave.innerHTML = '<i class="fas fa-user-plus"></i> CREAR CUENTA';
    }

    sincronizarAccesoUI();
    cuentaModal.classList.add('visible');
    setTimeout(() => cuentaNombre.focus(), 100);
}

function cerrarCuentaModal() {
    if (guardando) return;
    cuentaModal.classList.remove('visible');
    cuentaPassword.value = '';
    setPassVisible(false);
    editingUid = null;
}

cuentaNewBtn.addEventListener('click', () => abrirCuentaModal(null));
cuentaModalCancel.addEventListener('click', cerrarCuentaModal);
cuentaModal.addEventListener('click', (e) => { if (e.target === cuentaModal) cerrarCuentaModal(); });
cuentaAcceso.addEventListener('change', sincronizarAccesoUI);
cuentaPassToggle.addEventListener('click', () => setPassVisible(cuentaPassword.type === 'password'));
cuentaPassGen.addEventListener('click', () => {
    cuentaPassword.value = generarPassword(12);
    setPassVisible(true);
    cuentaPassword.focus();
});

// =========================================================
// FIREBASE: crear cuenta sin cerrar la sesión del admin
// Usa una segunda instancia de la app: así el admin sigue logueado.
// =========================================================
function getSecondaryAuth() {
    const app = getApps().find(a => a.name === SECONDARY_APP_NAME)
        || initializeApp({ ...auth.app.options }, SECONDARY_APP_NAME);
    return getAuth(app);
}

async function crearCuenta({ nombre, email, password, formulario }) {
    const secAuth = getSecondaryAuth();
    const cred = await createUserWithEmailAndPassword(secAuth, email, password);
    const uid = cred.user.uid;

    try { await updateProfile(cred.user, { displayName: nombre }); }
    catch (e) { console.warn('No se pudo guardar displayName:', e); }

    try { await signOutSecundario(secAuth); }
    catch (e) { console.warn('No se pudo cerrar la sesión auxiliar:', e); }

    try {
        await set(ref(database, `usuarios/${uid}`), {
            nombre,
            email,
            admin: false,
            formulario,
            createdAt: new Date().toISOString(),
            createdBy: adminUser?.uid || null
        });
    } catch (e) {
        e.cuentaCreadaSinRegistro = true;
        throw e;
    }
    return uid;
}

// =========================================================
// FIREBASE: editar email / contraseña / eliminar (requiere Cloud Function)
// El SDK web no permite modificar a OTRO usuario: eso solo lo puede hacer
// el Admin SDK, por eso se llama a una función "callable" por HTTPS.
// =========================================================
async function llamarFuncionAdmin(nombre, data) {
    const user = auth.currentUser;
    if (!user) {
        const err = new Error('Tu sesión expiró.');
        err.code = 'functions/UNAUTHENTICATED';
        throw err;
    }
    const token = await user.getIdToken();
    const projectId = auth.app.options.projectId;
    const url = `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${nombre}`;

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ data })
        });
    } catch (e) {
        const err = new Error('No se pudo contactar la Cloud Function.');
        err.code = 'functions/unreachable';
        throw err;
    }

    let json = null;
    try { json = await res.json(); } catch (e) { /* respuesta sin JSON */ }

    if (!res.ok || json?.error) {
        const err = new Error(json?.error?.message || `Error ${res.status}`);
        err.code = `functions/${json?.error?.status || res.status}`;
        throw err;
    }
    return json?.result;
}

async function editarCuenta({ uid, nombre, email, password, formulario }, original) {
    const emailCambio = email !== (original.email || '').toLowerCase();
    const passCambio = !!password;

    if (emailCambio || passCambio) {
        const payload = { uid, displayName: nombre };
        if (emailCambio) payload.email = email;
        if (passCambio) payload.password = password;
        await llamarFuncionAdmin('adminUpdateUser', payload);
    }

    await update(ref(database, `usuarios/${uid}`), {
        nombre,
        email,
        formulario,
        updatedAt: new Date().toISOString()
    });
}

// =========================================================
// GUARDAR (crear o editar)
// =========================================================
cuentaModalSave.addEventListener('click', async () => {
    if (guardando) return;

    const nombre = cuentaNombre.value.trim();
    const email = cuentaEmail.value.trim().toLowerCase();
    const password = cuentaPassword.value;
    const acceso = cuentaAcceso.checked;
    const seccion = getSeccionElegida();
    const creando = !editingUid;

    if (!nombre) return toast('❌ Escribí un nombre para la cuenta', 'error', 3000);
    if (!emailValido(email)) return toast('❌ Escribí un email válido', 'error', 3000);
    if (creando && password.length < MIN_PASSWORD) {
        return toast(`❌ La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, 'error', 3500);
    }
    if (!creando && password && password.length < MIN_PASSWORD) {
        return toast(`❌ La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, 'error', 3500);
    }

    const formulario = {
        acceso,
        lombardos: acceso && (seccion === 'lombardos' || seccion === 'ambas'),
        inmigrantes: acceso && (seccion === 'inmigrantes' || seccion === 'ambas')
    };

    const original = creando ? null : cuentasData.find(x => x.uid === editingUid);
    if (!creando && !original) return toast('❌ No se encontró la cuenta', 'error', 3000);

    guardando = true;
    cuentaModalSave.disabled = true;
    const htmlOriginal = cuentaModalSave.innerHTML;
    cuentaModalSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GUARDANDO...';

    try {
        if (creando) {
            await crearCuenta({ nombre, email, password, formulario });
            toast('✅ Cuenta creada correctamente', 'success', 3000);
        } else {
            await editarCuenta({ uid: editingUid, nombre, email, password, formulario }, original);
            toast('✅ Cuenta actualizada correctamente', 'success', 3000);
        }
        guardando = false;
        cerrarCuentaModal();
    } catch (error) {
        console.error('Error al guardar la cuenta:', error);
        if (error?.cuentaCreadaSinRegistro) {
            toast('⚠️ La cuenta se creó, pero no se pudo guardar su registro. Revisá las reglas de la base de datos.', 'error', 6000);
            guardando = false;
            cerrarCuentaModal();
        } else {
            toast(`❌ ${mensajeError(error)}`, 'error', 5000);
        }
    } finally {
        guardando = false;
        cuentaModalSave.disabled = false;
        cuentaModalSave.innerHTML = htmlOriginal;
    }
});

// =========================================================
// RESTABLECER CONTRASEÑA POR MAIL (funciona sin Cloud Functions)
// =========================================================
async function enviarReset(uid) {
    const c = cuentasData.find(x => x.uid === uid);
    if (!c || !c.email) return toast('❌ Esta cuenta no tiene email registrado', 'error', 3000);
    if (!confirm(`¿Enviar un mail para restablecer la contraseña a ${c.email}?`)) return;

    try {
        await sendPasswordResetEmail(getSecondaryAuth(), c.email);
        toast(`📧 Mail enviado a ${c.email}`, 'success', 3500);
    } catch (error) {
        console.error('Error al enviar mail de restablecimiento:', error);
        toast(`❌ ${mensajeError(error)}`, 'error', 5000);
    }
}

// =========================================================
// ELIMINAR CUENTA
// =========================================================
function abrirDeleteCuenta(uid) {
    const c = cuentasData.find(x => x.uid === uid);
    if (!c || c.admin || (adminUser && c.uid === adminUser.uid)) return;
    deleteUid = uid;
    cuentaDeleteName.textContent = `${nombreVisible(c)}${c.email && c.nombre ? ` (${c.email})` : ''}`;
    cuentaDeleteModal.classList.add('visible');
}

function cerrarDeleteCuenta() {
    cuentaDeleteModal.classList.remove('visible');
    deleteUid = null;
}

cuentaDeleteCancel.addEventListener('click', cerrarDeleteCuenta);
cuentaDeleteModal.addEventListener('click', (e) => { if (e.target === cuentaDeleteModal) cerrarDeleteCuenta(); });

cuentaDeleteConfirm.addEventListener('click', async () => {
    if (!deleteUid) return;
    const uid = deleteUid;
    const btn = cuentaDeleteConfirm;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ELIMINANDO...';

    try {
        // 1) Borra la cuenta de acceso (Authentication)
        await llamarFuncionAdmin('adminDeleteUser', { uid });
        // 2) Borra el registro y los permisos
        await remove(ref(database, `usuarios/${uid}`));
        toast('🗑️ Cuenta eliminada', 'success', 3000);
        cerrarDeleteCuenta();
    } catch (error) {
        console.error('Error al eliminar la cuenta:', error);
        toast(`❌ ${mensajeError(error)} Para bloquearla ya, editá la cuenta y poné "No" en el acceso.`, 'error', 6500);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> ELIMINAR';
    }
});

// =========================================================
// ARRANQUE: espera a que admin.html confirme que el usuario es admin
// =========================================================
function iniciar(user) {
    if (iniciado || !user) return;
    iniciado = true;
    adminUser = user;
    cargarCuentas();
}

window.addEventListener('admin-ready', (e) => iniciar(e.detail?.user));
if (window.__adminUser) iniciar(window.__adminUser);
