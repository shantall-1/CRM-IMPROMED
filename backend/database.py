from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

db = SQLAlchemy()

class Cliente(db.Model):
    __tablename__ = 'clientes'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(200), nullable=False)
    ruc = db.Column(db.String(20), unique=True, nullable=True)
    contacto = db.Column(db.String(100), nullable=True)
    email = db.Column(db.String(100), nullable=True)
    telefono = db.Column(db.String(20), nullable=True)
    direccion = db.Column(db.String(300), nullable=True)
    fecha_registro = db.Column(db.DateTime, default=datetime.now)
    
    ventas = db.relationship('Venta', backref='cliente', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'nombre': self.nombre,
            'ruc': self.ruc or '',
            'contacto': self.contacto or '',
            'email': self.email or '',
            'telefono': self.telefono or '',
            'direccion': self.direccion or '',
            'fecha_registro': self.fecha_registro.strftime('%Y-%m-%d %H:%M:%S'),
            'total_ventas': sum(v.monto for v in self.ventas) if self.ventas else 0
        }

class Venta(db.Model):
    __tablename__ = 'ventas'
    
    id = db.Column(db.Integer, primary_key=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes.id'), nullable=False)
    monto = db.Column(db.Float, nullable=False)
    categoria = db.Column(db.String(50), default='Otros')
    producto = db.Column(db.String(200), nullable=True)
    descripcion = db.Column(db.Text, nullable=True)
    fecha_venta = db.Column(db.DateTime, default=datetime.now)
    metodo_pago = db.Column(db.String(50), default='Efectivo')
    estado = db.Column(db.String(20), default='completada')
    correlativo = db.Column(db.String(20), unique=True, nullable=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'correlativo': self.correlativo or f'VEN-{self.id:06d}',
            'cliente_id': self.cliente_id,
            'cliente_nombre': self.cliente.nombre if self.cliente else 'Desconocido',
            'cliente_ruc': self.cliente.ruc if self.cliente else '',
            'monto': float(self.monto),
            'categoria': self.categoria,
            'producto': self.producto or '',
            'descripcion': self.descripcion or '',
            'fecha_venta': self.fecha_venta.strftime('%Y-%m-%d %H:%M:%S'),
            'fecha_corta': self.fecha_venta.strftime('%Y-%m-%d'),
            'mes': self.fecha_venta.month,
            'anio': self.fecha_venta.year,
            'dia': self.fecha_venta.day,
            'metodo_pago': self.metodo_pago,
            'estado': self.estado
        }

class MetaVentas(db.Model):
    __tablename__ = 'metas_ventas'
    
    id = db.Column(db.Integer, primary_key=True)
    mes = db.Column(db.Integer, nullable=False)
    anio = db.Column(db.Integer, nullable=False)
    monto_meta = db.Column(db.Float, nullable=False)
    descripcion = db.Column(db.String(200), nullable=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'mes': self.mes,
            'anio': self.anio,
            'monto_meta': float(self.monto_meta),
            'descripcion': self.descripcion or '',
            'periodo': f"{self.mes:02d}/{self.anio}"
        }

def init_db(app):
    # Detectar si estamos en Render (tiene DATABASE_URL)
    database_url = os.environ.get('DATABASE_URL')
    
    if database_url:
        # Render usa postgres://, SQLAlchemy necesita postgresql://
        if database_url.startswith('postgres://'):
            database_url = database_url.replace('postgres://', 'postgresql://', 1)
        
        app.config['SQLALCHEMY_DATABASE_URI'] = database_url
        print("🐘 Usando PostgreSQL (Render)")
    else:
        # SQLite para desarrollo local
        database_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database')
        if not os.path.exists(database_dir):
            os.makedirs(database_dir)
            print(f"✅ Carpeta creada: {database_dir}")
        
        app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(database_dir, "ventas.db")}'
        print("🗄️ Usando SQLite (local)")
    
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    # Configuración adicional para PostgreSQL (pool de conexiones)
    if database_url:
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
            'pool_size': 5,
            'max_overflow': 10,
            'pool_timeout': 30,
            'pool_recycle': 1800
        }
    
    db.init_app(app)
    
    with app.app_context():
        db.create_all()
        print("✅ Base de datos lista")