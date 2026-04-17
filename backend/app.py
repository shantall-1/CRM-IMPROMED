from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import os
import io
import csv
import traceback
from datetime import datetime, timedelta
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
import random

# ✅ SOLO importar desde database.py
from database import db, Cliente, Venta, MetaVentas, init_db

# Configuración inicial
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR = os.path.join(BASE_DIR, 'database')

if not os.path.exists(DATABASE_DIR):
    os.makedirs(DATABASE_DIR)
    print(f"✅ Carpeta database creada: {DATABASE_DIR}")

app = Flask(__name__)
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})
socketio = SocketIO(app, cors_allowed_origins="*")

# Configurar base de datos usando init_db
init_db(app)

# ==================== RUTA PARA GUARDAR CLIENTES ====================
@app.route('/api/clientes', methods=['POST'])
def crear_cliente():
    try:
        data = request.get_json()
        
        # Validar datos mínimos
        if not data or not data.get('nombre'):
            return jsonify({'error': 'El nombre es obligatorio'}), 400

        # Crear instancia del modelo Cliente
        nuevo_cliente = Cliente(
            nombre=data.get('nombre'),
            email=data.get('email'),
            telefono=data.get('telefono')
        )
        
        db.session.add(nuevo_cliente)
        db.session.commit()
        
        # Notificar por WebSocket que hay un nuevo cliente (opcional pero recomendado)
        socketio.emit('nuevo_cliente', nuevo_cliente.to_dict())
        
        return jsonify({
            'message': 'Cliente guardado exitosamente',
            'cliente': nuevo_cliente.to_dict()
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"❌ Error al guardar cliente: {str(e)}")
        return jsonify({'error': 'Error interno al guardar'}), 500

# ==================== FUNCIONES AUXILIARES ====================

def generar_correlativo():
    ultima_venta = Venta.query.order_by(Venta.id.desc()).first()
    siguiente = (ultima_venta.id + 1) if ultima_venta else 1
    return f"VEN-{siguiente:06d}"

def get_anios_disponibles():
    anios = db.session.query(db.extract('year', Venta.fecha_venta)).distinct().all()
    anios_list = [int(a[0]) for a in anios if a[0]]
    anios_list.sort(reverse=True)
    if datetime.now().year not in anios_list:
        anios_list.insert(0, datetime.now().year)
    return anios_list

# ==================== INICIALIZACIÓN ====================

with app.app_context():
    db.create_all()
    print("✅ Tablas creadas/verificadas")
    # ✅ NO crear metas automáticamente - solo tablas vacías

# ==================== API CLIENTES ====================

@app.route('/api/clientes', methods=['GET', 'POST'])
def clientes():
    if request.method == 'POST':
        try:
            data = request.get_json()
            print(f"📥 Datos recibidos: {data}")
            
            if not data:
                return jsonify({'error': 'No se recibieron datos'}), 400
            
            if not data.get('nombre'):
                return jsonify({'error': 'El nombre es obligatorio'}), 400
            
            # Verificar si el RUC ya existe
            if data.get('ruc'):
                existe = Cliente.query.filter_by(ruc=data['ruc']).first()
                if existe:
                    return jsonify({'error': 'Ya existe un cliente con ese RUC'}), 400
            
            nuevo_cliente = Cliente(
                nombre=data['nombre'],
                ruc=data.get('ruc') or None,
                contacto=data.get('contacto') or None,
                email=data.get('email') or None,
                telefono=data.get('telefono') or None,
                direccion=data.get('direccion') or None
            )
            
            db.session.add(nuevo_cliente)
            db.session.commit()
            
            print(f"✅ Cliente creado: {nuevo_cliente.to_dict()}")
            
            socketio.emit('nuevo_cliente', nuevo_cliente.to_dict())
            return jsonify(nuevo_cliente.to_dict()), 201
            
        except Exception as e:
            db.session.rollback()
            print(f"❌ Error creando cliente: {str(e)}")
            print(traceback.format_exc())
            return jsonify({'error': str(e)}), 500
    
    # GET - Listar con búsqueda
    try:
        busqueda = request.args.get('q', '').lower()
        query = Cliente.query
        
        if busqueda:
            query = query.filter(
                db.or_(
                    Cliente.nombre.ilike(f'%{busqueda}%'),
                    Cliente.ruc.ilike(f'%{busqueda}%')
                )
            )
        
        clientes = query.order_by(Cliente.nombre).all()
        return jsonify([c.to_dict() for c in clientes])
        
    except Exception as e:
        print(f"❌ Error listando clientes: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/clientes/<int:id>', methods=['GET', 'PUT', 'DELETE'])
def cliente_detalle(id):
    try:
        cliente = Cliente.query.get_or_404(id)
        
        if request.method == 'GET':
            return jsonify(cliente.to_dict())
        
        elif request.method == 'PUT':
            data = request.get_json()
            cliente.nombre = data.get('nombre', cliente.nombre)
            cliente.ruc = data.get('ruc', cliente.ruc)
            cliente.contacto = data.get('contacto', cliente.contacto)
            cliente.email = data.get('email', cliente.email)
            cliente.telefono = data.get('telefono', cliente.telefono)
            cliente.direccion = data.get('direccion', cliente.direccion)
            db.session.commit()
            return jsonify(cliente.to_dict())
        
        elif request.method == 'DELETE':
            db.session.delete(cliente)
            db.session.commit()
            return jsonify({'mensaje': 'Cliente eliminado'})
            
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ==================== API VENTAS ====================

@app.route('/api/ventas', methods=['GET', 'POST'])
def ventas():
    if request.method == 'POST':
        try:
            data = request.get_json()
            print(f"📥 Venta recibida: {data}")
            
            if not data.get('cliente_id'):
                return jsonify({'error': 'Debe seleccionar un cliente'}), 400
            
            if not data.get('monto'):
                return jsonify({'error': 'El monto es obligatorio'}), 400
            
            correlativo = generar_correlativo()
            
            nueva_venta = Venta(
                cliente_id=int(data['cliente_id']),
                monto=float(data['monto']),
                categoria=data.get('categoria', 'Otros'),
                producto=data.get('producto') or None,
                descripcion=data.get('descripcion') or None,
                metodo_pago=data.get('metodo_pago', 'Efectivo'),
                estado=data.get('estado', 'completada'),
                correlativo=correlativo
            )
            
            db.session.add(nueva_venta)
            db.session.commit()
            
            print(f"✅ Venta creada: {nueva_venta.to_dict()}")
            
            socketio.emit('nueva_venta', nueva_venta.to_dict())
            socketio.emit('actualizar_dashboard', {})
            
            return jsonify(nueva_venta.to_dict()), 201
            
        except Exception as e:
            db.session.rollback()
            print(f"❌ Error creando venta: {str(e)}")
            print(traceback.format_exc())
            return jsonify({'error': str(e)}), 500
    
    # GET - Listar con filtros
    try:
        query = Venta.query
        
        cliente_id = request.args.get('cliente_id')
        if cliente_id and cliente_id.strip():
            try:
                query = query.filter_by(cliente_id=int(cliente_id))
            except ValueError:
                pass
        
        fecha_inicio = request.args.get('fecha_inicio')
        fecha_fin = request.args.get('fecha_fin')
        if fecha_inicio and fecha_fin:
            query = query.filter(Venta.fecha_venta.between(fecha_inicio, fecha_fin))
        
        mes = request.args.get('mes')
        anio = request.args.get('anio')
        if mes:
            query = query.filter(db.extract('month', Venta.fecha_venta) == int(mes))
        if anio:
            query = query.filter(db.extract('year', Venta.fecha_venta) == int(anio))
        
        categoria = request.args.get('categoria')
        if categoria:
            query = query.filter_by(categoria=categoria)
        
        monto_min = request.args.get('monto_min')
        monto_max = request.args.get('monto_max')
        if monto_min:
            query = query.filter(Venta.monto >= float(monto_min))
        if monto_max:
            query = query.filter(Venta.monto <= float(monto_max))
        
        estado = request.args.get('estado')
        if estado:
            query = query.filter_by(estado=estado)
        
        ventas = query.order_by(Venta.fecha_venta.desc()).all()
        return jsonify([v.to_dict() for v in ventas])
        
    except Exception as e:
        print(f"❌ Error listando ventas: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ventas/<int:id>', methods=['GET', 'PUT', 'DELETE'])
def venta_detalle(id):
    try:
        venta = Venta.query.get_or_404(id)
        
        if request.method == 'GET':
            return jsonify(venta.to_dict())
        
        elif request.method == 'PUT':
            data = request.get_json()
            
            # ✅ Actualizar solo los campos que se envían
            if 'monto' in data:
                venta.monto = float(data['monto'])
            if 'categoria' in data:
                venta.categoria = data['categoria']
            if 'producto' in data:
                venta.producto = data['producto']
            if 'descripcion' in data:
                venta.descripcion = data['descripcion']
            if 'metodo_pago' in data:
                venta.metodo_pago = data['metodo_pago']
            if 'estado' in data:  # ← ESTO ES LO IMPORTANTE
                venta.estado = data['estado']
            
            db.session.commit()
            socketio.emit('venta_actualizada', venta.to_dict())
            socketio.emit('actualizar_dashboard', {})
            return jsonify(venta.to_dict())
        
        elif request.method == 'DELETE':
            db.session.delete(venta)
            db.session.commit()
            socketio.emit('venta_eliminada', {'id': id})
            socketio.emit('actualizar_dashboard', {})
            return jsonify({'mensaje': 'Venta eliminada'})
            
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
    
# ==================== API ESTADÍSTICAS ====================

@app.route('/api/estadisticas/dashboard', methods=['GET'])
def dashboard_stats():
    try:
        hoy = datetime.now()
        mes_actual = hoy.month
        anio_actual = hoy.year
        
        ventas_totales = db.session.query(db.func.sum(Venta.monto)).filter(
            Venta.estado == 'completada'
        ).scalar() or 0
        
        ventas_mes = db.session.query(db.func.sum(Venta.monto)).filter(
            db.extract('month', Venta.fecha_venta) == mes_actual,
            db.extract('year', Venta.fecha_venta) == anio_actual,
            Venta.estado == 'completada'
        ).scalar() or 0
        
        ventas_hoy = db.session.query(db.func.sum(Venta.monto)).filter(
            db.func.date(Venta.fecha_venta) == hoy.date(),
            Venta.estado == 'completada'
        ).scalar() or 0
        
        total_ventas = Venta.query.filter_by(estado='completada').count()
        total_clientes = Cliente.query.count()
        ventas_pendientes = Venta.query.filter_by(estado='pendiente').count()
        
        # ✅ Solo buscar meta, NO crear automáticamente
        meta = MetaVentas.query.filter_by(mes=mes_actual, anio=anio_actual).first()
        
        if meta:
            meta_monto = float(meta.monto_meta)
            progreso_meta = (ventas_mes / meta_monto * 100) if meta_monto > 0 else 0
        else:
            meta_monto = 0
            progreso_meta = 0
        
        ventas_categoria = db.session.query(
            Venta.categoria,
            db.func.sum(Venta.monto).label('total')
        ).filter(Venta.estado == 'completada').group_by(Venta.categoria).all()
        
        return jsonify({
            'ventas_totales': float(ventas_totales),
            'ventas_mes_actual': float(ventas_mes),
            'ventas_hoy': float(ventas_hoy),
            'total_ventas': total_ventas,
            'total_clientes': total_clientes,
            'ventas_pendientes': ventas_pendientes,
            'meta_mes': float(meta_monto),
            'progreso_meta': round(progreso_meta, 2),
            'mes_actual': mes_actual,
            'anio_actual': anio_actual,
            'ventas_por_categoria': {c: float(t) for c, t in ventas_categoria},
            'anios_disponibles': get_anios_disponibles()
        })
        
    except Exception as e:
        print(f"❌ Error en dashboard: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/api/estadisticas/por-mes', methods=['GET'])
def ventas_por_mes():
    try:
        anio = request.args.get('anio', datetime.now().year, type=int)
        
        resultado = db.session.query(
            db.extract('month', Venta.fecha_venta).label('mes'),
            db.func.sum(Venta.monto).label('total'),
            db.func.count(Venta.id).label('cantidad')
        ).filter(
            db.extract('year', Venta.fecha_venta) == anio,
            Venta.estado == 'completada'
        ).group_by('mes').all()
        
        meses_nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                         'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
        
        data = []
        for r in resultado:
            data.append({
                'mes_numero': int(r.mes),
                'mes_nombre': meses_nombres[int(r.mes) - 1],
                'total': float(r.total),
                'cantidad': int(r.cantidad)
            })
        
        return jsonify(data)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/estadisticas/por-dia', methods=['GET'])
def ventas_por_dia():
    try:
        hoy = datetime.now()
        dias_atras = hoy - timedelta(days=30)
        
        resultado = db.session.query(
            db.func.date(Venta.fecha_venta).label('fecha'),
            db.func.sum(Venta.monto).label('total'),
            db.func.count(Venta.id).label('cantidad')
        ).filter(
            Venta.fecha_venta >= dias_atras,
            Venta.estado == 'completada'
        ).group_by(db.func.date(Venta.fecha_venta)).all()
        
        data = []
        for r in resultado:
            data.append({
                'fecha': str(r.fecha),
                'total': float(r.total),
                'cantidad': int(r.cantidad)
            })
        
        return jsonify(data)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/estadisticas/por-cliente', methods=['GET'])
def ventas_por_cliente():
    try:
        resultado = db.session.query(
            Cliente.nombre,
            db.func.sum(Venta.monto).label('total'),
            db.func.count(Venta.id).label('compras')
        ).join(Venta).filter(
            Venta.estado == 'completada'
        ).group_by(Cliente.id).order_by(db.desc('total')).limit(10).all()
        
        return jsonify([{
            'cliente': r.nombre,
            'total': float(r.total),
            'compras': int(r.compras)
        } for r in resultado])
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/estadisticas/por-categoria', methods=['GET'])
def ventas_por_categoria():
    try:
        resultado = db.session.query(
            Venta.categoria,
            db.func.sum(Venta.monto).label('total'),
            db.func.count(Venta.id).label('cantidad')
        ).filter(
            Venta.estado == 'completada'
        ).group_by(Venta.categoria).order_by(db.desc('total')).all()
        
        return jsonify([{
            'categoria': r.categoria,
            'total': float(r.total),
            'cantidad': int(r.cantidad)
        } for r in resultado])
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/estadisticas/por-metodo-pago', methods=['GET'])
def ventas_por_metodo():
    try:
        resultado = db.session.query(
            Venta.metodo_pago,
            db.func.sum(Venta.monto).label('total'),
            db.func.count(Venta.id).label('cantidad')
        ).filter(
            Venta.estado == 'completada'
        ).group_by(Venta.metodo_pago).all()
        
        return jsonify([{
            'metodo': r.metodo_pago,
            'total': float(r.total),
            'cantidad': int(r.cantidad)
        } for r in resultado])
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    

# ==================== API METAS ====================
@app.route('/api/metas', methods=['GET', 'POST'])
def metas():
    if request.method == 'POST':
        try:
            data = request.get_json()
            print(f"📥 Datos de meta recibidos: {data}")
            
            # Validar datos requeridos
            if not data.get('mes') or not data.get('anio') or not data.get('monto_meta'):
                return jsonify({'error': 'Mes, año y monto son obligatorios'}), 400
            
            # Convertir a números
            mes = int(data['mes'])
            anio = int(data['anio'])
            monto_meta = float(data['monto_meta'])
            
            # Validar rango del monto (máximo razonable)
            if monto_meta < 0 or monto_meta > 999999999.99:
                return jsonify({'error': 'Monto debe ser entre 0 y 999,999,999.99'}), 400
            
            # Buscar si ya existe
            existe = MetaVentas.query.filter_by(mes=mes, anio=anio).first()
            
            if existe:
                existe.monto_meta = monto_meta
                existe.descripcion = data.get('descripcion', existe.descripcion)
                db.session.commit()
                print(f"✅ Meta actualizada: {existe.to_dict()}")
                return jsonify(existe.to_dict()), 200
            
            # Crear nueva
            nueva_meta = MetaVentas(
                mes=mes,
                anio=anio,
                monto_meta=monto_meta,
                descripcion=data.get('descripcion', '')
            )
            db.session.add(nueva_meta)
            db.session.commit()
            print(f"✅ Meta creada: {nueva_meta.to_dict()}")
            return jsonify(nueva_meta.to_dict()), 201
            
        except ValueError as e:
            print(f"❌ Error de valor: {str(e)}")
            return jsonify({'error': f'Valor numérico inválido: {str(e)}'}), 400
        except Exception as e:
            db.session.rollback()
            print(f"❌ Error creando meta: {str(e)}")
            print(traceback.format_exc())
            return jsonify({'error': str(e)}), 500
        
        
    
    # GET - Listar metas
    try:
        metas = MetaVentas.query.order_by(MetaVentas.anio.desc(), MetaVentas.mes.desc()).all()
        return jsonify([m.to_dict() for m in metas])
    except Exception as e:
        print(f"❌ Error listando metas: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/metas/<int:id>', methods=['PUT'])
def actualizar_meta(id):
    try:
        data = request.get_json()
        meta = MetaVentas.query.get_or_404(id)
        
        # Actualizar campos
        if 'monto_meta' in data:
            meta.monto_meta = float(data['monto_meta'])
        if 'descripcion' in data:
            meta.descripcion = data['descripcion']
        # No permitimos cambiar mes y año para mantener integridad
        
        db.session.commit()
        return jsonify(meta.to_dict())
        
    except Exception as e:
        db.session.rollback()
        print(f"❌ Error actualizando meta: {str(e)}")
        return jsonify({'error': str(e)}), 500    

# ==================== REPORTES PDF ====================

@app.route('/api/reportes/<tipo>', methods=['GET'])
def generar_reporte(tipo):
    try:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        elements = []
        styles = getSampleStyleSheet()
        
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#667eea'),
            spaceAfter=30
        )
        
        elements.append(Paragraph(f"REPORTE {tipo.upper()}", title_style))
        elements.append(Paragraph(f"Fecha: {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles['Normal']))
        elements.append(Spacer(1, 20))
        
        # Obtener datos según tipo
        if tipo == 'diario':
            hoy = datetime.now()
            ventas = Venta.query.filter(db.func.date(Venta.fecha_venta) == hoy.date()).all()
            titulo = "Ventas del Día"
            
        elif tipo == 'semanal':
            hoy = datetime.now()
            semana_atras = hoy - timedelta(days=7)
            ventas = Venta.query.filter(Venta.fecha_venta >= semana_atras).all()
            titulo = "Ventas de la Última Semana"
            
        elif tipo == 'mensual':
            hoy = datetime.now()
            ventas = Venta.query.filter(
                db.extract('month', Venta.fecha_venta) == hoy.month,
                db.extract('year', Venta.fecha_venta) == hoy.year
            ).all()
            titulo = f"Ventas de {hoy.strftime('%B %Y')}"
            
        else:
            hoy = datetime.now()
            ventas = Venta.query.filter(db.extract('year', Venta.fecha_venta) == hoy.year).all()
            titulo = f"Ventas del Año {hoy.year}"
        
        total_monto = sum(v.monto for v in ventas)
        total_cantidad = len(ventas)
        
        elements.append(Paragraph(f"<b>{titulo}</b>", styles['Heading2']))
        elements.append(Spacer(1, 10))
        
        data_resumen = [
            ['Total Ventas', f'S/ {total_monto:,.2f}'],
            ['Cantidad de Ventas', str(total_cantidad)],
            ['Promedio por Venta', f'S/ {(total_monto/total_cantidad if total_cantidad > 0 else 0):,.2f}']
        ]
        
        t_resumen = Table(data_resumen, colWidths=[200, 200])
        t_resumen.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f7fafc')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#2d3748')),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
            ('PADDING', (0, 0), (-1, -1), 12),
        ]))
        elements.append(t_resumen)
        elements.append(Spacer(1, 20))
        
        if ventas:
            elements.append(Paragraph("<b>Detalle de Ventas</b>", styles['Heading3']))
            elements.append(Spacer(1, 10))
            
            data_detalle = [['Correlativo', 'Cliente', 'Categoría', 'Monto (S/)', 'Fecha']]
            for v in ventas:
                data_detalle.append([
                    v.correlativo or f'VEN-{v.id:06d}',
                    v.cliente.nombre if v.cliente else 'N/A',
                    v.categoria,
                    f'{v.monto:,.2f}',
                    v.fecha_venta.strftime('%d/%m/%Y')
                ])
            
            t_detalle = Table(data_detalle, colWidths=[80, 120, 100, 80, 80])
            t_detalle.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#667eea')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f7fafc')),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
                ('FONTSIZE', (0, 1), (-1, -1), 9),
                ('PADDING', (0, 0), (-1, -1), 8),
            ]))
            elements.append(t_detalle)
        
        doc.build(elements)
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'reporte_{tipo}_{datetime.now().strftime("%Y%m%d")}.pdf'
        )
        
    except Exception as e:
        print(f"❌ Error generando reporte: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ==================== WEBSOCKET ====================

@socketio.on('connect')
def handle_connect():
    print('Cliente conectado')
    emit('conectado', {'data': 'Conexión establecida'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Cliente desconectado')

if __name__ == '__main__':
    print("🚀 Servidor iniciado en http://localhost:5000")
    print("📊 Dashboard disponible")
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)