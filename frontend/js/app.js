// ===== CONFIGURACIÓN =====
const API_URL = 'http://localhost:5000/api';
let socket;
let charts = {};
let datosAnteriores = {
    ventasTotales: 0,
    ventasMes: 0,
    totalVentas: 0
};

// Productos por categoría
const productosPorCategoria = {
    'Tableros Eléctricos': ['Tablero Adosado','Tablero ByPass', 'Tablero Autosoportado', 'Tablero Empotrado','Otro'],
    'Gabinetes Metálicos': ['Gabinete Adosado', 'Gabinete Empotrado','Gabinete Autosoportado', 'Caja de Paso', 'Armario Eléctrico', 'Otro'],
    'Servicios': ['Instalación Eléctrica', 'Mantenimiento', 'Modificación de tablero', 'Diseño de Proyectos', 'Pruebas y Puesta en Marcha'],
    'Otros': ['Cableado', 'Caja de tranformador', 'Accesorios Eléctricos', 'Otros Productos']
};

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    initCharts();
    loadDashboard();
    loadClientesSelect();
    setDefaultDates();
    cargarAniosDisponibles();
    
    // Configurar mes actual en meta
    document.getElementById('metaMes').value = new Date().getMonth() + 1;
});

// ===== WEBSOCKET =====
function initSocket() {
    socket = io('http://localhost:5000');
    
    socket.on('connect', () => {
        updateConnectionStatus(true);
        showNotification('Conectado al servidor', 'info');
    });
    
    socket.on('disconnect', () => {
        updateConnectionStatus(false);
    });
    
    socket.on('nueva_venta', (data) => {
        showNotification(`🛒 ${data.correlativo}: S/ ${data.monto.toFixed(2)}`, 'success');
        actualizarDashboardSimultaneo();
    });
    
    socket.on('actualizar_dashboard', () => {
        loadDashboard();
    });
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('connectionDot');
    const text = document.getElementById('connectionText');
    
    if (connected) {
        dot.style.background = 'var(--success)';
        text.textContent = 'Conectado';
    } else {
        dot.style.background = 'var(--danger)';
        text.textContent = 'Desconectado';
    }
}

// ===== NAVEGACIÓN =====
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu li').forEach(l => l.classList.remove('active'));
    
    document.getElementById(sectionId).classList.add('active');
    event.target.closest('li').classList.add('active');
    
    const titles = {
        'dashboard': 'Dashboard',
        'ventas': 'Gestión de Ventas',
        'clientes': 'Gestión de Clientes',
        'metas': 'Metas de Ventas',
        'reportes': 'Reportes'
    };
    document.getElementById('pageTitle').textContent = titles[sectionId];
    
    if (sectionId === 'ventas') loadVentas();
    if (sectionId === 'clientes') loadClientes();
    if (sectionId === 'metas') loadMetas();
}

// ===== DASHBOARD CON ACTUALIZACIÓN SIMULTÁNEA =====
async function loadDashboard() {
    try {
        const stats = await fetch(`${API_URL}/estadisticas/dashboard`).then(r => r.json());
        
        // Guardar valores anteriores para calcular tendencias
        const prevTotal = datosAnteriores.ventasTotales;
        const prevMes = datosAnteriores.ventasMes;
        const prevCantidad = datosAnteriores.totalVentas;
        
        // Actualizar KPIs con formato de soles
        document.getElementById('ventasTotales').textContent = formatSoles(stats.ventas_totales);
        document.getElementById('ventasMes').textContent = formatSoles(stats.ventas_mes_actual);
        document.getElementById('totalClientes').textContent = stats.total_clientes;
        document.getElementById('totalVentas').textContent = stats.total_ventas;
        
        // Calcular y mostrar tendencias
        actualizarTendencia('trendTotal', stats.ventas_totales, prevTotal);
        actualizarTendencia('trendMes', stats.ventas_mes_actual, prevMes);
        actualizarTendencia('trendVentas', stats.total_ventas, prevCantidad, false);
        
        // Guardar valores actuales
        datosAnteriores = {
            ventasTotales: stats.ventas_totales,
            ventasMes: stats.ventas_mes_actual,
            totalVentas: stats.total_ventas
        };
        
        // Actualizar meta
        document.getElementById('metaMonto').textContent = `Meta: ${formatSoles(stats.meta_mes)}`;
        document.getElementById('metaActual').textContent = formatSoles(stats.ventas_mes_actual);
        document.getElementById('metaPorcentaje').textContent = `${stats.progreso_meta}%`;
        document.getElementById('metaProgress').style.width = `${Math.min(stats.progreso_meta, 100)}%`;
        
        // Actualizar select de años
        actualizarSelectAnios(stats.anios_disponibles);
        
        // Actualizar gráficos
        updateCharts();
        
    } catch (error) {
        console.error('Error:', error);
    }
}

function actualizarTendencia(elementId, actual, anterior, esMoneda = true) {
    const el = document.getElementById(elementId);
    if (anterior === 0) {
        el.innerHTML = '<i class="fas fa-minus"></i> 0%';
        el.className = 'kpi-trend neutral';
        return;
    }
    
    const cambio = ((actual - anterior) / anterior * 100).toFixed(1);
    const esPositivo = cambio >= 0;
    
    el.innerHTML = `<i class="fas fa-arrow-${esPositivo ? 'up' : 'down'}"></i> ${Math.abs(cambio)}%`;
    el.className = `kpi-trend ${esPositivo ? 'positive' : 'negative'}`;
}

function actualizarDashboardSimultaneo() {
    loadDashboard();
    if (document.getElementById('ventas').classList.contains('active')) {
        loadVentas();
    }
}

// ===== GRÁFICOS =====
function initCharts() {
    // Gráfico de Ventas por Mes
    charts.meses = new Chart(document.getElementById('chartMeses'), {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Ventas (S/)', data: [], backgroundColor: 'rgba(102, 126, 234, 0.8)', borderRadius: 8 }] },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: value => 'S/ ' + value.toLocaleString() }
                }
            }
        }
    });
    
    // Gráfico de Últimos 30 Días
    charts.dias = new Chart(document.getElementById('chartDias'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Ventas', data: [], borderColor: 'rgba(245, 101, 101, 1)', backgroundColor: 'rgba(245, 101, 101, 0.1)', fill: true, tension: 0.4 }] },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: value => 'S/ ' + value.toLocaleString() }
                }
            }
        }
    });
    
    // Gráfico de Categorías
    charts.categorias = new Chart(document.getElementById('chartCategorias'), {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: ['#667eea', '#f093fb', '#4facfe', '#43e97b']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12 } }
            }
        }
    });
    
    // Gráfico de Top Clientes
    charts.clientes = new Chart(document.getElementById('chartClientes'), {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Total (S/)', data: [], backgroundColor: 'rgba(72, 187, 120, 0.8)', borderRadius: 6 }] },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { callback: value => 'S/ ' + value.toLocaleString() }
                }
            }
        }
    });
    
    // Gráfico de Métodos de Pago
    charts.metodos = new Chart(document.getElementById('chartMetodos'), {
        type: 'pie',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12 } }
            }
        }
    });
}

async function updateCharts() {
    const anio = document.getElementById('anioSelect').value || new Date().getFullYear();
    
    try {
        // Ventas por mes
        const mesesData = await fetch(`${API_URL}/estadisticas/por-mes?anio=${anio}`).then(r => r.json());
        charts.meses.data.labels = mesesData.map(d => d.mes_nombre);
        charts.meses.data.datasets[0].data = mesesData.map(d => d.total);
        charts.meses.update();
        
        // Ventas por día
        const diasData = await fetch(`${API_URL}/estadisticas/por-dia`).then(r => r.json());
        charts.dias.data.labels = diasData.map(d => d.fecha.slice(5));
        charts.dias.data.datasets[0].data = diasData.map(d => d.total);
        charts.dias.update();
        
        // Por categoría
        const catData = await fetch(`${API_URL}/estadisticas/por-categoria`).then(r => r.json());
        charts.categorias.data.labels = catData.map(d => d.categoria);
        charts.categorias.data.datasets[0].data = catData.map(d => d.total);
        charts.categorias.update();
        
        // Top clientes
        const cliData = await fetch(`${API_URL}/estadisticas/por-cliente`).then(r => r.json());
        charts.clientes.data.labels = cliData.map(d => d.cliente);
        charts.clientes.data.datasets[0].data = cliData.map(d => d.total);
        charts.clientes.update();
        
        // Métodos de pago
        const metData = await fetch(`${API_URL}/estadisticas/por-metodo-pago`).then(r => r.json());
        charts.metodos.data.labels = metData.map(d => d.metodo);
        charts.metodos.data.datasets[0].data = metData.map(d => d.total);
        charts.metodos.update();
        
    } catch (error) {
        console.error('Error actualizando gráficos:', error);
    }
}

// ===== VENTAS =====
async function loadVentas() {
    try {
        const ventas = await fetch(`${API_URL}/ventas`).then(r => r.json());
        renderTablaVentas(ventas);
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderTablaVentas(ventas) {
    const tbody = document.getElementById('tbodyVentas');
    tbody.innerHTML = ventas.map(v => `
        <tr>
            <td><strong>${v.correlativo}</strong></td>
            <td>${v.cliente_nombre}</td>
            <td><span class="categoria-badge categoria-${v.categoria.toLowerCase().replace(/\s+/g, '-')}">${v.categoria}</span></td>
            <td>${v.producto}</td>
            <td>${formatSoles(v.monto)}</td>
            <td>${v.fecha_venta}</td>
            <td>${v.metodo_pago}</td>
            <td><span class="estado-badge estado-${v.estado}">${v.estado}</span></td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editarVenta(${v.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="eliminarVenta(${v.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function aplicarFiltros() {
    const params = new URLSearchParams();
    
    const fechaInicio = document.getElementById('filtroFechaInicio').value;
    const fechaFin = document.getElementById('filtroFechaFin').value;
    const mes = document.getElementById('filtroMes').value;
    const anio = document.getElementById('filtroAnio').value;
    const categoria = document.getElementById('filtroCategoria').value;
    const montoMin = document.getElementById('filtroMontoMin').value;
    const montoMax = document.getElementById('filtroMontoMax').value;
    const estado = document.getElementById('filtroEstado').value;
    const cliente = document.getElementById('filtroCliente').value;
    
    if (fechaInicio && fechaFin) {
        params.append('fecha_inicio', fechaInicio);
        params.append('fecha_fin', fechaFin);
    }
    if (mes) params.append('mes', mes);
    if (anio) params.append('anio', anio);
    if (categoria) params.append('categoria', categoria);
    if (montoMin) params.append('monto_min', montoMin);
    if (montoMax) params.append('monto_max', montoMax);
    if (estado) params.append('estado', estado);
    if (cliente) params.append('cliente_id', cliente);
    
    try {
        const ventas = await fetch(`${API_URL}/ventas?${params}`).then(r => r.json());
        renderTablaVentas(ventas);
        showNotification(`${ventas.length} ventas encontradas`, 'info');
    } catch (error) {
        showNotification('Error aplicando filtros', 'error');
    }
}

function limpiarFiltros() {
    document.getElementById('filtroFechaInicio').value = '';
    document.getElementById('filtroFechaFin').value = '';
    document.getElementById('filtroMes').value = '';
    document.getElementById('filtroAnio').value = new Date().getFullYear();
    document.getElementById('filtroCategoria').value = '';
    document.getElementById('filtroMontoMin').value = '';
    document.getElementById('filtroMontoMax').value = '';
    document.getElementById('filtroEstado').value = '';
    document.getElementById('filtroCliente').value = '';
    loadVentas();
}
// ===== CLIENTES CON BÚSQUEDA =====
async function loadClientes() {
    try {
        const clientes = await fetch(`${API_URL}/clientes`).then(r => r.json());
        renderTablaClientes(clientes);
    } catch (error) {
        console.error('Error:', error);
    }
}

// REEMPLAZAR LA FUNCIÓN editarCliente COMPLETA:
async function editarCliente(id) {
    try {
        // Obtener datos del cliente
        const res = await fetch(`${API_URL}/clientes/${id}`);
        if (!res.ok) throw new Error('Error al cargar cliente');
        const c = await res.json();
        
        // Llenar el modal con los datos
        document.getElementById('clienteNombre').value = c.nombre;
        document.getElementById('clienteRuc').value = c.ruc || '';
        document.getElementById('clienteContacto').value = c.contacto || '';
        document.getElementById('clienteEmail').value = c.email || '';
        document.getElementById('clienteTelefono').value = c.telefono || '';
        document.getElementById('clienteDireccion').value = c.direccion || '';
        
        // Cambiar el título del modal
        document.querySelector('#modalCliente .modal-header h3').innerHTML = '<i class="fas fa-edit"></i> Editar Cliente';
        
        // Cambiar el comportamiento del submit
        const form = document.getElementById('formCliente');
        form.onsubmit = async (e) => {
            e.preventDefault();
            await actualizarCliente(id);
        };
        
        // Abrir modal
        openModal('cliente');
        
    } catch (error) {
        showNotification('Error al cargar cliente', 'error');
        console.error(error);
    }
}
async function actualizarCliente(id) {
    const data = {
        nombre: document.getElementById('clienteNombre').value,
        ruc: document.getElementById('clienteRuc').value,
        contacto: document.getElementById('clienteContacto').value,
        email: document.getElementById('clienteEmail').value,
        telefono: document.getElementById('clienteTelefono').value,
        direccion: document.getElementById('clienteDireccion').value
    };
    
    try {
        const response = await fetch(`${API_URL}/clientes/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('Cliente actualizado exitosamente', 'success');
            closeModal('cliente');
            loadClientes();
            loadClientesSelect();
            loadDashboard();
            
            // Restaurar el formulario para nuevos registros
            setTimeout(() => {
                const form = document.getElementById('formCliente');
                if (form) {
                    form.reset();
                    form.onsubmit = guardarCliente;
                }
                const header = document.querySelector('#modalCliente .modal-header h3');
                if (header) {
                    header.innerHTML = '<i class="fas fa-user-plus"></i> Registrar Nuevo Cliente';
                }
            }, 300);
        } else {
            throw new Error('Error al actualizar');
        }
    } catch (error) {
        showNotification('Error al actualizar cliente', 'error');
    }
}
function renderTablaClientes(clientes) {
    const tbody = document.getElementById('tbodyClientes');
    tbody.innerHTML = clientes.map(c => `
        <tr>
            <td>#${c.id}</td>
            <td><strong>${c.nombre}</strong></td>
            <td>${c.ruc || '-'}</td>
            <td>${c.contacto || '-'}</td>
            <td>${c.email || '-'}</td>
            <td>${c.telefono || '-'}</td>
            <td>${formatSoles(c.total_ventas)}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editarCliente(${c.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="eliminarCliente(${c.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function buscarClientes() {
    const query = document.getElementById('buscarCliente').value;
    try {
        const clientes = await fetch(`${API_URL}/clientes?q=${encodeURIComponent(query)}`).then(r => r.json());
        renderTablaClientes(clientes);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function loadClientesSelect() {
    try {
        const clientes = await fetch(`${API_URL}/clientes`).then(r => r.json());
        
        const selectVenta = document.getElementById('ventaCliente');
        selectVenta.innerHTML = '<option value="">Seleccionar cliente...</option>' +
            clientes.map(c => `<option value="${c.id}">${c.nombre} ${c.ruc ? '(RUC: ' + c.ruc + ')' : ''}</option>`).join('');
        
        const selectFiltro = document.getElementById('filtroCliente');
        selectFiltro.innerHTML = '<option value="">Todos</option>' +
            clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
        
        // También llenar el select de edición de ventas
        const selectEditVenta = document.getElementById('editVentaCliente');
        if (selectEditVenta) {
            selectEditVenta.innerHTML = '<option value="">Seleccionar cliente...</option>' +
                clientes.map(c => `<option value="${c.id}">${c.nombre} ${c.ruc ? '(RUC: ' + c.ruc + ')' : ''}</option>`).join('');
        }
            
    } catch (error) {
        console.error('Error:', error);
    }
}
// ===== METAS =====
async function loadMetas() {
    try {
        const metas = await fetch(`${API_URL}/metas`).then(r => r.json());
        const ventasMes = await fetch(`${API_URL}/estadisticas/por-mes?anio=${new Date().getFullYear()}`).then(r => r.json());
        const ventasPorMes = {};
        ventasMes.forEach(v => ventasPorMes[v.mes_numero] = v.total);
        
        const container = document.getElementById('metasList');
        container.innerHTML = metas.map(m => {
            const ventasActuales = ventasPorMes[m.mes] || 0;
            const progreso = Math.min((ventasActuales / m.monto_meta) * 100, 100) || 0;
            
            return `
                <div class="meta-item">
                    <div class="meta-item-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span class="meta-periodo">${m.periodo}</span>
                            <span class="meta-monto">${formatSoles(m.monto_meta)}</span>
                        </div>
                        <button class="btn btn-sm btn-secondary" onclick="editarMeta(${m.id})" title="Editar Meta">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <div class="progress-bar" style="margin: 12px 0; height: 10px;">
                        <div class="progress-fill" style="width: ${progreso}%"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px;">
                        <span>Actual: ${formatSoles(ventasActuales)}</span>
                        <span style="font-weight: 600; color: ${progreso >= 100 ? 'var(--success)' : 'var(--primary)'}">${progreso.toFixed(1)}%</span>
                    </div>
                    <p style="font-size: 12px; color: var(--gray); margin-top: 8px;">${m.descripcion || 'Sin descripción'}</p>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error:', error);
    }
}

async function editarMeta(id) {
    try {
        const res = await fetch(`${API_URL}/metas`);
        if (!res.ok) throw new Error('Error al cargar metas');
        const metas = await res.json();
        const meta = metas.find(m => m.id === id);
        
        if (!meta) {
            showNotification('Meta no encontrada', 'error');
            return;
        }
        
        // Llenar el modal
        document.getElementById('editMetaId').value = meta.id;
        document.getElementById('editMetaMes').value = meta.mes;
        document.getElementById('editMetaAnio').value = meta.anio;
        document.getElementById('editMetaMonto').value = meta.monto_meta;
        document.getElementById('editMetaDescripcion').value = meta.descripcion || '';
        
        openModal('metaEdit');
        
    } catch (error) {
        showNotification('Error al cargar meta', 'error');
        console.error(error);
    }
}

async function guardarEdicionMeta(event) {
    event.preventDefault();
    
    const id = document.getElementById('editMetaId').value;
    const data = {
        mes: parseInt(document.getElementById('editMetaMes').value),
        anio: parseInt(document.getElementById('editMetaAnio').value),
        monto_meta: parseFloat(document.getElementById('editMetaMonto').value),
        descripcion: document.getElementById('editMetaDescripcion').value
    };
    
    try {
        const response = await fetch(`${API_URL}/metas/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('Meta actualizada exitosamente', 'success');
            closeModal('metaEdit');
            loadMetas();
            loadDashboard();
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al actualizar');
        }
    } catch (error) {
        showNotification('Error al actualizar meta: ' + error.message, 'error');
        console.error(error);
    }
}
// ===== MODALES =====
function openModal(tipo) {
    document.getElementById(`modal${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`).classList.add('active');
}

function closeModal(tipo) {
    document.getElementById(`modal${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`).classList.remove('active');
    
    // Restaurar formulario de cliente si se cierra el modal de cliente
    if (tipo === 'cliente') {
        setTimeout(() => {
            const form = document.getElementById('formCliente');
            if (form) {
                form.reset();
                form.onsubmit = guardarCliente;
            }
            const header = document.querySelector('#modalCliente .modal-header h3');
            if (header) {
                header.innerHTML = '<i class="fas fa-user-plus"></i> Registrar Nuevo Cliente';
            }
        }, 300);
    }
    
    const form = document.getElementById(`form${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);
    if (form && tipo !== 'cliente') form.reset();
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}
// ===== FILTRAR PRODUCTOS POR CATEGORÍA =====
function filtrarProductos() {
    const categoria = document.getElementById('ventaCategoria').value;
    const selectProducto = document.getElementById('ventaProducto');
    
    if (!categoria) {
        selectProducto.innerHTML = '<option value="">Primero seleccione categoría...</option>';
        return;
    }
    
    const productos = productosPorCategoria[categoria] || [];
    selectProducto.innerHTML = '<option value="">Seleccionar...</option>' +
        productos.map(p => `<option value="${p}">${p}</option>`).join('');
}

// ===== GUARDAR DATOS =====
async function guardarVenta(event) {
    event.preventDefault();
    
    const data = {
        cliente_id: parseInt(document.getElementById('ventaCliente').value),
        categoria: document.getElementById('ventaCategoria').value,
        producto: document.getElementById('ventaProducto').value,
        descripcion: document.getElementById('ventaDescripcion').value,
        monto: parseFloat(document.getElementById('ventaMonto').value),
        metodo_pago: document.getElementById('ventaMetodo').value
    };
    
    try {
        const response = await fetch(`${API_URL}/ventas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('Venta registrada exitosamente', 'success');
            closeModal('venta');
            loadDashboard();
            if (document.getElementById('ventas').classList.contains('active')) {
                loadVentas();
            }
        } else {
            throw new Error('Error al guardar');
        }
    } catch (error) {
        showNotification('Error al registrar venta', 'error');
    }
}

async function guardarCliente(event) {
    event.preventDefault();
    
    const data = {
        nombre: document.getElementById('clienteNombre').value,
        ruc: document.getElementById('clienteRuc').value,
        contacto: document.getElementById('clienteContacto').value,
        email: document.getElementById('clienteEmail').value,
        telefono: document.getElementById('clienteTelefono').value,
        direccion: document.getElementById('clienteDireccion').value
    };
    
    try {
        const response = await fetch(`${API_URL}/clientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('Cliente registrado exitosamente', 'success');
            closeModal('cliente');
            loadClientesSelect();
            if (document.getElementById('clientes').classList.contains('active')) {
                loadClientes();
            }
            loadDashboard();
        } else {
            throw new Error('Error al guardar');
        }
    } catch (error) {
        showNotification('Error al registrar cliente', 'error');
    }
}

async function guardarMeta(event) {
    event.preventDefault();
    
    const data = {
        mes: parseInt(document.getElementById('metaMes').value),
        anio: parseInt(document.getElementById('metaAnio').value),
        monto_meta: parseFloat(document.getElementById('metaMontoInput').value),
        descripcion: document.getElementById('metaDescripcion').value
    };
    
    try {
        const response = await fetch(`${API_URL}/metas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('Meta establecida exitosamente', 'success');
            closeModal('meta');
            loadMetas();
            loadDashboard();
        } else {
            throw new Error('Error al guardar');
        }
    } catch (error) {
        showNotification('Error al establecer meta', 'error');
    }
}

// ===== ELIMINAR =====
async function eliminarVenta(id) {
    if (!confirm('¿Eliminar esta venta?')) return;
    
    try {
        await fetch(`${API_URL}/ventas/${id}`, { method: 'DELETE' });
        showNotification('Venta eliminada', 'success');
        loadVentas();
        loadDashboard();
    } catch (error) {
        showNotification('Error al eliminar', 'error');
    }
}

async function eliminarCliente(id) {
    if (!confirm('¿Eliminar este cliente y todas sus ventas?')) return;
    
    try {
        await fetch(`${API_URL}/clientes/${id}`, { method: 'DELETE' });
        showNotification('Cliente eliminado', 'success');
        loadClientes();
        loadClientesSelect();
        loadDashboard();
    } catch (error) {
        showNotification('Error al eliminar', 'error');
    }
}

// ===== REPORTES PDF =====
function descargarReporte(tipo) {
    showNotification(`Generando reporte ${tipo}...`, 'info');
    
    fetch(`${API_URL}/reportes/${tipo}`)
        .then(response => {
            if (!response.ok) throw new Error('Error generando reporte');
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reporte_${tipo}_${new Date().toISOString().slice(0,10)}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            showNotification('Reporte descargado exitosamente', 'success');
        })
        .catch(error => {
            showNotification('Error al generar reporte', 'error');
        });
}

// ===== EXPORTAR CSV =====
function exportarVentas() {
    const tabla = document.getElementById('tablaVentas');
    let csv = [];
    
    const headers = [];
    tabla.querySelectorAll('thead th').forEach(th => {
        if (th.textContent !== 'Acciones') headers.push(th.textContent);
    });
    csv.push(headers.join(','));
    
    tabla.querySelectorAll('tbody tr').forEach(tr => {
        const row = [];
        tr.querySelectorAll('td').forEach((td, index) => {
            if (index < 8) row.push('"' + td.textContent.replace(/"/g, '""').trim() + '"');
        });
        csv.push(row.join(','));
    });
    
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    
    showNotification('CSV exportado exitosamente', 'success');
}

// ===== UTILIDADES =====
function formatSoles(amount) {
    return 'S/ ' + amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setDefaultDates() {
    const hoy = new Date();
    const mesInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    
    document.getElementById('filtroFechaFin').valueAsDate = hoy;
    document.getElementById('filtroFechaInicio').valueAsDate = mesInicio;
}
function cargarAniosDisponibles() {
    const anioActual = new Date().getFullYear();
    const selectMeta = document.getElementById('metaAnio');
    
    for (let i = anioActual - 2; i <= anioActual + 2; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (i === anioActual) option.selected = true;
        selectMeta.appendChild(option);
    }
    
    // También llenar el select de edición de metas
    const selectEditMeta = document.getElementById('editMetaAnio');
    if (selectEditMeta) {
        selectEditMeta.innerHTML = '';
        for (let i = anioActual - 2; i <= anioActual + 2; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            selectEditMeta.appendChild(option);
        }
    }
}

function actualizarSelectAnios(anios) {
    const select = document.getElementById('anioSelect');
    const valorActual = select.value || new Date().getFullYear();
    
    select.innerHTML = anios.map(a => `<option value="${a}" ${a == valorActual ? 'selected' : ''}>${a}</option>`).join('');
    
    // Actualizar también el filtro de años
    const filtroAnio = document.getElementById('filtroAnio');
    filtroAnio.innerHTML = anios.map(a => `<option value="${a}" ${a == valorActual ? 'selected' : ''}>${a}</option>`).join('');
}

function showNotification(mensaje, tipo = 'info') {
    const container = document.getElementById('notificaciones');
    const notif = document.createElement('div');
    notif.className = `notificacion ${tipo}`;
    
    const iconos = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle' };
    
    notif.innerHTML = `<i class="fas fa-${iconos[tipo]}"></i><span>${mensaje}</span>`;
    container.appendChild(notif);
    
    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transform = 'translateX(100%)';
        setTimeout(() => notif.remove(), 300);
    }, 4000);
}

// Placeholders
// REEMPLAZAR la función editarVenta completa:
async function editarVenta(id) {
    try {
        const response = await fetch(`${API_URL}/ventas/${id}`);
        if (!response.ok) throw new Error('Error al cargar venta');
        const venta = await response.json();
        
        // Llenar el modal de edición
        document.getElementById('editVentaId').value = venta.id;
        document.getElementById('editVentaCliente').value = venta.cliente_id;
        document.getElementById('editVentaCategoria').value = venta.categoria;
        
        // Cargar productos de la categoría
        filtrarProductosEdit(venta.categoria, venta.producto);
        
        document.getElementById('editVentaDescripcion').value = venta.descripcion || '';
        document.getElementById('editVentaMonto').value = venta.monto;
        document.getElementById('editVentaMetodo').value = venta.metodo_pago;
        document.getElementById('editVentaEstado').value = venta.estado;
        
        // Mostrar info de la venta
        document.getElementById('editVentaCorrelativo').textContent = venta.correlativo;
        
        openModal('ventaEdit');
        
    } catch (error) {
        showNotification('Error al cargar venta', 'error');
        console.error(error);
    }
}

// AGREGAR esta función nueva después:
function filtrarProductosEdit(categoria, productoSeleccionado = '') {
    const selectProducto = document.getElementById('editVentaProducto');
    
    if (!categoria) {
        selectProducto.innerHTML = '<option value="">Primero seleccione categoría...</option>';
        return;
    }
    
    const productos = productosPorCategoria[categoria] || [];
    selectProducto.innerHTML = '<option value="">Seleccionar...</option>' +
        productos.map(p => `<option value="${p}" ${p === productoSeleccionado ? 'selected' : ''}>${p}</option>`).join('');
}

// AGREGAR esta función nueva para guardar la edición:
async function guardarEdicionVenta(event) {
    event.preventDefault();
    
    const id = document.getElementById('editVentaId').value;
    const data = {
        cliente_id: parseInt(document.getElementById('editVentaCliente').value),
        categoria: document.getElementById('editVentaCategoria').value,
        producto: document.getElementById('editVentaProducto').value,
        descripcion: document.getElementById('editVentaDescripcion').value,
        monto: parseFloat(document.getElementById('editVentaMonto').value),
        metodo_pago: document.getElementById('editVentaMetodo').value,
        estado: document.getElementById('editVentaEstado').value
    };
    
    try {
        const response = await fetch(`${API_URL}/ventas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('Venta actualizada exitosamente', 'success');
            closeModal('ventaEdit');
            loadVentas();
            loadDashboard();
        } else {
            throw new Error('Error al actualizar');
        }
    } catch (error) {
        showNotification('Error al actualizar venta', 'error');
    }
}

function cerrarModalEstado() {
    const modal = document.getElementById('modalEditarEstado');
    if (modal) modal.remove();
}

async function guardarEstadoVenta(id) {
    const nuevoEstado = document.getElementById('nuevoEstado').value;
    
    try {
        const response = await fetch(`${API_URL}/ventas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        
        if (!response.ok) throw new Error('Error al actualizar');
        
        showNotification(`Estado actualizado a: ${nuevoEstado}`, 'success');
        cerrarModalEstado();
        
        // Recargar la lista de ventas
        loadVentas();
        // Actualizar dashboard si está visible
        if (document.getElementById('dashboard').classList.contains('active')) {
            loadDashboard();
        }
        
    } catch (error) {
        showNotification('Error al guardar estado', 'error');
        console.error(error);
    }
}