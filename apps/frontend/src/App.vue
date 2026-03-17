<script setup>
import { computed, onMounted, reactive, ref, watchEffect } from "vue";
import { useFetch, useNow, useStorage } from "@vueuse/core";

const apiBase = useStorage(
  "crm-api-base",
  import.meta.env.VITE_API_URL || "http://localhost:4000/api"
);
const theme = useStorage("crm-theme", "dark");
const authToken = useStorage("crm-auth-token", "");
const authUser = useStorage("crm-auth-user", "");

const now = useNow({ interval: 1000 });
const refreshKey = ref(0);

const inventoryForm = reactive({
  name: "",
  sku: "",
  unit: "unidad",
  stock: 0
});
const inventoryEditors = reactive({});

const productForm = reactive({
  name: "",
  type: "kit",
  notes: "",
  components: [{ inventoryItemId: "", quantity: 1 }]
});

const orderForm = reactive({
  customerName: "",
  items: [{ productId: "", quantity: 1 }]
});
const loginForm = reactive({
  username: "",
  password: ""
});

const inventoryUrl = computed(() => `${apiBase.value}/inventory?refresh=${refreshKey.value}`);
const productsUrl = computed(() => `${apiBase.value}/products?refresh=${refreshKey.value}`);
const ordersUrl = computed(() => `${apiBase.value}/orders?refresh=${refreshKey.value}`);
const dashboardUrl = computed(() => `${apiBase.value}/dashboard?refresh=${refreshKey.value}`);
const productionUrl = computed(() => `${apiBase.value}/production/plan?refresh=${refreshKey.value}`);

const dashboardRequest = useFetch(dashboardUrl, { refetch: true }).get().json();
const inventoryRequest = useFetch(inventoryUrl, { refetch: true }).get().json();
const productsRequest = useFetch(productsUrl, { refetch: true }).get().json();
const ordersRequest = useFetch(ordersUrl, { refetch: true }).get().json();
const productionRequest = useFetch(productionUrl, { refetch: true }).get().json();

const dashboard = computed(() => dashboardRequest.data.value || {});
const dashboardSummary = computed(() => ({
  inventory: {
    totalItems: dashboard.value.inventory?.total_items ?? 0,
    totalStock: dashboard.value.inventory?.total_stock ?? 0
  },
  products: {
    totalProducts: dashboard.value.products?.total_products ?? 0
  },
  orders: {
    pendingOrders: dashboard.value.orders?.pending_orders ?? 0,
    totalOrders: dashboard.value.orders?.total_orders ?? 0
  },
  production: {
    shortages: dashboard.value.production?.shortages ?? 0
  }
}));
const inventory = computed(() => inventoryRequest.data.value || []);
const products = computed(() => productsRequest.data.value || []);
const orders = computed(() => ordersRequest.data.value || []);
const production = computed(() => productionRequest.data.value || { products: [], materials: [], shortages: [] });
const recentOrders = computed(() => orders.value.slice(0, 5));

const statusMessage = ref("");
const statusTone = ref("info");
const activeTab = ref("inventory");
const isLoginModalOpen = ref(false);
const authChecking = ref(false);
let notificationTimer;

const tabs = [
  { id: "inventory", label: "Inventario", caption: "Stock base y disponibilidad", icon: "inventory" },
  { id: "products", label: "Productos", caption: "Catalogo y componentes", icon: "products" },
  { id: "production", label: "Produccion", caption: "Pedidos, faltantes y ejecucion", icon: "production" },
  { id: "tracking", label: "Seguimiento", caption: "Historial completo de pedidos", icon: "tracking" }
];

const isLightTheme = computed(() => theme.value === "light");
const isAuthenticated = computed(() => Boolean(authToken.value));

watchEffect(() => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme.value;
});

function notify(message, tone = "info") {
  statusMessage.value = message;
  statusTone.value = tone;

  if (notificationTimer) {
    clearTimeout(notificationTimer);
  }

  notificationTimer = setTimeout(() => {
    statusMessage.value = "";
  }, 8000);
}

function dismissNotification() {
  if (notificationTimer) {
    clearTimeout(notificationTimer);
  }

  statusMessage.value = "";
}

function refreshAll() {
  refreshKey.value += 1;
}

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
}

function openLoginModal() {
  isLoginModalOpen.value = true;
}

function closeLoginModal() {
  isLoginModalOpen.value = false;
  loginForm.password = "";
}

function clearSession() {
  authToken.value = "";
  authUser.value = "";
}

function requireAuthenticated() {
  if (isAuthenticated.value) {
    return true;
  }

  notify("Debes iniciar sesion para hacer cambios", "error");
  openLoginModal();
  return false;
}

function ensureInventoryEditor(item) {
  if (!inventoryEditors[item.id]) {
    inventoryEditors[item.id] = {
      value: item.stock
    };
  }

  return inventoryEditors[item.id];
}

watchEffect(() => {
  inventory.value.forEach((item) => {
    ensureInventoryEditor(item);
  });
});

function authHeaders() {
  return authToken.value
    ? { Authorization: `Bearer ${authToken.value}` }
    : {};
}

function handleAuthFailure(response, payload) {
  if (response.status === 401) {
    clearSession();
    openLoginModal();
    throw new Error(payload.message || "Sesion invalida o expirada");
  }
}

async function deleteResource(path, successMessage) {
  const response = await fetch(`${apiBase.value}${path}`, {
    method: "DELETE",
    headers: authHeaders()
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    handleAuthFailure(response, payload);
    throw new Error(payload.detail || payload.message || "No se pudo eliminar el registro");
  }

  notify(successMessage, "success");
  refreshAll();
}

async function sendJson(path, method, body) {
  const response = await fetch(`${apiBase.value}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    handleAuthFailure(response, payload);
    throw new Error(payload.detail || payload.message || "No se pudo completar la operacion");
  }

  return payload;
}

async function login() {
  try {
    authChecking.value = true;

    const response = await fetch(`${apiBase.value}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginForm.username,
        password: loginForm.password
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.detail || payload.message || "No se pudo iniciar sesion");
    }

    authToken.value = payload.token;
    authUser.value = payload.user;
    loginForm.password = "";
    isLoginModalOpen.value = false;
    notify(`Sesion iniciada como ${payload.user}`, "success");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    authChecking.value = false;
  }
}

async function verifySession() {
  if (!authToken.value) {
    return;
  }

  try {
    authChecking.value = true;
    const response = await fetch(`${apiBase.value}/auth/session`, {
      headers: authHeaders()
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      clearSession();
      return;
    }

    authUser.value = payload.user;
  } finally {
    authChecking.value = false;
  }
}

function logout() {
  clearSession();
  notify("Sesion cerrada", "info");
}

onMounted(() => {
  verifySession();
});

async function confirmDeleteInventory(item) {
  if (!requireAuthenticated()) {
    return;
  }

  if (!window.confirm(`Vas a borrar el insumo "${item.name}". Esta accion no se puede deshacer.`)) {
    return;
  }

  try {
    await deleteResource(`/inventory/${item.id}`, "Insumo eliminado");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function confirmDeleteOrder(order) {
  if (!requireAuthenticated()) {
    return;
  }

  if (!window.confirm(`Vas a borrar el pedido de "${order.customer_name}". Esta accion no se puede deshacer.`)) {
    return;
  }

  try {
    await deleteResource(`/orders/${order.id}`, "Pedido eliminado");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function submitInventory() {
  if (!requireAuthenticated()) {
    return;
  }

  try {
    await sendJson("/inventory", "POST", {
      name: inventoryForm.name,
      sku: inventoryForm.sku,
      unit: inventoryForm.unit,
      stock: Number(inventoryForm.stock)
    });

    inventoryForm.name = "";
    inventoryForm.sku = "";
    inventoryForm.unit = "unidad";
    inventoryForm.stock = 0;
    notify("Inventario registrado", "success");
    refreshAll();
  } catch (error) {
    notify(error.message, "error");
  }
}

function addProductComponent() {
  productForm.components.push({ inventoryItemId: "", quantity: 1 });
}

async function submitProduct() {
  if (!requireAuthenticated()) {
    return;
  }

  try {
    await sendJson("/products", "POST", {
      name: productForm.name,
      type: productForm.type,
      notes: productForm.notes,
      components: productForm.components.map((component) => ({
        inventoryItemId: Number(component.inventoryItemId),
        quantity: Number(component.quantity)
      }))
    });

    productForm.name = "";
    productForm.type = "kit";
    productForm.notes = "";
    productForm.components = [{ inventoryItemId: "", quantity: 1 }];
    notify("Producto configurado", "success");
    refreshAll();
  } catch (error) {
    notify(error.message, "error");
  }
}

function addOrderItem() {
  orderForm.items.push({ productId: "", quantity: 1 });
}

async function submitOrder() {
  if (!requireAuthenticated()) {
    return;
  }

  try {
    await sendJson("/orders", "POST", {
      customerName: orderForm.customerName,
      items: orderForm.items.map((item) => ({
        productId: Number(item.productId),
        quantity: Number(item.quantity)
      }))
    });

    orderForm.customerName = "";
    orderForm.items = [{ productId: "", quantity: 1 }];
    notify("Pedido registrado", "success");
    refreshAll();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function executeProduction() {
  if (!requireAuthenticated()) {
    return;
  }

  try {
    const result = await sendJson("/production/execute", "POST", {});
    notify(result.executed ? "Produccion ejecutada e inventario actualizado" : result.message, result.executed ? "success" : "error");
    refreshAll();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function saveInventoryEdit(item) {
  if (!requireAuthenticated()) {
    return;
  }

  const editor = ensureInventoryEditor(item);
  const rawValue = Number(editor.value);

  if (!Number.isFinite(rawValue) || rawValue < 0) {
    notify("El valor del stock debe ser un numero valido", "error");
    return;
  }

  try {
    await sendJson(`/inventory/${item.id}`, "PUT", { stock: rawValue });
    inventoryEditors[item.id] = {
      value: rawValue
    };
    notify("Stock actualizado", "success");
    refreshAll();
  } catch (error) {
    notify(error.message, "error");
  }
}

function increaseInventoryValue(item, amount = 1) {
  const editor = ensureInventoryEditor(item);
  editor.value = Number(editor.value || 0) + amount;
}

function decreaseInventoryValue(item, amount = 1) {
  const editor = ensureInventoryEditor(item);
  editor.value = Math.max(0, Number(editor.value || 0) - amount);
}

const summaryCards = computed(() => [
  {
    label: "Insumos registrados",
    value: dashboardSummary.value.inventory.totalItems,
    detail: `${dashboardSummary.value.inventory.totalStock} unidades disponibles`
  },
  {
    label: "Productos configurados",
    value: dashboardSummary.value.products.totalProducts,
    detail: "Kits y productos preparados"
  },
  {
    label: "Pedidos pendientes",
    value: dashboardSummary.value.orders.pendingOrders,
    detail: `${dashboardSummary.value.orders.totalOrders} pedidos totales`
  },
  {
    label: "Alertas de stock",
    value: dashboardSummary.value.production.shortages,
    detail: "Faltantes para produccion"
  }
]);

const inventoryInsight = computed(() => {
  const total = inventory.value.length;
  const outOfStock = inventory.value.filter((item) => Number(item.stock) === 0).length;
  const lowStock = inventory.value.filter((item) => Number(item.stock) > 0 && Number(item.stock) <= 5).length;

  return { total, outOfStock, lowStock };
});

const productsInsight = computed(() => {
  const withoutNotes = products.value.filter((product) => !product.notes).length;
  const totalComponents = products.value.reduce((sum, product) => sum + product.components.length, 0);

  return { withoutNotes, totalComponents };
});

const productionMaterials = computed(() => production.value.materials.map((item) => {
  const coverage = item.requiredQuantity === 0
    ? 100
    : Math.min(100, Math.round((item.currentStock / item.requiredQuantity) * 100));

  let status = "ok";
  let label = "Al dia";

  if (item.currentStock < item.requiredQuantity) {
    status = "short";
    label = "Falta stock";
  } else if (item.currentStock === item.requiredQuantity) {
    status = "tight";
    label = "Justo";
  }

  return {
    ...item,
    coverage,
    remainingAfterProduction: item.currentStock - item.requiredQuantity,
    status,
    label
  };
}));

const productionStatusCards = computed(() => [
  {
    label: "Pedidos por ejecutar",
    value: orders.value.filter((order) => order.status === "pendiente").length,
    tone: "slate",
    detail: "Carga activa en cola"
  },
  {
    label: "Productos a preparar",
    value: production.value.products.length,
    tone: "orange",
    detail: "Referencias pendientes"
  },
  {
    label: "Materiales con faltante",
    value: production.value.shortages.length,
    tone: "rose",
    detail: "Requieren reposicion"
  },
  {
    label: "Materiales al dia",
    value: productionMaterials.value.filter((item) => item.status === "ok").length,
    tone: "emerald",
    detail: "Listos para ejecutar"
  }
]);

const productionChecklist = computed(() => {
  const pendingOrders = orders.value.filter((order) => order.status === "pendiente").length;
  const shortageCount = production.value.shortages.length;

  return [
    {
      title: "Consolidar pedidos",
      description: pendingOrders
        ? `${pendingOrders} pedidos pendientes listos para planificacion.`
        : "No hay pedidos pendientes por consolidar.",
      done: pendingOrders > 0
    },
    {
      title: "Validar insumos",
      description: shortageCount
        ? `${shortageCount} materiales requieren reposicion antes de producir.`
        : "Todo el stock necesario esta cubierto.",
      done: shortageCount === 0
    },
    {
      title: "Ejecutar produccion",
      description: pendingOrders
        ? "La ejecucion descontara inventario y cerrara pedidos pendientes."
        : "No hay ejecucion pendiente en este momento.",
      done: pendingOrders === 0
    }
  ];
});

const trackingMetrics = computed(() => [
  {
    label: "Insumos activos",
    value: inventoryInsight.value.total,
    detail: `${dashboardSummary.value.inventory.totalStock} en stock`,
    tone: "slate"
  },
  {
    label: "Stock bajo",
    value: inventoryInsight.value.lowStock,
    detail: `${inventoryInsight.value.outOfStock} agotados`,
    tone: "amber"
  },
  {
    label: "Productos activos",
    value: products.length,
    detail: `${productsInsight.value.totalComponents} componentes`,
    tone: "sky"
  },
  {
    label: "Pedidos pendientes",
    value: dashboardSummary.value.orders.pendingOrders,
    detail: `${dashboardSummary.value.orders.totalOrders} totales`,
    tone: "orange"
  },
  {
    label: "Produccion pendiente",
    value: production.value.products.length,
    detail: `${production.value.shortages.length} faltantes`,
    tone: "rose"
  },
  {
    label: "Materiales listos",
    value: productionMaterials.value.filter((item) => item.status === "ok").length,
    detail: `${productionMaterials.value.length} evaluados`,
    tone: "emerald"
  }
]);

const trackingOrderStats = computed(() => {
  const total = orders.value.length;
  const pending = orders.value.filter((order) => order.status === "pendiente").length;
  const completed = orders.value.filter((order) => order.status === "procesado").length;
  const pendingPercent = total ? Math.round((pending / total) * 100) : 0;
  const completedPercent = total ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    pending,
    completed,
    pendingPercent,
    completedPercent,
    chartStyle: {
      background: `conic-gradient(#f59e0b 0 ${pendingPercent}%, #10b981 ${pendingPercent}% 100%)`
    }
  };
});
</script>

<template>
  <main class="app-shell min-h-screen text-slate-100" :class="{ 'theme-light': isLightTheme }">
    <section class="mx-auto max-w-7xl px-3 py-4 sm:px-4 lg:px-5">
      <div class="panel-shell overflow-hidden rounded-[32px] border border-white/10 bg-white/5 shadow-panel backdrop-blur">
        <div v-if="!isAuthenticated" class="nav-readonly-banner border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 lg:px-6">
          El aplicativo esta en modo lectura. Debes iniciar sesion para crear, editar, borrar o ejecutar produccion.
        </div>

        <div class="panel-divider border-b border-white/10 px-4 py-4 lg:px-6">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="eyebrow text-xs uppercase tracking-[0.28em] text-orange-300">camipedidos</p>
              <h1 class="app-title mt-1 text-2xl font-semibold text-sand sm:text-3xl">camipedidos</h1>
              <p class="support-text mt-2 max-w-2xl text-sm text-slate-300">
                Flujo basado en registro de inventario, pedidos, plan de produccion y actualizacion automatica de stock.
              </p>
            </div>
            <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                class="auth-trigger rounded-2xl px-3 py-2 text-sm font-medium"
                :aria-label="isAuthenticated ? 'Sesion activa' : 'Iniciar sesion'"
                @click="isAuthenticated ? logout() : openLoginModal()"
              >
                <svg class="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>{{ isAuthenticated ? authUser || "Sesion activa" : "Iniciar sesion" }}</span>
              </button>
              <button
                type="button"
                class="theme-toggle rounded-2xl px-3 py-2 text-sm font-medium"
                :aria-label="isLightTheme ? 'Activar modo oscuro' : 'Activar modo claro'"
                @click="toggleTheme"
              >
                <svg v-if="isLightTheme" class="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3.75V2m0 20v-1.75M5.64 5.64 4.4 4.4m15.2 15.2-1.24-1.24M3.75 12H2m20 0h-1.75M5.64 18.36 4.4 19.6m15.2-15.2-1.24 1.24M12 17.25a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else class="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M20.4 14.5A8.25 8.25 0 0 1 9.5 3.6a8.25 8.25 0 1 0 10.9 10.9Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <div class="highlight-card rounded-2xl border border-orange-400/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-100">
                <div>Hora local: {{ now.toLocaleString() }}</div>
                <div class="mt-1">API: {{ apiBase }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="px-4 pt-2 lg:px-6">
          <div class="tabs-row flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              class="tab-chip"
              :class="{ 'tab-chip-active': activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <span class="tab-chip-top">
                <span class="tab-chip-icon" aria-hidden="true">
                  <svg v-if="tab.icon === 'inventory'" viewBox="0 0 24 24" fill="none">
                    <path d="M4 7.5h16M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <svg v-else-if="tab.icon === 'products'" viewBox="0 0 24 24" fill="none">
                    <path d="m12 3 7 3.5v11L12 21 5 17.5v-11L12 3Zm0 0v18m7-14.5-7 3.5L5 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <svg v-else-if="tab.icon === 'production'" viewBox="0 0 24 24" fill="none">
                    <path d="M4 14h4l2-6 4 10 2-4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none">
                    <path d="M12 7v5l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <span class="tab-chip-title">{{ tab.label }}</span>
              </span>
              <span class="tab-chip-caption">{{ tab.caption }}</span>
            </button>
          </div>
        </div>

        <div v-if="activeTab === 'inventory'" class="space-y-3 px-4 py-4 lg:px-6">
          <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <h2 class="section-title text-xl font-semibold text-sand">1. Inventario inicial</h2>
            <form class="mt-3 grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto]" @submit.prevent="submitInventory">
              <input v-model="inventoryForm.name" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Nombre del insumo" />
              <input v-model="inventoryForm.sku" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="SKU" />
              <input v-model="inventoryForm.unit" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Unidad" />
              <input v-model="inventoryForm.stock" min="0" type="number" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Stock" />
              <button class="rounded-2xl bg-orange-500 px-4 py-2 font-medium text-white">Guardar</button>
            </form>
          </section>

          <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <article class="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
              <p class="text-[11px] text-emerald-100">Disponibles</p>
              <p class="mt-1 text-2xl font-semibold text-white">{{ inventoryInsight.total - inventoryInsight.outOfStock - inventoryInsight.lowStock }}</p>
            </article>
            <article class="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
              <p class="text-[11px] text-amber-100">Stock bajo</p>
              <p class="mt-1 text-2xl font-semibold text-white">{{ inventoryInsight.lowStock }}</p>
            </article>
            <article class="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2">
              <p class="text-[11px] text-rose-100">Agotados</p>
              <p class="mt-1 text-2xl font-semibold text-white">{{ inventoryInsight.outOfStock }}</p>
            </article>
            <article class="soft-panel rounded-2xl border border-white/10 px-3 py-2">
              <p class="muted-text text-[11px] uppercase tracking-[0.1em] text-slate-400">Insumos</p>
              <p class="strong-text mt-1 text-2xl font-semibold text-white">{{ inventoryInsight.total }}</p>
            </article>
            <article class="soft-panel rounded-2xl border border-white/10 px-3 py-2">
              <p class="muted-text text-[11px] uppercase tracking-[0.1em] text-slate-400">Stock total</p>
              <p class="strong-text mt-1 text-2xl font-semibold text-white">{{ dashboardSummary.inventory.totalStock }}</p>
            </article>
          </div>

          <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <h3 class="section-title text-lg font-semibold text-white">Insumos registrados</h3>
              <p class="support-text text-xs">Edita el valor final o aplica suma/resta por fila.</p>
            </div>
            <div class="hidden grid-cols-[1.2fr_0.8fr_0.6fr_1fr_auto_auto] gap-2 border-b border-white/10 pb-2 text-[11px] uppercase tracking-[0.08em] text-slate-400 lg:grid">
              <span>Insumo</span>
              <span>SKU / Unidad</span>
              <span>Actual</span>
              <span>Valor</span>
              <span>Guardar</span>
              <span>Borrar</span>
            </div>
            <div class="mt-2 space-y-2">
              <article
                v-for="item in inventory"
                :key="item.id"
                class="soft-panel rounded-2xl border border-white/10 p-3"
              >
                <div class="grid gap-2 lg:grid-cols-[1.2fr_0.8fr_0.6fr_1fr_auto_auto] lg:items-center">
                  <div>
                    <p class="strong-text text-sm font-medium text-white">{{ item.name }}</p>
                  </div>
                  <div>
                    <p class="muted-text text-xs text-slate-400">{{ item.sku }} · {{ item.unit }}</p>
                  </div>
                  <div>
                    <span
                      class="inline-flex rounded-full px-3 py-1 text-sm"
                      :class="Number(item.stock) === 0
                        ? 'bg-rose-500/15 text-rose-100'
                        : Number(item.stock) <= 5
                          ? 'bg-amber-500/15 text-amber-100'
                          : 'bg-emerald-500/15 text-emerald-100'"
                    >
                      {{ item.stock }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <button type="button" class="action-secondary px-3 py-2 text-sm" @click="decreaseInventoryValue(item)">
                      -
                    </button>
                    <input
                      v-model="ensureInventoryEditor(item).value"
                      min="0"
                      type="number"
                      class="field-control min-w-0 rounded-2xl border border-white/10 px-3 py-2 text-sm"
                      placeholder="Valor"
                    />
                    <button type="button" class="action-secondary px-3 py-2 text-sm" @click="increaseInventoryValue(item)">
                      +
                    </button>
                  </div>
                  <button type="button" class="action-secondary px-3 py-2 text-sm" @click="saveInventoryEdit(item)">
                    Guardar
                  </button>
                  <button type="button" class="danger-button px-3 py-2 text-sm" @click="confirmDeleteInventory(item)">
                    Borrar
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-else-if="activeTab === 'products'" class="space-y-3 px-4 py-4 lg:px-6">
          <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <h2 class="section-title text-xl font-semibold text-sand">2. Catalogo de productos</h2>
            <form class="mt-3 space-y-2" @submit.prevent="submitProduct">
              <div class="grid gap-2 md:grid-cols-[1.2fr_0.8fr]">
                <input v-model="productForm.name" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Nombre del producto o kit" />
                <select v-model="productForm.type" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <option value="kit">Kit</option>
                  <option value="preparado">Preparado</option>
                </select>
              </div>
              <textarea v-model="productForm.notes" class="field-control min-h-20 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Notas"></textarea>
              <div class="space-y-2">
                <div
                  v-for="(component, index) in productForm.components"
                  :key="index"
                  class="grid gap-2 md:grid-cols-[1fr_120px]"
                >
                  <select v-model="component.inventoryItemId" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                    <option disabled value="">Selecciona insumo</option>
                    <option v-for="item in inventory" :key="item.id" :value="item.id">
                      {{ item.name }} ({{ item.stock }})
                    </option>
                  </select>
                  <input v-model="component.quantity" type="number" min="1" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Cantidad" />
                </div>
              </div>
              <div class="flex gap-2">
                <button type="button" class="action-secondary rounded-2xl border border-white/10 px-3 py-2" @click="addProductComponent">
                  Agregar componente
                </button>
                <button class="rounded-2xl bg-orange-500 px-4 py-2 font-medium text-white">
                  Guardar producto
                </button>
              </div>
            </form>
          </section>

          <div class="grid gap-2 md:grid-cols-3">
            <article class="rounded-2xl border border-orange-500/20 bg-orange-500/10 px-3 py-2">
              <p class="text-[11px] text-orange-100">Productos</p>
              <p class="mt-1 text-2xl font-semibold text-white">{{ products.length }}</p>
            </article>
            <article class="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-2">
              <p class="text-[11px] text-sky-100">Componentes ligados</p>
              <p class="mt-1 text-2xl font-semibold text-white">{{ productsInsight.totalComponents }}</p>
            </article>
            <article class="soft-panel rounded-2xl border border-white/10 px-3 py-2">
              <p class="muted-text text-[11px] uppercase tracking-[0.1em] text-slate-400">Sin notas</p>
              <p class="strong-text mt-1 text-2xl font-semibold text-white">{{ productsInsight.withoutNotes }}</p>
            </article>
          </div>

          <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <h3 class="section-title text-lg font-semibold text-white">Productos configurados</h3>
              <p class="support-text text-xs">Panel operativo de componentes e insumos requeridos.</p>
            </div>
            <div class="hidden grid-cols-[1fr_0.8fr_0.8fr_1.8fr] gap-2 border-b border-white/10 pb-2 text-[11px] uppercase tracking-[0.08em] text-slate-400 lg:grid">
              <span>Producto</span>
              <span>Tipo</span>
              <span>Comp.</span>
              <span>Insumos requeridos</span>
            </div>
            <div class="mt-2 space-y-2">
              <article
                v-for="product in products"
                :key="product.id"
                class="soft-panel rounded-2xl border border-white/10 p-3"
              >
                <div class="grid gap-2 lg:grid-cols-[1fr_0.8fr_0.8fr_1.8fr] lg:items-center">
                  <div>
                    <p class="strong-text text-sm font-medium text-white">{{ product.name }}</p>
                    <p class="muted-text text-xs text-slate-400">{{ product.notes || 'Sin notas' }}</p>
                  </div>
                  <div>
                    <span class="rounded-full bg-sky-500/15 px-3 py-1 text-xs text-sky-100">{{ product.type }}</span>
                  </div>
                  <div>
                    <span class="rounded-full bg-orange-500/15 px-3 py-1 text-xs text-orange-100">{{ product.components.length }} comp.</span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="component in product.components"
                      :key="component.id"
                      class="subtle-chip rounded-full border border-white/10 px-2 py-1 text-[11px]"
                    >
                      {{ component.inventoryItemName }} x{{ component.quantity }}
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-else-if="activeTab === 'production'" class="space-y-3 px-4 py-4 lg:px-6">
          <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <h2 class="section-title text-xl font-semibold text-sand">3. Registro de pedidos</h2>
            <form class="mt-3 space-y-2" @submit.prevent="submitOrder">
              <input v-model="orderForm.customerName" class="field-control w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Nombre del solicitante" />
              <div class="space-y-2">
                <div
                  v-for="(item, index) in orderForm.items"
                  :key="index"
                  class="grid gap-2 md:grid-cols-[1fr_120px]"
                >
                  <select v-model="item.productId" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                    <option disabled value="">Selecciona producto</option>
                    <option v-for="product in products" :key="product.id" :value="product.id">
                      {{ product.name }}
                    </option>
                  </select>
                  <input v-model="item.quantity" type="number" min="1" class="field-control rounded-2xl border border-white/10 bg-white/5 px-3 py-2" placeholder="Cantidad" />
                </div>
              </div>
              <div class="flex gap-2">
                <button type="button" class="action-secondary rounded-2xl border border-white/10 px-3 py-2" @click="addOrderItem">
                  Agregar item
                </button>
                <button class="rounded-2xl bg-orange-500 px-4 py-2 font-medium text-white">
                  Guardar pedido
                </button>
              </div>
            </form>
          </section>

          <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <article
              v-for="card in productionStatusCards"
              :key="card.label"
              class="rounded-2xl border px-3 py-2"
              :class="{
                'border-white/10 bg-white/5': card.tone === 'slate',
                'border-orange-500/20 bg-orange-500/10': card.tone === 'orange',
                'border-rose-500/20 bg-rose-500/10': card.tone === 'rose',
                'border-emerald-500/20 bg-emerald-500/10': card.tone === 'emerald'
              }"
            >
              <p class="text-[11px] uppercase tracking-[0.08em] text-slate-300">{{ card.label }}</p>
              <p class="mt-1 text-2xl font-semibold text-white">{{ card.value }}</p>
              <p class="mt-1 text-[11px] text-slate-400">{{ card.detail }}</p>
            </article>
          </div>

          <div class="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <article class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <div class="flex items-center justify-between gap-3">
                <h3 class="section-title text-lg font-semibold text-white">Pedidos en seguimiento</h3>
                <button type="button" class="action-secondary px-3 py-2 text-sm" @click="activeTab = 'tracking'">
                  Ver mas
                </button>
              </div>
              <div class="mt-3 space-y-2">
              <article
                v-for="order in recentOrders"
                :key="order.id"
                class="soft-panel rounded-2xl border border-white/10 bg-white/5 p-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="strong-text font-medium text-white">{{ order.customer_name }}</p>
                    <p class="muted-text text-sm text-slate-400">{{ order.items.map((entry) => `${entry.quantity} ${entry.productName}`).join(', ') }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="rounded-full px-3 py-1 text-sm"
                      :class="order.status === 'pendiente' ? 'bg-amber-500/15 text-amber-100' : 'bg-emerald-500/15 text-emerald-100'"
                    >
                      {{ order.status }}
                    </span>
                    <button type="button" class="danger-button px-3 py-1 text-xs" @click="confirmDeleteOrder(order)">
                      Borrar
                    </button>
                  </div>
                </div>
              </article>
              <p v-if="!recentOrders.length" class="muted-text text-sm text-slate-400">Todavia no hay pedidos registrados.</p>
              </div>
            </article>

            <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <h2 class="section-title text-xl font-semibold text-sand">4. Produccion y control</h2>
              <div class="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
              <div class="soft-panel rounded-2xl border border-white/10 bg-white/5 p-3">
                <h3 class="section-title font-medium text-white">Checklist operativo</h3>
                <div class="mt-2 space-y-2">
                  <article
                    v-for="task in productionChecklist"
                    :key="task.title"
                    class="subtle-card rounded-2xl border border-white/10 bg-slate-900/80 p-2"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <p class="strong-text font-medium text-white">{{ task.title }}</p>
                        <p class="muted-text text-sm text-slate-400">{{ task.description }}</p>
                      </div>
                      <span
                        class="rounded-full px-3 py-1 text-xs"
                        :class="task.done ? 'bg-emerald-500/15 text-emerald-100' : 'bg-amber-500/15 text-amber-100'"
                      >
                        {{ task.done ? 'OK' : 'Pendiente' }}
                      </span>
                    </div>
                  </article>
                </div>
              </div>

              <div class="soft-panel rounded-2xl border border-white/10 bg-white/5 p-3">
                <h3 class="section-title font-medium text-white">Preparacion requerida</h3>
                <div class="mt-2 space-y-2">
                  <article
                    v-for="item in production.products"
                    :key="item.productId"
                    class="subtle-card rounded-2xl border border-white/10 bg-slate-900/80 p-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p class="strong-text font-medium text-white">{{ item.productName }}</p>
                        <p class="muted-text text-sm text-slate-400">Preparar {{ item.totalQuantity }} unidades</p>
                      </div>
                      <span class="rounded-full bg-orange-500/15 px-3 py-1 text-sm text-orange-100">
                        {{ item.totalQuantity }}
                      </span>
                    </div>
                  </article>
                  <p v-if="!production.products.length" class="muted-text text-sm text-slate-400">No hay produccion pendiente.</p>
                </div>
              </div>
            </div>

            <div class="mt-3 grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
              <div class="soft-panel rounded-2xl border border-white/10 bg-white/5 p-3">
                <h3 class="section-title font-medium text-white">Materiales necesarios</h3>
                <div class="mt-2 space-y-2">
                  <article
                    v-for="item in productionMaterials"
                    :key="item.inventoryItemId"
                    class="subtle-card rounded-2xl border border-white/10 bg-slate-900/80 p-3"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p class="strong-text font-medium text-white">{{ item.inventoryItemName }}</p>
                        <p class="muted-text text-sm text-slate-400">{{ item.sku }} · {{ item.requiredQuantity }} {{ item.unit }} requeridas</p>
                      </div>
                      <span
                        class="rounded-full px-3 py-1 text-xs"
                        :class="item.status === 'short'
                          ? 'bg-rose-500/15 text-rose-100'
                          : item.status === 'tight'
                            ? 'bg-amber-500/15 text-amber-100'
                            : 'bg-emerald-500/15 text-emerald-100'"
                      >
                        {{ item.label }}
                      </span>
                    </div>
                    <div class="mt-3">
                      <div class="muted-text flex items-center justify-between text-xs text-slate-400">
                        <span>Stock actual: {{ item.currentStock }}</span>
                        <span>Cobertura: {{ item.coverage }}%</span>
                      </div>
                      <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          class="h-full rounded-full"
                          :class="item.status === 'short'
                            ? 'bg-rose-400'
                            : item.status === 'tight'
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'"
                          :style="{ width: `${item.coverage}%` }"
                        />
                      </div>
                    </div>
                    <p class="mt-3 text-sm" :class="item.remainingAfterProduction < 0 ? 'text-rose-100' : 'support-text text-slate-300'">
                      {{ item.remainingAfterProduction < 0
                        ? `Faltan ${Math.abs(item.remainingAfterProduction)} ${item.unit} para completar la produccion.`
                        : `Quedarian ${item.remainingAfterProduction} ${item.unit} despues de ejecutar.` }}
                    </p>
                  </article>
                  <p v-if="!productionMaterials.length" class="muted-text text-sm text-slate-400">Sin consumo proyectado.</p>
                </div>
              </div>

              <div class="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3">
                <h3 class="font-medium text-rose-100">Alertas de faltantes</h3>
                <div class="mt-2 space-y-2">
                  <p v-if="!production.shortages.length" class="text-sm text-emerald-100">Stock suficiente para ejecutar la produccion.</p>
                <article
                  v-for="item in production.shortages"
                  :key="item.inventory_item_id"
                  class="rounded-2xl border border-rose-500/20 bg-slate-900/80 p-3"
                >
                  <p class="font-medium text-white">{{ item.inventory_item_name }}</p>
                  <p class="text-sm text-rose-100">Faltan {{ item.missingQuantity }} unidades</p>
                </article>
                </div>
              </div>
            </div>

            <button
              class="mt-3 w-full rounded-2xl bg-emerald-500 px-4 py-2 font-medium text-slate-950"
              @click="executeProduction"
            >
              Ejecutar produccion y descontar inventario
            </button>
            </section>
          </div>
        </div>

        <div v-else class="space-y-3 px-4 py-4 lg:px-6">
          <section class="content-panel rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="section-title text-xl font-semibold text-sand">Seguimiento de pedidos</h2>
                <p class="support-text mt-1 text-sm">Vista ejecutiva de inventario, productos, produccion y pedidos en tiempo real.</p>
              </div>
              <button type="button" class="action-secondary px-3 py-2 text-sm" @click="activeTab = 'production'">
                Volver a produccion
              </button>
            </div>

            <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[220px_repeat(6,minmax(0,1fr))]">
              <article class="soft-panel rounded-2xl border border-white/10 px-3 py-2">
                <div class="flex items-center gap-3">
                  <div class="pie-chart" :style="trackingOrderStats.chartStyle">
                    <div class="pie-chart-center">
                      <span>{{ trackingOrderStats.total }}</span>
                    </div>
                  </div>
                  <div class="min-w-0">
                    <p class="muted-text text-[11px] uppercase tracking-[0.08em] text-slate-400">Pedidos totales</p>
                    <p class="strong-text text-xl font-semibold text-white">{{ trackingOrderStats.total }}</p>
                    <p class="text-[11px] text-amber-100">Pendientes: {{ trackingOrderStats.pending }} · {{ trackingOrderStats.pendingPercent }}%</p>
                    <p class="text-[11px] text-emerald-100">Terminados: {{ trackingOrderStats.completed }} · {{ trackingOrderStats.completedPercent }}%</p>
                  </div>
                </div>
              </article>
              <article
                v-for="metric in trackingMetrics"
                :key="metric.label"
                class="rounded-2xl border px-3 py-2"
                :class="{
                  'border-white/10 bg-white/5': metric.tone === 'slate',
                  'border-amber-500/20 bg-amber-500/10': metric.tone === 'amber',
                  'border-sky-500/20 bg-sky-500/10': metric.tone === 'sky',
                  'border-orange-500/20 bg-orange-500/10': metric.tone === 'orange',
                  'border-rose-500/20 bg-rose-500/10': metric.tone === 'rose',
                  'border-emerald-500/20 bg-emerald-500/10': metric.tone === 'emerald'
                }"
              >
                <p class="text-[11px] uppercase tracking-[0.08em]" :class="metric.tone === 'slate' ? 'text-slate-300' : ''">
                  {{ metric.label }}
                </p>
                <div class="mt-1 flex items-end justify-between gap-2">
                  <p class="text-2xl font-semibold text-white">{{ metric.value }}</p>
                  <p class="truncate text-[11px]" :class="metric.tone === 'slate' ? 'text-slate-400' : ''">
                    {{ metric.detail }}
                  </p>
                </div>
              </article>
            </div>

            <div class="mt-4 space-y-2">
              <article
                v-for="order in orders"
                :key="order.id"
                class="soft-panel rounded-2xl border border-white/10 bg-white/5 p-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="strong-text font-medium text-white">{{ order.customer_name }}</p>
                    <p class="muted-text text-sm text-slate-400">{{ order.items.map((entry) => `${entry.quantity} ${entry.productName}`).join(', ') }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="rounded-full px-3 py-1 text-sm"
                      :class="order.status === 'pendiente' ? 'bg-amber-500/15 text-amber-100' : 'bg-emerald-500/15 text-emerald-100'"
                    >
                      {{ order.status }}
                    </span>
                    <button type="button" class="danger-button px-3 py-1 text-xs" @click="confirmDeleteOrder(order)">
                      Borrar
                    </button>
                  </div>
                </div>
              </article>
              <p v-if="!orders.length" class="muted-text text-sm text-slate-400">Todavia no hay pedidos registrados.</p>
            </div>
          </section>
        </div>
      </div>
    </section>

    <div v-if="isLoginModalOpen" class="auth-modal-backdrop">
      <div class="auth-modal">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-xs uppercase tracking-[0.28em] text-orange-300">Acceso</p>
            <h2 class="section-title mt-1 text-xl font-semibold text-white">Iniciar sesion</h2>
          </div>
          <button type="button" class="action-secondary px-3 py-2 text-sm" @click="closeLoginModal">
            Cerrar
          </button>
        </div>

        <form class="mt-4 space-y-3" @submit.prevent="login">
          <input v-model="loginForm.username" class="field-control w-full rounded-2xl border border-white/10 px-3 py-2" placeholder="Usuario" />
          <input v-model="loginForm.password" type="password" class="field-control w-full rounded-2xl border border-white/10 px-3 py-2" placeholder="Contrasena" />
          <button class="w-full rounded-2xl bg-orange-500 px-4 py-2 font-medium text-white" :disabled="authChecking">
            {{ authChecking ? 'Validando...' : 'Entrar' }}
          </button>
        </form>
      </div>
    </div>

    <div
      v-if="statusMessage"
      class="app-toast"
      :class="{
        'bg-emerald-500/15 text-emerald-100 border-emerald-500/25': statusTone === 'success',
        'bg-rose-500/15 text-rose-100 border-rose-500/25': statusTone === 'error',
        'bg-slate-500/15 text-slate-100 border-white/10': statusTone === 'info'
      }"
    >
      <div class="min-w-0">
        <p class="truncate text-sm">{{ statusMessage }}</p>
      </div>
      <button type="button" class="toast-close" aria-label="Cerrar notificacion" @click="dismissNotification">
        ×
      </button>
    </div>
  </main>
</template>
