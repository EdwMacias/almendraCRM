-- Credenciales de acceso de la app:
-- Se cargan desde .env usando las variables `user` y `password`.
-- La firma de sesion JWT se carga desde `JWT_SECRET`.

INSERT INTO inventory_items (name, sku, unit, stock)
VALUES
  ('Lapicero', 'LAP-001', 'unidad', 110),
  ('Bolsa', 'BOL-001', 'unidad', 50),
  ('Monedero', 'MON-001', 'unidad', 30),
  ('Chocolatina', 'CHO-001', 'unidad', 80)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, type, notes)
VALUES
  ('Kit de felicidad', 'kit', 'Kit base solicitado por clientes'),
  ('Bolsa individual', 'preparado', 'Entrega directa de bolsa'),
  ('Cutke', 'preparado', 'Producto de ejemplo')
ON CONFLICT (name) DO NOTHING;

INSERT INTO product_components (product_id, inventory_item_id, quantity)
SELECT p.id, i.id, x.quantity
FROM (
  VALUES
    ('Kit de felicidad', 'LAP-001', 1),
    ('Kit de felicidad', 'MON-001', 1),
    ('Bolsa individual', 'BOL-001', 1),
    ('Cutke', 'CHO-001', 2)
) AS x(product_name, sku, quantity)
JOIN products p ON p.name = x.product_name
JOIN inventory_items i ON i.sku = x.sku
ON CONFLICT DO NOTHING;
