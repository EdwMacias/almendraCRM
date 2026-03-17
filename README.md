# CRM Inventario y Pedidos

Proyecto base para gestionar inventario, pedidos y produccion con:

- Vue 3 + Vite + VueUse + Tailwind CSS
- Node.js + Express
- PostgreSQL con `pg`

## Flujo cubierto

La estructura sigue `instrucciones.md`:

1. Registro de inventario inicial
2. Registro de pedidos por cliente
3. Generacion de produccion basada en pedidos pendientes
4. Actualizacion y control del inventario luego de ejecutar produccion

## Estructura

```text
apps/
  backend/   API, logica de negocio y SQL
  frontend/  interfaz operativa
docker-compose.yml
```

## Arranque en desarrollo

1. Crear variables locales:

```bash
cp .env.example .env
```

2. Levantar Postgres:

```bash
docker compose up -d
```

3. Instalar dependencias:

```bash
npm install
```

4. Iniciar backend:

```bash
npm run dev:backend
```

5. Iniciar frontend:

```bash
npm run dev:frontend
```

## Despliegue con Docker Compose

1. Crear el archivo de entorno si hace falta:

```bash
cp .env.example .env
```

2. Revisar como minimo:

```bash
POSTGRES_DB=crm_inventory
POSTGRES_USER=crmpro
POSTGRES_PASSWORD=un_password_seguro
user=usuario_app
password=password_app
JWT_SECRET=un_secreto_largo_y_aleatorio
```

3. Levantar el stack completo:

```bash
docker compose up -d --build
```

4. Accesos esperados:

- Frontend: `http://localhost`
- Backend interno: `http://backend:4000` dentro de la red de Docker
- Base de datos: disponible solo dentro de la red `crm-network`

## Arquitectura Docker

- `frontend`: imagen multi-stage con Vite build + Nginx
- `backend`: imagen Node.js orientada a produccion
- `postgres`: contenedor PostgreSQL con inicializacion por `schema.sql` y `seed.sql`
- Red compartida: `crm-network`
- Volumen persistente: `postgres_data`

## Buenas practicas incluidas

- La base de datos no expone puerto al host por defecto.
- El frontend consume la API por `/api` y Nginx hace proxy al backend.
- Hay `healthchecks` para base de datos, backend y frontend.
- Las imagenes separan build y runtime donde aplica.
- El entorno sensible vive en `.env` y existe `.env.example` para bootstrap.

## Endpoints principales

- `GET /api/dashboard`
- `GET /api/inventory`
- `POST /api/inventory`
- `GET /api/products`
- `POST /api/products`
- `GET /api/orders`
- `POST /api/orders`
- `GET /api/production/plan`
- `POST /api/production/execute`

## Modelo operativo

- Un producto puede ser un kit o producto preparado.
- Cada producto tiene componentes ligados al inventario.
- Los pedidos agregan demanda.
- El plan de produccion consolida pedidos pendientes.
- La ejecucion descuenta inventario y marca pedidos como procesados.
