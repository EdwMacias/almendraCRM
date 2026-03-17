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

## Arranque

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
