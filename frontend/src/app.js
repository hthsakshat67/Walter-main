let assistantName = "Walter";
let currentUser = null;
let currentToken = localStorage.getItem("auth_token") || null;

const backendOrigin = (() => {
  const override = localStorage.getItem("api_base_url");
  if (override) return override.replace(/\/$/, "");

  const { hostname, port, protocol } = window.location;
  const isLocalFrontend = ["3000", "3001", "5173", "5500", "8080"].includes(port);
  if (protocol.startsWith("http") && ["localhost", "127.0.0.1"].includes(hostname) && isLocalFrontend) {
    return `${protocol}//${hostname}:3003`;
  }

  return "";
})();
const API_BASE = `${backendOrigin}/api/v1`;

// Helper for authenticated API calls
async function apiCall(endpoint, method = "GET", body = null) {
  const headers = { "Content-Type": "application/json" };
  if (currentToken) {
    headers["Authorization"] = `Bearer ${currentToken}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    const text = await res.text();
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Unexpected response from server (${res.status}). Check that the backend is running on port 3003.`);
      }
    }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  } catch (err) {
    console.error(`[API Error] ${method} ${endpoint}:`, err);
    throw err;
  }
}

// Initial session check
async function checkAuthSession() {
  if (!currentToken) return;
  try {
    const res = await apiCall("/auth/me");
    if (res.user) {
      currentUser = res.user;
      if (res.user.assistantName) assistantName = res.user.assistantName;
    }
  } catch (err) {
    localStorage.removeItem("auth_token");
    currentToken = null;
    currentUser = null;
  }
}

const routes = [
  ["overview", "Overview", "Operations", "OV"],
  ["appointments", "Appointments", "Operations", "AP"],
  ["calendar", "Calendar", "Operations", "CA"],
  ["customers", "Customers", "Operations", "CU"],
  ["conversations", "Conversations", "Operations", "CO"],
  ["calls", "AI Phone Calls", "Operations", "PH"],
  ["whatsapp", "WhatsApp", "Channels", "WA"],
  ["email", "Email", "Channels", "EM"],
  ["services", "Services", "Configuration", "SV"],
  ["staff", "Staff", "Configuration", "ST"],
  ["automation", "Automation Rules", "Configuration", "AR"],
  ["analytics", "Analytics", "Configuration", "AN"],
  ["assistant", "AI Assistant Settings", "Configuration", "AI"],
  ["integrations", "Integrations", "Configuration", "IN"],
  ["billing", "Billing", "Configuration", "BI"],
  ["settings", "Business Settings", "Configuration", "SE"],
];

// Reactive State cache
let state = {
  appointments: [],
  conversations: [],
  calls: [],
  customers: [],
  services: [],
  staff: [],
  dashboardSummary: null,
  analytics: null,
  businessSettings: null,
  loading: false,
  error: null,
};

let customerEditor = null;
let serviceEditor = null;
let staffEditor = null;
let appointmentEditor = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function emptyState(title, detail) {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p></div>`;
}

function toDateTimeLocalValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// API Services powering the frontend views
const appointmentService = {
  listToday: () => state.appointments,
  getById: (id) => state.appointments.find((appointment) => String(appointment.id) === String(id)),
  fetch: async () => {
    try {
      const data = await apiCall("/appointments");
      state.appointments = data.map((a) => ({
        id: a.id,
        customerId: a.customerId,
        serviceId: a.serviceId,
        staffId: a.staffId,
        startTime: a.startTime,
        endTime: a.endTime,
        date: new Date(a.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        time: new Date(a.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
        duration: `${a.service?.durationMinutes || 30}m`,
        customer: a.customer?.name || "Customer",
        service: a.service?.name || "Service",
        staff: a.staff?.name || "Staff",
        status: a.status,
        channel: a.channel,
        notes: a.notes || "",
      }));
    } catch (e) {
      console.warn("Using fallback appointment data if unauthorized");
    }
  },
  book: async (input) => {
    const res = await apiCall("/appointments", "POST", input);
    await stateManager.loadAll();
    return res;
  },
  reschedule: async (id, newStartTime) => {
    const res = await apiCall(`/appointments/${id}/reschedule`, "POST", { newStartTime });
    await stateManager.loadAll();
    return res;
  },
  cancel: async (id) => {
    const res = await apiCall(`/appointments/${id}/cancel`, "POST", { reason: "Cancelled from dashboard" });
    await stateManager.loadAll();
    return res;
  },
  confirm: async (id) => {
    const res = await apiCall(`/appointments/${id}/confirm`, "POST");
    await stateManager.loadAll();
    return res;
  },
};

const customerService = {
  list: () => state.customers,
  getById: (id) => state.customers.find((customer) => String(customer.id) === String(id)),
  fetch: async () => {
    try {
      const data = await apiCall("/customers");
      state.customers = data.map((customer) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
        segment: customer.segment || "Standard",
        notes: customer.notes || "",
      }));
    } catch (e) {}
  },
  create: async (data) => {
    await apiCall("/customers", "POST", data);
    await customerService.fetch();
  },
  update: async (id, data) => {
    await apiCall(`/customers/${id}`, "PATCH", data);
    await customerService.fetch();
  },
};

const serviceCatalog = {
  list: () => state.services,
  fetch: async () => {
    try {
      const data = await apiCall("/services");
      state.services = data.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description || "No description yet",
        durationMinutes: service.durationMinutes || 30,
        bufferMinutes: service.bufferMinutes || 0,
        rawPrice: Number(service.price || 0),
        duration: `${service.durationMinutes || 30} min`,
        buffer: `${service.bufferMinutes || 0} min buffer`,
        price: Number(service.price || 0).toLocaleString("en-US", { style: "currency", currency: "USD" }),
        active: service.active,
      }));
    } catch (e) {}
  },
  create: async (data) => {
    await apiCall("/services", "POST", data);
    await serviceCatalog.fetch();
  },
};

const staffDirectory = {
  list: () => state.staff,
  fetch: async () => {
    try {
      const data = await apiCall("/staff");
      state.staff = data.map((staff) => ({
        id: staff.id,
        name: staff.name,
        title: staff.title || "Team member",
        email: staff.email || "No email",
        phone: staff.phone || "No phone",
        active: staff.active,
      }));
    } catch (e) {}
  },
  create: async (data) => {
    await apiCall("/staff", "POST", data);
    await staffDirectory.fetch();
  },
};

const conversationService = {
  list: () => state.conversations,
  byChannel: (channel) => state.conversations.filter((item) => item.channel.toLowerCase() === channel.toLowerCase()),
  fetch: async () => {
    try {
      const data = await apiCall("/conversations");
      state.conversations = data.map((c) => ({
        id: c.id,
        customer: c.customer?.name || "Customer",
        channel: c.channel,
        time: new Date(c.lastMessageAt || c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        intent: c.intent || "General inquiry",
        status: c.status,
        handler: c.handler || assistantName,
        result: c.result || "Processed",
      }));
    } catch (e) {}
  },
};

const callService = {
  latest: () => state.calls[0] || null,
  fetch: async () => {
    try {
      const data = await apiCall("/calls");
      state.calls = data.map((c) => ({
        id: c.id,
        customer: c.customer?.name || "Unknown customer",
        duration: c.duration || "02:43",
        result: c.appointmentAction || "Call completed",
      }));
    } catch (e) {}
  },
};

const automationRuleService = {
  list: () => state.automationRules || [],
  fetch: async () => {
    try {
      state.automationRules = await apiCall("/automation-rules");
    } catch (e) {}
  }
};

const integrationService = {
  list: () => state.integrations || [],
  fetch: async () => {
    try {
      state.integrations = await apiCall("/integrations");
    } catch (e) {}
  }
};

const billingService = {
  getSubscription: () => state.subscription || null,
  fetch: async () => {
    try {
      state.subscription = await apiCall("/billing/subscription");
    } catch (e) {}
  }
};

const businessSettingsService = {
  get: () => state.businessSettings || null,
  fetch: async () => {
    try {
      state.businessSettings = await apiCall("/business/settings");
      if (state.businessSettings?.assistantName) {
        assistantName = state.businessSettings.assistantName;
      }
    } catch (e) {}
  },
  update: async (data) => {
    const res = await apiCall("/business/settings", "PATCH", data);
    state.businessSettings = res;
    if (res.assistantName) assistantName = res.assistantName;
    return res;
  }
};

const analyticsService = {
  fetch: async () => {
    state.analytics = await apiCall("/analytics/overview");
    return state.analytics;
  },
};

const notificationService = {
  messageFor: (action) => `${titleCase(action)} request processed by backend engine.`,
};

const stateManager = {
  loadAll: async () => {
    if (!currentToken) return;
    state.loading = true;
    try {
      const [summary, analytics] = await Promise.all([
        apiCall("/dashboard/summary").catch(() => null),
        analyticsService.fetch().catch(() => null),
        appointmentService.fetch(),
        customerService.fetch(),
        serviceCatalog.fetch(),
        staffDirectory.fetch(),
        conversationService.fetch(),
        callService.fetch(),
        automationRuleService.fetch(),
        integrationService.fetch(),
        billingService.fetch(),
        businessSettingsService.fetch(),
      ]);
      if (summary) state.dashboardSummary = summary;
      if (analytics) state.analytics = analytics;
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      render();
    }
  },
};

const app = document.querySelector("#app");
let currentRoute = location.hash.replace("#/", "") || "landing";
let drawerAppointment = null;
let toastTimer;
let analyticsRefreshTimer = null;

function titleCase(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function badgeClass(status) {
  const value = String(status).toLowerCase();
  if (value.includes("confirmed") || value.includes("resolved") || value.includes("completed") || value.includes("active")) return "success";
  if (value.includes("risk") || value.includes("pending") || value.includes("awaiting")) return "warning";
  if (value.includes("cancel") || value.includes("no-show")) return "error";
  if (value.includes("human")) return "info";
  return "";
}

function showToast(message) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function navigate(route) {
  currentRoute = route;
  location.hash = `/${route}`;
  render();
}

window.addEventListener("hashchange", () => {
  currentRoute = location.hash.replace("#/", "") || "landing";
  drawerAppointment = null;
  customerEditor = null;
  render();
});

function brand(extraClass = "") {
  return `<a class="brand ${extraClass}" href="#/landing" aria-label="AI Receptionist home">
    <img class="brand-logo" src="./assets/walter-ai-logo.png" alt="Walter AI">
  </a>`;
}

function publicNav() {
  return `<nav class="public-nav">
    ${brand()}
    <div class="public-links">
      <button class="btn" data-route="pricing">Pricing</button>
      ${currentToken ? `<button class="btn primary" data-route="overview">Dashboard</button>` : `<button class="btn" data-route="login">Login</button><button class="btn primary" data-route="signup">Sign Up</button>`}
    </div>
  </nav>`;
}

function landing() {
  return `<main class="landing">${publicNav()}
    <section class="hero">
      <div class="hero-copy reveal">
        <div class="page-copy">
          <p class="eyebrow">Intelligent Front Desk Automation</p>
          <h1>Appointment Operations That Feel Effortless.</h1>
          <p>${assistantName} answers calls and messages, captures real customer details, and keeps every schedule change visible to your team.</p>
        </div>
        <div class="actions">
          <button class="btn primary" data-route="signup">Create Account</button>
          <button class="btn" data-route="login">Login</button>
        </div>
      </div>
      <div class="product-frame reveal">${productDemo()}</div>
    </section>
    <section class="section">
      <div class="section-inner sticky-demo">
        <div class="section-head">
          <p class="eyebrow">AI Receptionist</p>
          <h2>Built Around Appointments, Not Novelty.</h2>
          <p>The interface makes the receptionist's work legible: who contacted the business, what they needed, what ${assistantName} changed, and what still needs a human.</p>
          ${channelCards()}
        </div>
        <div class="product-frame">${phoneDemo()}</div>
      </div>
    </section>
    ${pricingSection()}
    <section class="section">
      <div class="section-inner final-cta">
        <p class="eyebrow">Ready For The Next Call</p>
        <h2>Put ${assistantName} On The Front Desk.</h2>
        <p>Launch a connected appointment workflow with authenticated accounts, editable customer records, and live backend data.</p>
        <button class="btn primary" data-route="signup">Create Account</button>
      </div>
    </section>
  </main>`;
}

function productDemo() {
  const summary = state.dashboardSummary || { appointmentsToday: 0, callsHandled: 0, pendingConfirmations: 0, noShowRisk: 0 };
  return `<div class="product-window">
    <div class="window-bar"><strong>${currentUser?.businessName || "Your Business"}</strong><span class="badge success">${assistantName} Online</span></div>
    <div class="window-body">
      <div class="metric-strip">
        ${metric(summary.appointmentsToday, "Appointments today")}
        ${metric(summary.callsHandled, "Calls handled")}
        ${metric(summary.pendingConfirmations, "Confirmations")}
        ${metric(summary.noShowRisk, "At risk")}
      </div>
      <div class="demo-grid">
        ${compactPreviewRows()}
        ${phoneDemo()}
      </div>
    </div>
  </div>`;
}

function compactPreviewRows() {
  const rows = appointmentService.listToday();
  if (rows.length === 0) {
    return emptyState("No Appointments Yet", "Your live appointments appear here after you create an account and add customer bookings.");
  }
  return `<div class="preview-list">${rows.slice(0, 4).map((appointment) => `<div class="preview-appointment">
    <span class="meta">${appointment.time}</span>
    <span><strong>${appointment.customer}</strong><span class="meta">${appointment.service}</span></span>
    <span class="badge ${badgeClass(appointment.status)}">${appointment.status}</span>
  </div>`).join("")}</div>`;
}

function phoneDemo() {
  const latestCall = callService.latest();
  const displayCustomer = latestCall?.customer || state.customers[0]?.name || "New Customer";
  return `<aside class="phone-demo">
    <div>
      <small>Live Phone Call</small>
      <h3>${escapeHtml(displayCustomer)}</h3>
    </div>
    <p>Intent: ${latestCall?.result || "appointment request"}</p>
    <div class="row phone-row">
      <div class="row-main"><span class="row-title">${assistantName} found the next open slot</span><span class="meta">Customer details sync to the backend</span></div>
    </div>
    <span class="badge success">Ready To Schedule</span>
  </aside>`;
}

function channelCards() {
  return `<div class="grid two-col">
    ${["Phone", "WhatsApp", "Email", "Web"].map((channel) => `<article class="card"><h3>${channel}</h3><p>Capture intent and route it into the same appointment workflow.</p></article>`).join("")}
  </div>`;
}

function pricingSection() {
  const plans = [
    ["Starter", "$99", "One location, phone intake, reminders, and core appointment workflows."],
    ["Growth", "$249", "Omnichannel inbox, staff routing, analytics, and escalation controls."],
    ["Scale", "Custom", "Multi-location operations, advanced integrations, and priority support."],
  ];
  return `<section class="section"><div class="section-inner">
    <div class="section-head"><p class="eyebrow">Pricing</p><h2>Plans For Appointment-Based Teams.</h2></div>
    <div class="grid three-col">
      ${plans.map((plan, index) => `<article class="card price-card ${index === 1 ? "featured" : ""}">
        <h3>${plan[0]}</h3>
        <div class="metric-value">${plan[1]}</div>
        <p>${plan[2]}</p>
        <br><button class="btn ${index === 1 ? "primary" : ""}" data-route="signup">Choose ${plan[0]}</button>
      </article>`).join("")}
    </div>
  </div></section>`;
}

function authPage(kind) {
  const isLogin = kind === "login";
  return `<main class="landing">${publicNav()}
    <section class="auth-shell">
      <div class="auth-panel reveal">
        ${brand("auth-brand")}
        <div class="auth-copy">
          <h1>${isLogin ? "Welcome Back" : "Create Your Account"}</h1>
          <p>${isLogin ? "Sign in with your account credentials." : `Set up ${assistantName} with an authenticated workspace and real backend data.`}</p>
        </div>
        <form class="auth-form" id="auth-form-el">
          ${!isLogin ? `<label>Business Name<input class="input" id="auth-biz-name" autocomplete="organization" required></label>` : ""}
          <label>Email<input class="input" id="auth-email" type="email" autocomplete="email" required></label>
          <label>Password<input class="input" id="auth-password" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" minlength="8" required><span class="helper">Use at least 8 characters.</span></label>
          ${!isLogin ? `<label>Assistant Name<input class="input" id="auth-assistant-name" value="${assistantName}" required></label>` : ""}
          <div class="form-error" id="auth-error" hidden></div>
          <button class="btn primary" type="submit" id="auth-submit-btn">${isLogin ? "Login" : "Sign Up"}</button>
          <div class="auth-links">
            <a href="#/${isLogin ? "signup" : "login"}">${isLogin ? "Create An Account" : "Already Have An Account?"}</a>
            <a href="#/landing">Back To Site</a>
          </div>
        </form>
      </div>
    </section>
  </main>`;
}

function shell(content) {
  const groups = routes.reduce((acc, item) => ((acc[item[2]] ||= []).push(item), acc), {});
  return `<div class="app-shell">
    <aside class="sidebar">
      ${brand()}
      ${Object.entries(groups).map(([group, links]) => `<div class="nav-title">${group}</div>${links.map(([id, label, , short]) => `<button class="nav-link ${currentRoute === id ? "active" : ""}" data-route="${id}"><span class="nav-icon">${short}</span>${label}</button>`).join("")}`).join("")}
      <button class="nav-link danger" id="logout-btn" style="margin-top:2rem;">Sign out</button>
    </aside>
    <main class="main">
      <header class="topbar">
        <input class="search" aria-label="Search" placeholder="Search customers, appointments, conversations">
        <div class="actions">
          <span class="badge success">${assistantName} Online</span>
          <button class="btn primary" data-action="book">Book Appointment</button>
        </div>
      </header>
      <div class="content">${content}</div>
      <nav class="mobile-tabs" aria-label="Primary mobile navigation">
        ${routes.slice(0, 6).map(([id, label]) => `<button class="nav-link ${currentRoute === id ? "active" : ""}" data-route="${id}">${label}</button>`).join("")}
      </nav>
    </main>
    ${drawer()}${appointmentForm()}<div class="toast" role="status"></div>
  </div>`;
}

function metric(value, label) {
  return `<div class="metric"><div class="eyebrow">${label}</div><div class="metric-value">${value}</div></div>`;
}

function overview() {
  const summary = state.dashboardSummary || { appointmentsToday: 0, callsHandled: 0, pendingConfirmations: 0, noShowRisk: 0 };
  return shell(`<div class="page-head">
    <div class="page-copy"><p class="eyebrow">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} - ${escapeHtml(currentUser?.businessName || "Your Business")}</p><h1>Today At A Glance</h1><p>Live operational work powered by authenticated backend APIs.</p></div>
    <div class="actions"><button class="btn" data-action="customer">Add Customer</button><button class="btn" data-route="calendar">View Calendar</button></div>
  </div>
  <div class="metric-strip">
    ${metric(summary.appointmentsToday, "Appointments today")}
    ${metric(summary.callsHandled, `Calls answered by ${assistantName}`)}
    ${metric(summary.pendingConfirmations, "Pending confirmations")}
    ${metric(summary.noShowRisk, "No-show risk")}
  </div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>Today's Appointments</h2><p class="meta">Live queue for staff and assistant activity.</p></div><span class="badge warning">${summary.pendingConfirmations} Pending</span></div>${appointmentsList()}</section>
    <div class="grid">
      <section class="panel"><div class="panel-head"><div><h2>Active Conversations</h2><p class="meta">Recent customer intent across channels.</p></div></div>${conversationList()}</section>
      <section class="panel"><div class="panel-head"><div><h2>Recent Activity</h2></div></div>${activityList()}</section>
    </div>
  </div>`);
}

function appointmentsList(compact = false) {
  const rows = appointmentService.listToday();
  if (rows.length === 0) return emptyState("No Appointments Found", "Book an appointment to start building your live schedule.");
  return `<div class="list">${rows.map((appointment) => `<button class="row timeline-item" data-open-appt="${appointment.id}">
    <span class="meta">${appointment.time}</span>
    <span class="row-main"><span class="row-title">${appointment.customer}</span><span class="meta">${appointment.service} with ${appointment.staff} - ${appointment.duration} - ${appointment.channel}</span></span>
    <span class="badge ${badgeClass(appointment.status)}">${appointment.status}</span>
  </button>`).slice(0, compact ? 4 : undefined).join("")}</div>`;
}

function appointmentsPage() {
  return shell(`<div class="page-head">
    <div class="page-copy"><p class="eyebrow">Appointment Management</p><h1>Appointments</h1><p>Book, reschedule, cancel, confirm, and complete appointments while preserving channel and staff context.</p></div>
    <div class="actions"><button class="btn primary" data-action="book">Book</button></div>
  </div>
  <div class="tabs">${["Day", "Week", "Month"].map((tab, index) => `<button class="tab ${index === 1 ? "active" : ""}">${tab}</button>`).join("")}</div>
  ${appointmentTable()}`);
}

function appointmentTable() {
  const rows = appointmentService.listToday();
  return `<div class="table-wrap">
    <table><thead><tr><th>Time</th><th>Customer</th><th>Service</th><th>Staff</th><th>Channel</th><th>Status</th></tr></thead>
    <tbody>${rows.map((a) => `<tr data-open-appt="${a.id}"><td>${a.time}<br><span class="meta">${a.duration}</span></td><td>${a.customer}</td><td>${a.service}</td><td>${a.staff}</td><td>${a.channel}</td><td><span class="badge ${badgeClass(a.status)}">${a.status}</span></td></tr>`).join("")}</tbody></table>
    <div class="mobile-list">${rows.map((a) => `<button class="row" data-open-appt="${a.id}"><span class="row-main"><span class="row-title">${a.time} - ${a.customer}</span><span class="meta">${a.service} with ${a.staff}</span></span><span class="badge ${badgeClass(a.status)}">${a.status}</span></button>`).join("")}</div>
  </div>`;
}

function appointmentForm() {
  if (!appointmentEditor) return "";
  const isReschedule = appointmentEditor !== "new";
  const appointment = isReschedule ? appointmentService.getById(appointmentEditor) : null;
  const customers = customerService.list();
  const services = serviceCatalog.list();
  const staff = staffDirectory.list();
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() + 1);
  defaultStart.setHours(10, 0, 0, 0);

  if (!isReschedule && (customers.length === 0 || services.length === 0)) {
    return `<div class="modal-backdrop open" role="dialog" aria-modal="true">
      <div class="modal-panel auth-form">
        <div class="page-head compact"><div class="page-copy"><p class="eyebrow">Booking Setup</p><h2>Missing Details</h2></div><button class="btn" type="button" data-action="close-appointment">Close</button></div>
        <p class="meta">Add at least one customer and one service before booking an appointment.</p>
        <div class="actions"><button class="btn" type="button" data-action="customer">Add Customer</button><button class="btn primary" type="button" data-action="service">Add Service</button></div>
      </div>
    </div>`;
  }

  return `<div class="modal-backdrop open" role="dialog" aria-modal="true">
    <form class="modal-panel auth-form" id="appointment-form-el">
      <div class="page-head compact"><div class="page-copy"><p class="eyebrow">${isReschedule ? "Reschedule" : "New Appointment"}</p><h2>${isReschedule ? "Choose A New Time" : "Book Appointment"}</h2></div><button class="btn" type="button" data-action="close-appointment">Close</button></div>
      ${isReschedule ? `<p class="meta">${escapeHtml(appointment?.customer || "Customer")} - ${escapeHtml(appointment?.service || "Service")} with ${escapeHtml(appointment?.staff || "Staff")}</p>` : `
        <label>Customer<select class="select" id="appointment-customer" required>${customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}${customer.phone ? ` - ${escapeHtml(customer.phone)}` : ""}</option>`).join("")}</select></label>
        <label>Service<select class="select" id="appointment-service" required>${services.map((service) => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)} - ${escapeHtml(service.duration)} - ${escapeHtml(service.price)}</option>`).join("")}</select></label>
        <label>Staff<select class="select" id="appointment-staff"><option value="">Any available staff</option>${staff.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)} - ${escapeHtml(person.title)}</option>`).join("")}</select></label>
        <label>Channel<select class="select" id="appointment-channel">${["web", "phone", "email", "whatsapp", "manual"].map((channel) => `<option value="${channel}">${titleCase(channel)}</option>`).join("")}</select></label>
      `}
      <label>Start Time<input class="input" id="appointment-start" type="datetime-local" value="${toDateTimeLocalValue(appointment?.startTime || defaultStart)}" required></label>
      <label>Notes<textarea class="input textarea" id="appointment-notes">${escapeHtml(appointment?.notes || "")}</textarea></label>
      <div class="form-error" id="appointment-error" hidden></div>
      <button class="btn primary" type="submit">${isReschedule ? "Save New Time" : "Create Appointment"}</button>
    </form>
  </div>`;
}

function calendarPage() {
  const days = Array.from({ length: 35 }, (_, index) => index + 1);
  const appointmentsByDay = appointmentService.listToday().reduce((acc, appointment) => {
    const day = Number(appointment.date.split(" ").pop());
    if (day) (acc[day] ||= []).push(appointment);
    return acc;
  }, {});
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">August 2026</p><h1>Calendar</h1><p>Month view with assistant-driven confirmations and appointment context.</p></div><div class="tabs">${["Day", "Week", "Month"].map((tab, index) => `<button class="tab ${index === 2 ? "active" : ""}">${tab}</button>`).join("")}</div></div>
  <div class="calendar">${days.map((day) => `<div class="day"><strong>${day}</strong>${(appointmentsByDay[day] || []).map((appointment) => `<div class="appt-chip">${appointment.time} ${escapeHtml(appointment.customer)}</div>`).join("")}</div>`).join("")}</div>`);
}

function conversationList(items = conversationService.list()) {
  if (items.length === 0) return emptyState("No Active Conversations", "Customer conversations will appear here once calls, emails, or messages are recorded.");
  return `<div class="list">${items.map((conversation) => `<div class="row">
    <span class="row-main"><span class="row-title">${conversation.customer}</span><span class="meta">${conversation.channel} - ${conversation.intent} - handled by ${conversation.handler}</span></span>
    <span class="badge ${badgeClass(conversation.status)}">${conversation.status}</span>
  </div>`).join("")}</div>`;
}

function activityList() {
  const appointments = appointmentService.listToday();
  const activityData = appointments.slice(0, 4).map((appointment) => [
    appointment.time,
    `${assistantName} has ${appointment.status} status for ${appointment.customer}`,
  ]);
  if (activityData.length === 0) return emptyState("No Recent Activity", "Actions from appointments and conversations will appear here.");
  return `<div class="list activity-list">${activityData.map(([time, text]) => `<div class="row"><span class="meta">${time}</span><span class="row-main"><span class="row-title">${text}</span></span></div>`).join("")}</div>`;
}

function conversationsPage(channel) {
  const title = channel || "Conversations";
  const filtered = channel ? conversationService.byChannel(channel) : conversationService.list();
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Unified Conversation Center</p><h1>${title}</h1><p>Each conversation shows customer intent, channel, handler, status, and the outcome ${assistantName} produced or escalated.</p></div><button class="btn">Transfer Selected To Human</button></div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>Inbox</h2><p class="meta">${filtered.length} conversations in view.</p></div></div>${conversationList(filtered)}</section>
    <section class="panel"><div class="panel-head"><div><h2>Conversation Detail</h2><p class="meta">Select a conversation to review transcript context.</p></div></div><div class="detail-stack">
      <p><strong>Intent:</strong> ${filtered[0]?.intent || "No conversation selected"}</p>
      <p><strong>Result:</strong> ${filtered[0]?.result || "Conversation outcomes will appear here."}</p>
      <p><strong>Customer:</strong> ${filtered[0]?.customer || "None selected"}</p>
      <button class="btn">Review transcript</button>
    </div></section>
  </div>`);
}

function callsPage() {
  const latestCall = callService.latest();
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Phone Call History</p><h1>AI Phone Calls</h1><p>Call outcomes make it clear what ${assistantName} actually did during each phone interaction.</p></div><span class="badge success">${assistantName} Answering Calls</span></div>
  <div class="grid two-col">
    <section class="panel">${conversationList(conversationService.byChannel("Phone"))}</section>
    <section class="panel"><div class="panel-head"><div><h2>Call Detail</h2><p class="meta">Duration ${latestCall?.duration || "00:00"}</p></div></div><div class="detail-stack">
      <p><strong>Customer:</strong> ${latestCall?.customer || "No call selected"}</p>
      <p><strong>Status:</strong> ${latestCall ? "Completed" : "No calls recorded"}</p>
      <p><strong>Appointment action:</strong> ${latestCall?.result || "Call outcomes will appear here."}</p>
      <p><strong>AI summary:</strong> ${latestCall ? `${assistantName} handled the call and saved the result to this account.` : "Connect phone calls to review summaries from real customer interactions."}</p>
      <div class="actions"><button class="btn">Recording</button><button class="btn">Transfer Status</button></div>
    </div></section>
  </div>`);
}

function customersPage() {
  const list = customerService.list();
  const rows = list.map((customer) => `<tr data-action="edit-customer" data-id="${customer.id}"><td>${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.email || "Not added")}</td><td>${escapeHtml(customer.phone || "Not added")}</td><td><span class="badge">${escapeHtml(customer.segment)}</span></td><td>${escapeHtml(customer.notes || "No notes yet")}</td></tr>`).join("");
  const mobileRows = list.map((customer) => `<button class="row" data-action="edit-customer" data-id="${customer.id}"><span class="row-main"><span class="row-title">${escapeHtml(customer.name)}</span><span class="meta">${escapeHtml(customer.phone || customer.email || "No contact details")} - ${escapeHtml(customer.notes || "No notes yet")}</span></span><span class="badge">${escapeHtml(customer.segment)}</span></button>`).join("");
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Customer Records</p><h1>Customers</h1><p>Edit names, contact details, segment, and notes without leaving the live account workspace.</p></div><button class="btn primary" data-action="customer">Add Customer</button></div>
  ${list.length === 0 ? emptyState("No Customers Yet", "Add the first customer to start booking appointments with real backend records.") : `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Segment</th><th>Next Action</th></tr></thead><tbody>${rows}</tbody></table><div class="mobile-list">${mobileRows}</div></div>`}
  ${customerForm()}`);
}

function customerForm() {
  if (!customerEditor) return "";
  const isEditing = customerEditor !== "new";
  const customer = isEditing ? customerService.getById(customerEditor) : null;
  return `<div class="modal-backdrop open" role="dialog" aria-modal="true">
    <form class="modal-panel auth-form" id="customer-form-el">
      <div class="page-head compact"><div class="page-copy"><p class="eyebrow">${isEditing ? "Edit Customer" : "New Customer"}</p><h2>${isEditing ? "Update Customer" : "Add Customer"}</h2></div><button class="btn" type="button" data-action="close-customer">Close</button></div>
      <label>Full Name<input class="input" id="customer-name" value="${escapeHtml(customer?.name || "")}" autocomplete="name" required></label>
      <label>Email<input class="input" id="customer-email" type="email" value="${escapeHtml(customer?.email || "")}" autocomplete="email"></label>
      <label>Phone<input class="input" id="customer-phone" value="${escapeHtml(customer?.phone || "")}" autocomplete="tel"></label>
      <label>Segment<select class="select" id="customer-segment">${["Standard", "High value", "Needs confirmation", "No-show risk", "New lead"].map((segment) => `<option ${segment === (customer?.segment || "Standard") ? "selected" : ""}>${segment}</option>`).join("")}</select></label>
      <label>Notes<textarea class="input textarea" id="customer-notes">${escapeHtml(customer?.notes || "")}</textarea></label>
      <div class="form-error" id="customer-error" hidden></div>
      <button class="btn primary" type="submit">${isEditing ? "Save Customer" : "Create Customer"}</button>
    </form>
  </div>`;
}

function settingsPage(label) {
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Business Settings</p><h1>${label}</h1><p>Keep account identity, timezone, public contact details, and receptionist defaults aligned with the way your business operates.</p></div><button class="btn primary" data-action="save">Save Changes</button></div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>Business Profile</h2><p class="meta">Public-facing details used in confirmations and customer messages.</p></div></div><div class="auth-form">
      <label>Business Name<input class="input" value="${escapeHtml(currentUser?.businessName || "Your Business")}"></label>
      <label>Timezone<select class="select"><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></label>
      <label>Reply Signature<input class="input" value="${escapeHtml(assistantName)} from ${escapeHtml(currentUser?.businessName || "your team")}"></label>
    </div></section>
    <section class="panel"><div class="panel-head"><div><h2>Workspace Controls</h2><p class="meta">Operational defaults that affect scheduling behavior.</p></div></div><div class="setting-list">
      ${settingRow("Appointment Holds", "Hold open slots while a customer confirms", "Enabled")}
      ${settingRow("Cancellation Window", "Require staff review for same-day cancellations", "Staff Review")}
      ${settingRow("Audit History", "Track every booking, status change, and customer edit", "Active")}
    </div></section>
  </div>`);
}

function servicesPage() {
  const services = serviceCatalog.list();
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Service Catalog</p><h1>Services</h1><p>Define bookable appointments with duration, buffer time, pricing, and active status.</p></div><button class="btn primary" data-action="service">Add Service</button></div>
  ${services.length === 0 ? emptyState("No Services Yet", "Add services before customers can book appointments.") : `<div class="grid three-col">${services.map((service) => `<article class="card service-card"><div class="card-top"><h3>${escapeHtml(service.name)}</h3><span class="badge ${service.active ? "success" : ""}">${service.active ? "Active" : "Paused"}</span></div><p>${escapeHtml(service.description)}</p><div class="setting-list compact-list">${settingRow("Duration", service.duration, service.price)}${settingRow("Buffer", service.buffer, "Protected")}</div></article>`).join("")}</div>`}
  ${serviceForm()}`);
}

function staffPage() {
  const staff = staffDirectory.list();
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Team Routing</p><h1>Staff</h1><p>Manage who receives appointments, which profiles are active, and how staff contact details appear in scheduling workflows.</p></div><button class="btn primary" data-action="staff">Add Staff</button></div>
  ${staff.length === 0 ? emptyState("No Staff Yet", "Invite team members or create staff profiles for appointment assignment.") : `<div class="grid three-col">${staff.map((person) => `<article class="card staff-card"><div class="avatar">${escapeHtml(person.name.split(" ").map((part) => part[0]).join("").slice(0, 2))}</div><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.title)}</p><div class="setting-list compact-list">${settingRow("Email", person.email, person.active ? "Active" : "Paused")}${settingRow("Phone", person.phone, "Routing")}</div></article>`).join("")}</div>`}
  ${staffForm()}`);
}

function serviceForm() {
  if (!serviceEditor) return "";
  return `<div class="modal-backdrop open" role="dialog" aria-modal="true">
    <form class="modal-panel auth-form" id="service-form-el">
      <div class="page-head compact"><div class="page-copy"><p class="eyebrow">New Service</p><h2>Add Service</h2></div><button class="btn" type="button" data-action="close-service">Close</button></div>
      <label>Service Name<input class="input" id="service-name" autocomplete="off" required></label>
      <label>Description<textarea class="input textarea" id="service-description"></textarea></label>
      <label>Duration Minutes<input class="input" id="service-duration" type="number" min="5" step="5" value="30" required></label>
      <label>Buffer Minutes<input class="input" id="service-buffer" type="number" min="0" step="5" value="15"></label>
      <label>Price<input class="input" id="service-price" type="number" min="0" step="0.01" value="0"></label>
      <div class="form-error" id="service-error" hidden></div>
      <button class="btn primary" type="submit">Create Service</button>
    </form>
  </div>`;
}

function staffForm() {
  if (!staffEditor) return "";
  return `<div class="modal-backdrop open" role="dialog" aria-modal="true">
    <form class="modal-panel auth-form" id="staff-form-el">
      <div class="page-head compact"><div class="page-copy"><p class="eyebrow">New Staff</p><h2>Add Staff Member</h2></div><button class="btn" type="button" data-action="close-staff">Close</button></div>
      <label>Full Name<input class="input" id="staff-name" autocomplete="name" required></label>
      <label>Title<input class="input" id="staff-title" autocomplete="organization-title"></label>
      <label>Email<input class="input" id="staff-email" type="email" autocomplete="email"></label>
      <label>Phone<input class="input" id="staff-phone" autocomplete="tel"></label>
      <div class="form-error" id="staff-error" hidden></div>
      <button class="btn primary" type="submit">Create Staff</button>
    </form>
  </div>`;
}

function automationPage() {
  const rules = automationRuleService.list();
  
  const fallbackRules = [
    ["Confirmation Chase", "Send a reminder when an appointment is still pending 24 hours before start time.", "Ready"],
    ["No-Show Watch", "Flag customers with repeated missed appointments for staff review.", "Monitoring"],
    ["Human Escalation", "Move pricing disputes, medical questions, and unclear requests out of automation.", "Protected"],
  ];
  
  const displayRules = rules.length > 0 ? rules.map(r => [r.name, `${r.triggerEvent} -> ${r.actionType}`, r.active ? 'Active' : 'Inactive']) : fallbackRules;
  
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Automation Rules</p><h1>Automation Rules</h1><p>Control where ${assistantName} acts automatically and where your team stays in the loop.</p></div><button class="btn primary" data-action="save">New Rule</button></div>
  <div class="grid three-col">${displayRules.map(([name, detail, status]) => `<article class="card"><div class="card-top"><h3>${name}</h3><span class="badge ${status === 'Inactive' ? '' : 'success'}">${status}</span></div><p>${detail}</p><div class="rule-flow"><span>Trigger</span><span>Condition</span><span>Action</span></div></article>`).join("")}</div>`);
}

function assistantPage() {
  const settings = businessSettingsService.get() || {};
  const tone = settings.assistantTone || "Warm and efficient";
  const bookingPermission = settings.bookingPermission || "Book, reschedule, and cancel within policy";
  const pricingEscalation = settings.pricingEscalation || "Escalate";
  const doubleBookingPolicy = settings.doubleBookingPolicy || "Blocked";
  const identityCheckPolicy = settings.identityCheckPolicy || "Required";

  return shell(`<form id="assistant-settings-form"><div class="page-head"><div class="page-copy"><p class="eyebrow">Assistant Behavior</p><h1>AI Assistant Settings</h1><p>Tune booking permissions, escalation style, and customer-facing tone.</p></div><button class="btn primary" type="submit">Save Assistant</button></div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>${escapeHtml(assistantName)} Profile</h2><p class="meta">The name and tone customers experience across calls and messages.</p></div></div><div class="auth-form">
      <label>Assistant Name<input class="input" value="${escapeHtml(assistantName)}" readonly aria-readonly="true"></label>
      <label>Tone<select class="select" id="assistant-tone">${["Warm and efficient", "Formal and concise", "Friendly and conversational"].map((option) => `<option ${option === tone ? "selected" : ""}>${option}</option>`).join("")}</select></label>
      <label>Booking Permission<select class="select" id="assistant-booking-permission">${["Book, reschedule, and cancel within policy", "Only suggest available times", "Escalate all schedule changes"].map((option) => `<option ${option === bookingPermission ? "selected" : ""}>${option}</option>`).join("")}</select></label>
    </div></section>
    <section class="panel"><div class="panel-head"><div><h2>Escalation Boundaries</h2><p class="meta">Clear limits keep the product trustworthy.</p></div></div><div class="setting-list">
      <label>Pricing Questions<select class="select" id="assistant-pricing-escalation">${["Escalate", "Answer from service catalog", "Always ask staff"].map((option) => `<option ${option === pricingEscalation ? "selected" : ""}>${option}</option>`).join("")}</select></label>
      <label>Double Booking<select class="select" id="assistant-double-booking">${["Blocked", "Suggest nearest available time", "Escalate to staff"].map((option) => `<option ${option === doubleBookingPolicy ? "selected" : ""}>${option}</option>`).join("")}</select></label>
      <label>Customer Identity<select class="select" id="assistant-identity-check">${["Required", "Required for changes only", "Staff review"].map((option) => `<option ${option === identityCheckPolicy ? "selected" : ""}>${option}</option>`).join("")}</select></label>
      <div class="form-error" id="assistant-settings-error" hidden></div>
    </div></section>
  </div></form>`);
}

function integrationsPage() {
  const activeIntegrations = integrationService.list();
  
  const baseIntegrations = [
    { name: "Calendar", detail: "Sync staff availability and push confirmed appointments.", id: "calendar" },
    { name: "Phone", detail: `Route inbound calls through ${assistantName}.`, id: "phone" },
    { name: "Messaging", detail: "Unify WhatsApp and email conversations.", id: "messaging" },
    { name: "Payments", detail: "Attach deposits and invoices to booked services.", id: "payments" },
  ];

  const displayIntegrations = baseIntegrations.map(base => {
    const active = activeIntegrations.find(i => i.provider.toLowerCase() === base.id);
    if (active) {
      return [base.name, base.detail, active.enabled ? "Connected" : "Paused", active.enabled ? "success" : ""];
    }
    return [base.name, base.detail, "Not Connected", ""];
  });

  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Connected Channels</p><h1>Integrations</h1><p>Connect the systems that feed appointment requests into the same backend workflow.</p></div><button class="btn primary" data-action="save">Connect App</button></div>
  <div class="grid four-col">${displayIntegrations.map(([name, detail, status, badgeCls]) => `<article class="card integration-card"><h3>${name}</h3><p>${detail}</p><span class="badge ${badgeCls}">${status}</span></article>`).join("")}</div>`);
}

function billingPage() {
  const sub = billingService.getSubscription();
  const planName = sub?.plan || "Setup Needed";
  const statusBadge = sub?.status === "ACTIVE" ? "success" : "warning";
  const balance = "$0";

  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Plan And Usage</p><h1>Billing</h1><p>Track subscription status, receptionist usage, and billing controls for this workspace.</p></div><button class="btn primary" data-action="save">Manage Plan</button></div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>Current Plan</h2><p class="meta">Workspace billing summary.</p></div><span class="badge ${statusBadge}">${sub?.status || 'Setup Needed'}</span></div><div class="metric-strip billing-metrics">${metric(planName, "Plan")}${metric(balance, "Current balance")}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Usage Controls</h2><p class="meta">Protect costs while call volume grows.</p></div></div><div class="setting-list">
      ${settingRow("Monthly Call Limit", "Set a cap before overage billing begins", "Unset")}
      ${settingRow("SMS Reminders", "Bill only when reminders are enabled", "Available")}
      ${settingRow("Invoice Contact", currentUser?.email || "No billing email", "Owner")}
    </div></section>
  </div>`);
}

function settingRow(label, detail, status) {
  return `<div class="setting-row"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span><span class="badge">${escapeHtml(status)}</span></div>`;
}

function analyticsPage() {
  const data = state.analytics || { bookingSuccessRate: "0%", avgResponseTimeSaved: "0m", escalationsCount: 0, customerRating: "N/A", totalAppointments: 0, completedAppointments: 0, cancelledAppointments: 0, callsHandled: 0, conversationsHandled: 0 };
  const updated = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Waiting for data";
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Operational Reporting</p><h1>Analytics</h1><p>Outcome-oriented reporting for bookings, escalations, response time, and customer satisfaction.</p></div></div>
  <div class="metric-strip">${metric(data.bookingSuccessRate, "Booking success")}${metric(data.avgResponseTimeSaved, "Avg response saved")}${metric(data.escalationsCount, "Escalations")}${metric(data.customerRating, "Customer rating")}</div>
  <section class="panel"><div class="panel-head"><div><h2>Live Backend Activity</h2><p class="meta">Last refreshed ${updated}</p></div><span class="badge success">Live</span></div><div class="metric-strip">${metric(data.totalAppointments, "Total appointments")}${metric(data.completedAppointments, "Completed")}${metric(data.cancelledAppointments, "Cancelled")}${metric((data.callsHandled || 0) + (data.conversationsHandled || 0), "Handled interactions")}</div></section>`);
}

function drawer() {
  const appointment = appointmentService.getById(drawerAppointment);
  return `<div class="drawer ${appointment ? "open" : ""}" role="dialog" aria-modal="true">
    <aside class="drawer-panel">${appointment ? `<div class="page-head"><div class="page-copy"><p class="eyebrow">Appointment details</p><h2>${appointment.customer}</h2></div><button class="btn" data-action="close">Close</button></div>
      <div class="detail-stack">
        <p><strong>Service:</strong> ${appointment.service}</p>
        <p><strong>Time:</strong> ${appointment.date}, ${appointment.time}, ${appointment.duration}</p>
        <p><strong>Staff:</strong> ${appointment.staff}</p>
        <p><strong>Booked through:</strong> ${appointment.channel}</p>
        <p><strong>Status:</strong> <span class="badge ${badgeClass(appointment.status)}">${appointment.status}</span></p>
        <div class="actions">
          <button class="btn primary" data-action="confirm-appt" data-id="${appointment.id}">Confirm</button>
          <button class="btn" data-action="reschedule-appt" data-id="${appointment.id}">Reschedule</button>
          <button class="btn danger" data-action="cancel-appt" data-id="${appointment.id}">Cancel</button>
          <button class="btn" data-action="close">Close</button>
        </div>
      </div>` : ""}</aside>
  </div>`;
}

function pageForRoute() {
  if (currentRoute === "landing") return landing();
  if (currentRoute === "pricing") return `<main class="landing">${publicNav()}${pricingSection()}</main>`;
  if (currentRoute === "login" || currentRoute === "signup") return authPage(currentRoute);
  if (!currentToken) return authPage("login"); // Guard protected routes

  if (currentRoute === "overview") return overview();
  if (currentRoute === "appointments") return appointmentsPage();
  if (currentRoute === "calendar") return calendarPage();
  if (currentRoute === "customers") return customersPage();
  if (currentRoute === "conversations") return conversationsPage();
  if (currentRoute === "calls") return callsPage();
  if (currentRoute === "whatsapp") return conversationsPage("WhatsApp");
  if (currentRoute === "email") return conversationsPage("Email");
  if (currentRoute === "services") return servicesPage();
  if (currentRoute === "staff") return staffPage();
  if (currentRoute === "automation") return automationPage();
  if (currentRoute === "analytics") return analyticsPage();
  if (currentRoute === "assistant") return assistantPage();
  if (currentRoute === "integrations") return integrationsPage();
  if (currentRoute === "billing") return billingPage();
  const route = routes.find(([id]) => id === currentRoute);
  return settingsPage(route ? route[1] : "Overview");
}

function attachFormListeners() {
  const authForm = document.getElementById("auth-form-el");
  if (authForm) {
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const isLogin = currentRoute === "login";
      const email = document.getElementById("auth-email").value;
      const password = document.getElementById("auth-password").value;
      const errorDiv = document.getElementById("auth-error");

      try {
        let res;
        if (isLogin) {
          res = await apiCall("/auth/login", "POST", { email, password });
        } else {
          const businessName = document.getElementById("auth-biz-name").value;
          const assistantNameVal = document.getElementById("auth-assistant-name").value;
          res = await apiCall("/auth/register", "POST", { businessName, email, password, assistantName: assistantNameVal });
        }

        currentToken = res.token;
        currentUser = res.user;
        localStorage.setItem("auth_token", res.token);
        showToast(`Successfully logged in as ${res.user.email}`);
        await stateManager.loadAll();
        navigate("overview");
      } catch (err) {
        errorDiv.hidden = false;
        errorDiv.textContent = err.message || "Authentication failed.";
      }
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("auth_token");
      currentToken = null;
      currentUser = null;
      showToast("Logged out successfully");
      navigate("landing");
    });
  }

  const customerFormEl = document.getElementById("customer-form-el");
  if (customerFormEl) {
    customerFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById("customer-error");
      const payload = {
        name: document.getElementById("customer-name").value.trim(),
        email: document.getElementById("customer-email").value.trim() || null,
        phone: document.getElementById("customer-phone").value.trim() || null,
        segment: document.getElementById("customer-segment").value,
        notes: document.getElementById("customer-notes").value.trim() || null,
      };

      try {
        if (customerEditor === "new") {
          await customerService.create(payload);
          showToast(`${payload.name} was added.`);
        } else {
          await customerService.update(customerEditor, payload);
          showToast(`${payload.name} was updated.`);
        }
        customerEditor = null;
        render();
      } catch (err) {
        errorDiv.hidden = false;
        errorDiv.textContent = err.message || "Customer could not be saved.";
      }
    });
  }

  const serviceFormEl = document.getElementById("service-form-el");
  if (serviceFormEl) {
    serviceFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById("service-error");
      const payload = {
        name: document.getElementById("service-name").value.trim(),
        description: document.getElementById("service-description").value.trim() || null,
        durationMinutes: Number(document.getElementById("service-duration").value || 30),
        bufferMinutes: Number(document.getElementById("service-buffer").value || 0),
        price: Number(document.getElementById("service-price").value || 0),
      };

      try {
        await serviceCatalog.create(payload);
        serviceEditor = null;
        showToast(`${payload.name} was added.`);
        render();
      } catch (err) {
        errorDiv.hidden = false;
        errorDiv.textContent = err.message || "Service could not be saved.";
      }
    });
  }

  const staffFormEl = document.getElementById("staff-form-el");
  if (staffFormEl) {
    staffFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById("staff-error");
      const payload = {
        name: document.getElementById("staff-name").value.trim(),
        title: document.getElementById("staff-title").value.trim() || null,
        email: document.getElementById("staff-email").value.trim() || null,
        phone: document.getElementById("staff-phone").value.trim() || null,
      };

      try {
        await staffDirectory.create(payload);
        staffEditor = null;
        showToast(`${payload.name} was added.`);
        render();
      } catch (err) {
        errorDiv.hidden = false;
        errorDiv.textContent = err.message || "Staff member could not be saved.";
      }
    });
  }

  const appointmentFormEl = document.getElementById("appointment-form-el");
  if (appointmentFormEl) {
    appointmentFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById("appointment-error");
      const startTime = new Date(document.getElementById("appointment-start").value).toISOString();

      try {
        if (appointmentEditor === "new") {
          const payload = {
            customerId: document.getElementById("appointment-customer").value,
            serviceId: document.getElementById("appointment-service").value,
            staffId: document.getElementById("appointment-staff").value || undefined,
            startTime,
            channel: document.getElementById("appointment-channel").value,
            notes: document.getElementById("appointment-notes").value.trim() || null,
          };
          await appointmentService.book(payload);
          showToast("Appointment booked.");
        } else {
          await appointmentService.reschedule(appointmentEditor, startTime);
          drawerAppointment = null;
          showToast("Appointment rescheduled.");
        }
        appointmentEditor = null;
        render();
      } catch (err) {
        errorDiv.hidden = false;
        errorDiv.textContent = err.message || "Appointment could not be saved.";
      }
    });
  }

  const assistantSettingsForm = document.getElementById("assistant-settings-form");
  if (assistantSettingsForm) {
    assistantSettingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById("assistant-settings-error");
      const payload = {
        assistantTone: document.getElementById("assistant-tone").value,
        bookingPermission: document.getElementById("assistant-booking-permission").value,
        pricingEscalation: document.getElementById("assistant-pricing-escalation").value,
        doubleBookingPolicy: document.getElementById("assistant-double-booking").value,
        identityCheckPolicy: document.getElementById("assistant-identity-check").value,
      };

      try {
        await businessSettingsService.update(payload);
        showToast("Assistant settings saved.");
        render();
      } catch (err) {
        errorDiv.hidden = false;
        errorDiv.textContent = err.message || "Assistant settings could not be saved.";
      }
    });
  }
}

function syncAnalyticsRefresh() {
  if (analyticsRefreshTimer && currentRoute !== "analytics") {
    clearInterval(analyticsRefreshTimer);
    analyticsRefreshTimer = null;
  }

  if (currentRoute === "analytics" && currentToken && !analyticsRefreshTimer) {
    analyticsRefreshTimer = setInterval(async () => {
      try {
        await analyticsService.fetch();
        if (currentRoute === "analytics") render();
      } catch (err) {
        console.warn("Analytics refresh failed", err);
      }
    }, 5000);
  }
}

async function render() {
  app.innerHTML = pageForRoute();
  attachFormListeners();
  syncAnalyticsRefresh();

  document.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", () => navigate(element.dataset.route)));
  document.querySelectorAll("[data-open-appt]").forEach((element) => element.addEventListener("click", () => {
    drawerAppointment = element.dataset.openAppt;
    render();
  }));

  // Generic action dispatcher for all UI buttons
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", async () => {
      const action = element.dataset.action;
      const apptId = element.dataset.id; // May be undefined for non-appointment actions

      if (action === "close-customer") {
        customerEditor = null;
        render();
        return;
      }

      if (action === "close-service") {
        serviceEditor = null;
        render();
        return;
      }

      if (action === "close-staff") {
        staffEditor = null;
        render();
        return;
      }

      if (action === "close" || action === "close-appointment") {
        drawerAppointment = null;
        appointmentEditor = null;
        render();
        return;
      }

      if (action === "customer") {
        currentRoute = "customers";
        location.hash = "/customers";
        customerEditor = "new";
        render();
        return;
      }

      if (action === "service") {
        currentRoute = "services";
        location.hash = "/services";
        serviceEditor = "new";
        render();
        return;
      }

      if (action === "staff") {
        currentRoute = "staff";
        location.hash = "/staff";
        staffEditor = "new";
        render();
        return;
      }

      if (action === "edit-customer") {
        customerEditor = element.dataset.id;
        render();
        return;
      }

      if (action === "confirm-appt" && apptId) {
        try {
          await appointmentService.confirm(apptId);
          showToast("Appointment confirmed!");
          drawerAppointment = null;
          render();
        } catch (e) {
          showToast(e.message);
        }
        return;
      }

      if (action === "cancel-appt" && apptId) {
        if (!confirm("Cancel this appointment?")) return;
        try {
          await appointmentService.cancel(apptId);
          drawerAppointment = null;
          showToast("Appointment cancelled.");
        } catch (e) {
          showToast(e.message);
        }
        return;
      }

      if (action === "reschedule-appt" && apptId) {
        appointmentEditor = apptId;
        render();
        return;
      }

      if (action === "book") {
        appointmentEditor = "new";
        render();
        return;
      }

      // Fallback for other actions – use notification service messages
      showToast(notificationService.messageFor(action));
    });
  });
}

// Boot sequence: check session & load state
(async () => {
  await checkAuthSession();
  if (currentToken) {
    await stateManager.loadAll();
  } else {
    render();
  }
})();
