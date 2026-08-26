let assistantName = "Walter";
let currentUser = null;
let currentToken = localStorage.getItem("auth_token") || null;

const API_BASE = "/api/v1";

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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || "API request failed");
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
  whatsappConnected: localStorage.getItem("whatsapp_connected") === "true",
};

let customerEditor = null;
let activeConversationId = null;


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
  return `<div class="empty-state"><h3>${title}</h3><p>${detail}</p></div>`;
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
        date: new Date(a.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        time: new Date(a.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
        duration: `${a.service?.durationMinutes || 30}m`,
        customer: a.customer?.name || "Customer",
        service: a.service?.name || "Service",
        staff: a.staff?.name || "Staff",
        status: a.status,
        channel: a.channel,
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
  delete: async (id) => {
    await apiCall(`/customers/${id}`, "DELETE");
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
        duration: `${service.durationMinutes || 30} min`,
        buffer: `${service.bufferMinutes || 0} min buffer`,
        price: Number(service.price || 0).toLocaleString("en-US", { style: "currency", currency: "USD" }),
        active: service.active,
      }));
    } catch (e) {}
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
        messages: c.messages || [],
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
        apiCall("/analytics/overview").catch(() => null),
        appointmentService.fetch(),
        customerService.fetch(),
        serviceCatalog.fetch(),
        staffDirectory.fetch(),
        conversationService.fetch(),
        callService.fetch(),
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
    <span class="brand-mark">W</span>
    <span class="brand-copy"><span>AI Receptionist</span><small>${assistantName} front desk</small></span>
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
    <div class="window-bar"><strong>${currentUser?.businessName || "Your Business"}</strong><span id="header-clock" style="margin-right: 15px; font-weight: 500; font-size: 14px; opacity: 0.85;"></span>
          <span class="badge success">${assistantName} Online</span></div>
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
    ${drawer()}<div class="toast" role="status"></div>
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
    <div class="actions"><button class="btn primary" data-action="book">Book</button><button class="btn" data-action="quick-reschedule">Reschedule</button><button class="btn danger" data-action="cancel">Cancel</button></div>
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
  return `<div class="list">${items.map((conversation) => {
    const isActive = activeConversationId === conversation.id || (!activeConversationId && items[0]?.id === conversation.id);
    if (isActive && !activeConversationId) activeConversationId = conversation.id;
    return `<div class="row ${isActive ? "active" : ""}" data-open-convo="${conversation.id}" style="cursor: pointer; ${isActive ? 'background: var(--surface-secondary);' : ''}">
      <span class="row-main"><span class="row-title">${escapeHtml(conversation.customer)}</span><span class="meta">${conversation.channel} - ${conversation.intent} - Handled by ${conversation.handler}</span></span>
      <span class="badge ${badgeClass(conversation.status)}">${conversation.status}</span>
    </div>`;
  }).join("")}</div>`;
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

  if (channel === "WhatsApp" && !state.whatsappConnected) {
    return shell(`
      <div class="page-head">
        <div class="page-copy">
          <p class="eyebrow">WhatsApp Channel Setup</p>
          <h1>Connect WhatsApp Business</h1>
          <p>Link Walter to your business phone number so that it can interact with your clients directly on WhatsApp.</p>
        </div>
      </div>
      <div class="grid two-col">
        <section class="panel">
          <h2>Scan QR Code</h2>
          <p class="meta">Scan the QR code with your WhatsApp app (Settings > Linked Devices > Link a Device) to authorize Walter.</p>
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 2rem; background: #fff; border: 1px solid var(--border); border-radius: 8px; margin-top: 1rem;">
            <svg width="200" height="200" viewBox="0 0 100 100" style="margin-bottom:1.5rem; background:#fff; padding:10px; border:1px solid #ddd;">
              <rect x="0" y="0" width="30" height="30" fill="#000"/>
              <rect x="5" y="5" width="20" height="20" fill="#fff"/>
              <rect x="10" y="10" width="10" height="10" fill="#000"/>
              <rect x="70" y="0" width="30" height="30" fill="#000"/>
              <rect x="75" y="5" width="20" height="20" fill="#fff"/>
              <rect x="80" y="10" width="10" height="10" fill="#000"/>
              <rect x="0" y="70" width="30" height="30" fill="#000"/>
              <rect x="5" y="75" width="20" height="20" fill="#fff"/>
              <rect x="10" y="80" width="10" height="10" fill="#000"/>
              <rect x="40" y="20" width="10" height="40" fill="#000"/>
              <rect x="50" y="50" width="20" height="10" fill="#000"/>
              <rect x="40" y="70" width="20" height="20" fill="#000"/>
              <rect x="70" y="70" width="15" height="15" fill="#000"/>
            </svg>
            <button class="btn primary" id="simulate-qr-scan">Simulate Phone Connection Scan</button>
          </div>
        </section>
        <section class="panel">
          <h2>Direct Link Setup</h2>
          <p class="meta">Alternatively, connect by entering your WhatsApp phone number to receive a pairing code.</p>
          <div class="auth-form" style="margin-top: 1rem;">
            <label>WhatsApp Number
              <input type="tel" class="input" id="whatsapp-num-input" placeholder="+1 (555) 000-0000">
            </label>
            <button class="btn secondary" id="whatsapp-pairing-btn" style="margin-top:10px;">Generate Pairing Code</button>
          </div>
        </section>
      </div>
    `);
  }

  const selectedConvo = filtered.find(c => c.id === activeConversationId) || filtered[0];

  if (!selectedConvo) {
    return shell(`
      <div class="page-head">
        <div class="page-copy">
          <p class="eyebrow">Unified Conversation Center</p>
          <h1>${title}</h1>
        </div>
      </div>
      ${emptyState("No Active Conversations", "Chats will appear here once messages are recorded.")}
    `);
  }

  const messagesList = (selectedConvo.messages || []).map(msg => {
    const isAi = msg.senderType === 'AI';
    const isStaff = msg.senderType === 'STAFF';
    const align = isAi || isStaff ? 'right' : 'left';
    const bg = isAi ? 'var(--primary)' : (isStaff ? '#eaeaea' : '#f0f0f0');
    const color = isAi ? 'var(--primary-contrast)' : '#000';
    return `<div style="display:flex; justify-content:${align === 'right' ? 'flex-end' : 'flex-start'}; margin-bottom:10px;">
      <div style="background:	ext {bg}; color:	ext {color}; padding:8px 12px; border-radius:12px; max-width:70%;">
        <div style="font-size:10px; opacity:0.75; margin-bottom:4px;">${msg.senderType}</div>
        <div>${escapeHtml(msg.content)}</div>
      </div>
    </div>`;
  }).join('');

  return shell(`
    <div class="page-head">
      <div class="page-copy">
        <p class="eyebrow">WhatsApp Channel Center</p>
        <h1>WhatsApp Conversations</h1>
      </div>
      <div>
        <span class="badge success" style="margin-right:10px;">WhatsApp Active</span>
        <button class="btn danger" id="disconnect-whatsapp-btn">Disconnect Number</button>
      </div>
    </div>
    <div class="grid two-col" style="grid-template-columns: 1fr 2fr;">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Inbox</h2>
            <p class="meta">${filtered.length} active chats.</p>
          </div>
        </div>
        ${conversationList(filtered)}
      </section>
      <section class="panel" style="display:flex; flex-direction:column; min-height: 60vh;">
        <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom: 10px;">
          <div>
            <h2>${escapeHtml(selectedConvo.customer)}</h2>
            <p class="meta">Status: <span class="badge ${badgeClass(selectedConvo.status)}">${selectedConvo.status}</span></p>
          </div>
          <div>
            <label style="display:inline-flex; align-items:center; gap:8px; font-weight:500; font-size:13px; cursor:pointer;">
              <span>Handled by AI (${assistantName})</span>
              <input type="checkbox" id="takeover-toggle" ${selectedConvo.handler === 'Staff' ? 'checked' : ''} style="cursor:pointer;">
              <span>Takeover (Owner)</span>
            </label>
          </div>
        </div>
        <div class="chat-messages" style="flex:1; overflow-y:auto; padding:15px 0;" id="chat-messages-container">
          ${messagesList}
        </div>
        <form id="chat-reply-form" style="display:flex; gap:10px; border-top:1px solid var(--border); padding-top:10px;">
          <input type="text" class="input" id="chat-reply-input" placeholder="Type a reply as ${selectedConvo.handler === 'Staff' ? 'Owner (Human)' : 'Walter (AI mockup)'}..." required style="flex:1;">
          <button class="btn primary" type="submit">Send</button>
        </form>
      </section>
    </div>
  `);
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
      
      <div style="display: flex; gap: 10px; justify-content: space-between; width: 100%;">
        <button class="btn primary" type="submit">${isEditing ? "Save Customer" : "Create Customer"}</button>
        ${isEditing ? `<button class="btn danger" type="button" id="delete-customer-btn">Delete Customer</button>` : ""}
      </div>
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
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Service Catalog</p><h1>Services</h1><p>Define bookable appointments with duration, buffer time, pricing, and active status.</p></div><button class="btn primary" data-action="save">Add Service</button></div>
  ${services.length === 0 ? emptyState("No Services Yet", "Add services before customers can book appointments.") : `<div class="grid three-col">${services.map((service) => `<article class="card service-card"><div class="card-top"><h3>${escapeHtml(service.name)}</h3><span class="badge ${service.active ? "success" : ""}">${service.active ? "Active" : "Paused"}</span></div><p>${escapeHtml(service.description)}</p><div class="setting-list compact-list">${settingRow("Duration", service.duration, service.price)}${settingRow("Buffer", service.buffer, "Protected")}</div></article>`).join("")}</div>`}`);
}

function staffPage() {
  const staff = staffDirectory.list();
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Team Routing</p><h1>Staff</h1><p>Manage who receives appointments, which profiles are active, and how staff contact details appear in scheduling workflows.</p></div><button class="btn primary" data-action="save">Invite Staff</button></div>
  ${staff.length === 0 ? emptyState("No Staff Yet", "Invite team members or create staff profiles for appointment assignment.") : `<div class="grid three-col">${staff.map((person) => `<article class="card staff-card"><div class="avatar">${escapeHtml(person.name.split(" ").map((part) => part[0]).join("").slice(0, 2))}</div><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.title)}</p><div class="setting-list compact-list">${settingRow("Email", person.email, person.active ? "Active" : "Paused")}${settingRow("Phone", person.phone, "Routing")}</div></article>`).join("")}</div>`}`);
}

function automationPage() {
  const rules = [
    ["Confirmation Chase", "Send a reminder when an appointment is still pending 24 hours before start time.", "Ready"],
    ["No-Show Watch", "Flag customers with repeated missed appointments for staff review.", "Monitoring"],
    ["Human Escalation", "Move pricing disputes, medical questions, and unclear requests out of automation.", "Protected"],
  ];
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Automation Rules</p><h1>Automation Rules</h1><p>Control where ${assistantName} acts automatically and where your team stays in the loop.</p></div><button class="btn primary" data-action="save">New Rule</button></div>
  <div class="grid three-col">${rules.map(([name, detail, status]) => `<article class="card"><div class="card-top"><h3>${name}</h3><span class="badge success">${status}</span></div><p>${detail}</p><div class="rule-flow"><span>Trigger</span><span>Condition</span><span>Action</span></div></article>`).join("")}</div>`);
}

function assistantPage() {
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Assistant Behavior</p><h1>AI Assistant Settings</h1><p>Tune ${assistantName}'s identity, booking permissions, escalation style, and customer-facing tone.</p></div><button class="btn primary" data-action="save">Save Assistant</button></div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>${escapeHtml(assistantName)} Profile</h2><p class="meta">The name and tone customers experience across calls and messages.</p></div></div><div class="auth-form">
      <label>Assistant Name<input class="input" value="${escapeHtml(assistantName)}"></label>
      <label>Tone<select class="select"><option>Warm and efficient</option><option>Formal and concise</option><option>Friendly and conversational</option></select></label>
      <label>Booking Permission<select class="select"><option>Book, reschedule, and cancel within policy</option><option>Only suggest available times</option><option>Escalate all schedule changes</option></select></label>
    </div></section>
    <section class="panel"><div class="panel-head"><div><h2>Escalation Boundaries</h2><p class="meta">Clear limits keep the product trustworthy.</p></div></div><div class="setting-list">
      ${settingRow("Pricing Questions", "Send to staff when pricing is ambiguous", "Escalate")}
      ${settingRow("Double Booking", "Never override backend availability checks", "Blocked")}
      ${settingRow("Customer Identity", "Confirm the person before changing an appointment", "Required")}
    </div></section>
  </div>`);
}

function integrationsPage() {
  const integrations = [
    ["Calendar", "Sync staff availability and push confirmed appointments.", "Not Connected"],
    ["Phone", `Route inbound calls through ${assistantName}.`, "Not Connected"],
    ["Messaging", "Unify WhatsApp and email conversations.", state.whatsappConnected ? "Connected" : "Not Connected"],
    ["Payments", "Attach deposits and invoices to booked services.", "Planned"],
  ];
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Connected Channels</p><h1>Integrations</h1><p>Connect the systems that feed appointment requests into the same backend workflow.</p></div><button class="btn primary" data-action="save">Connect App</button></div>
  <div class="grid four-col">${integrations.map(([name, detail, status]) => `<article class="card integration-card"><h3>${name}</h3><p>${detail}</p><span class="badge">${status}</span></article>`).join("")}</div>`);
}

function billingPage() {
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Plan And Usage</p><h1>Billing</h1><p>Track subscription status, receptionist usage, and billing controls for this workspace.</p></div><button class="btn primary" data-action="save">Manage Plan</button></div>
  <div class="grid two-col">
    <section class="panel"><div class="panel-head"><div><h2>Current Plan</h2><p class="meta">Workspace billing summary.</p></div><span class="badge warning">Setup Needed</span></div><div class="metric-strip billing-metrics">${metric("Starter", "Plan")}${metric("$0", "Current balance")}</div></section>
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
  const data = state.analytics || { bookingSuccessRate: "0%", avgResponseTimeSaved: "0m", escalationsCount: 0, customerRating: "N/A" };
  return shell(`<div class="page-head"><div class="page-copy"><p class="eyebrow">Operational Reporting</p><h1>Analytics</h1><p>Outcome-oriented reporting for bookings, escalations, response time, and customer satisfaction.</p></div></div>
  <div class="metric-strip">${metric(data.bookingSuccessRate, "Booking success")}${metric(data.avgResponseTimeSaved, "Avg response saved")}${metric(data.escalationsCount, "Escalations")}${metric(data.customerRating, "Customer rating")}</div>
  <section class="panel"><h2>Conversation outcomes</h2><p>Resolved appointment requests, confirmations, cancellations, and escalations recorded in database history.</p></section>`);
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

  const deleteCustomerBtn = document.getElementById("delete-customer-btn");
  if (deleteCustomerBtn) {
    deleteCustomerBtn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to delete this customer? This will also delete their appointments.")) return;
      try {
        await customerService.delete(customerEditor);
        showToast("Customer deleted successfully.");
        customerEditor = null;
        render();
      } catch (err) {
        showToast(err.message || "Failed to delete customer");
      }
    });
  }

  // WhatsApp Simulate Connection
  const simulateScanBtn = document.getElementById("simulate-qr-scan");
  if (simulateScanBtn) {
    simulateScanBtn.addEventListener("click", () => {
      localStorage.setItem("whatsapp_connected", "true");
      state.whatsappConnected = true;
      showToast("WhatsApp successfully connected!");
      render();
    });
  }

  const disconnectWhatsappBtn = document.getElementById("disconnect-whatsapp-btn");
  if (disconnectWhatsappBtn) {
    disconnectWhatsappBtn.addEventListener("click", () => {
      localStorage.removeItem("whatsapp_connected");
      state.whatsappConnected = false;
      showToast("WhatsApp disconnected.");
      render();
    });
  }

  // Conversation open
  document.querySelectorAll("[data-open-convo]").forEach((element) => {
    element.addEventListener("click", () => {
      activeConversationId = element.dataset.openConvo;
      render();
    });
  });

  // Handler Takeover Toggle
  const takeoverToggle = document.getElementById("takeover-toggle");
  if (takeoverToggle) {
    takeoverToggle.addEventListener("change", async (e) => {
      const handlerVal = e.target.checked ? "Staff" : assistantName;
      try {
        await apiCall(`/conversations/${activeConversationId}`, "PATCH", {
          handler: handlerVal,
          status: e.target.checked ? "Human review" : "Resolved"
        });
        showToast(e.target.checked ? "Owner took over the chat." : "Handover back to Walter AI.");
        await stateManager.loadAll();
        render();
      } catch (err) {
        showToast(err.message || "Failed to update handler");
      }
    });
  }

  // Chat reply form
  const chatReplyForm = document.getElementById("chat-reply-form");
  if (chatReplyForm) {
    chatReplyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("chat-reply-input");
      const contentStr = input.value.trim();
      if (!contentStr) return;

      const filtered = conversationService.byChannel("WhatsApp");
      const selectedConvo = filtered.find(c => c.id === activeConversationId) || filtered[0];
      const senderType = selectedConvo.handler === 'Staff' ? 'STAFF' : 'AI';

      try {
        await apiCall(`/conversations/${selectedConvo.id}/messages`, "POST", {
          senderType,
          content: contentStr
        });

        input.value = '';
        await stateManager.loadAll();
        render();

        if (selectedConvo.handler !== 'Staff') {
          setTimeout(async () => {
            try {
              await apiCall(`/conversations/${selectedConvo.id}/messages`, "POST", {
                senderType: 'CUSTOMER',
                content: "Sure, let's proceed with that."
              });
              await stateManager.loadAll();
              render();
            } catch (err) {}
          }, 1500);
        }
      } catch (err) {
        showToast(err.message || "Failed to send message");
      }
    });
  }

}

async function render() {
  app.innerHTML = pageForRoute();
  updateClock();
  attachFormListeners();

  document.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", () => navigate(element.dataset.route)));
  document.querySelectorAll("[data-open-appt]").forEach((element) => element.addEventListener("click", () => {
    drawerAppointment = element.dataset.openAppt;
    render();
  }));

  document.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", async () => {
    const action = element.dataset.action;
    const apptId = element.dataset.id || drawerAppointment;

    if (action === "close") {
      drawerAppointment = null;
      render();
      return;
    }

    if (action === "close-customer") {
      customerEditor = null;
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

    if (action === "edit-customer") {
      customerEditor = element.dataset.id;
      render();
      return;
    }

    if (action === "confirm-appt" && apptId) {
      try {
        await appointmentService.confirm(apptId);
        showToast("Appointment confirmed!");
      } catch (e) { showToast(e.message); }
      return;
    }

    if (action === "cancel-appt" && apptId) {
      if (!confirm("Cancel this appointment?")) return;
      try {
        await appointmentService.cancel(apptId);
        drawerAppointment = null;
        showToast("Appointment cancelled.");
      } catch (e) { showToast(e.message); }
      return;
    }

    if (action === "reschedule-appt" && apptId) {
      const newTime = prompt("Enter new date & time (e.g. 2026-08-17T15:30:00.000Z):", new Date().toISOString());
      if (newTime) {
        try {
          await appointmentService.reschedule(apptId, newTime);
          showToast("Appointment rescheduled!");
        } catch (e) { showToast(e.message); }
      }
      return;
    }

    if (action === "book") {
      showBookingDialog();
      return;
    }

    showToast(notificationService.messageFor(action));
  }));
}


function bookingModal(date, slots) {
  const customerOptions = state.customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const serviceOptions = state.services.map(s => `<option value="${s.id}">${escapeHtml(s.name)} ($${s.price})</option>`).join('');
  const staffOptions = state.staff.map(st => `<option value="${st.id}">${escapeHtml(st.name)}</option>`).join('');

  return `
    <div class="modal-backdrop open" role="dialog" aria-modal="true" style="z-index: 1000;">
      <div class="modal-panel auth-form" style="max-height: 90vh; overflow-y: auto;">
        <div class="page-head compact">
          <div class="page-copy">
            <p class="eyebrow">New Appointment</p>
            <h2>Book Appointment</h2>
          </div>
          <button class="btn" type="button" id="cancel-booking">Close</button>
        </div>
        
        <label for="booking-customer">Customer</label>
        <select id="booking-customer" class="select" required>
          <option value="">-- Select Customer --</option>
          ${customerOptions}
        </select>
        
        <label for="booking-service">Service</label>
        <select id="booking-service" class="select" required>
          <option value="">-- Select Service --</option>
          ${serviceOptions}
        </select>
        
        <label for="booking-staff">Staff</label>
        <select id="booking-staff" class="select">
          <option value="">-- Select Staff (Optional) --</option>
          ${staffOptions}
        </select>

        <label for="booking-date">Date</label>
        <input type="date" id="booking-date" class="input" value="${date}" min="${new Date().toISOString().split('T')[0]}" required />
        
        <label>Time Slot</label>
        <div class="slot-grid" id="booking-slots-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 15px;">
          ${slots.map(slot => `
            <button class="slot-btn" type="button" data-time="	ext {slot}">${slot}</button>
          `).join('')}
        </div>
        
        <div class="modal-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn primary" id="confirm-booking" type="button">Confirm</button>
          <button class="btn" id="cancel-booking-btn" type="button">Cancel</button>
        </div>
      </div>
    </div>`;
}

function showBookingDialog() {
  const today = new Date().toISOString().split('T')[0];
  const availableSlots = getAvailableSlots(new Date());
  
  let modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }
  
  modalRoot.innerHTML = bookingModal(today, availableSlots);
  attachBookingDialogListeners();
}

function hideBookingDialog() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) {
    modalRoot.innerHTML = '';
  }
}

function getAvailableSlots(dateObj) {
  const slots = [];
  const start = new Date(dateObj);
  start.setHours(9, 0, 0, 0);
  const end = new Date(dateObj);
  end.setHours(17, 0, 0, 0);
  for (let t = new Date(start); t < end; t.setMinutes(t.getMinutes() + 15)) {
    const overlap = state.appointments.some(appt => {
      const apptDate = new Date(appt.startTime);
      return apptDate.toDateString() === dateObj.toDateString() &&
             Math.abs(apptDate - t) < 15 * 60 * 1000;
    });
    if (!overlap) {
      slots.push(t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
    }
  }
  return slots;
}

function attachBookingDialogListeners() {
  const modal = document.querySelector('.modal-backdrop');
  if (!modal) return;
  const dateInput = modal.querySelector('#booking-date');
  const slotContainer = modal.querySelector('#booking-slots-grid');
  const confirmBtn = modal.querySelector('#confirm-booking');
  const cancelBtn = modal.querySelector('#cancel-booking');
  const cancelBtn2 = modal.querySelector('#cancel-booking-btn');

  dateInput.addEventListener('change', () => {
    const selectedDate = new Date(dateInput.value);
    const today = new Date();
    if (selectedDate < new Date(today.toDateString())) {
      showToast('Cannot book in the past');
      dateInput.value = today.toISOString().split('T')[0];
      return;
    }
    const newSlots = getAvailableSlots(selectedDate);
    slotContainer.innerHTML = newSlots.map(s => `<button class="slot-btn" type="button" data-time="${s}">${s}</button>`).join('');
  });

  slotContainer.addEventListener('click', e => {
    if (e.target.matches('.slot-btn')) {
      slotContainer.querySelectorAll('.slot-btn').forEach(btn => btn.classList.remove('selected'));
      e.target.classList.add('selected');
    }
  });

  confirmBtn.addEventListener('click', async () => {
    const customerId = modal.querySelector('#booking-customer').value;
    const serviceId = modal.querySelector('#booking-service').value;
    const staffId = modal.querySelector('#booking-staff').value || null;
    const selectedDate = dateInput.value;
    const selectedSlotBtn = slotContainer.querySelector('.slot-btn.selected');
    
    if (!customerId) {
      showToast('Please select a customer');
      return;
    }
    if (!serviceId) {
      showToast('Please select a service');
      return;
    }
    if (!selectedSlotBtn) {
      showToast('Please select a time slot');
      return;
    }

    const timeStr = selectedSlotBtn.dataset.time;
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') {
      hours = '00';
    }
    if (modifier === 'PM') {
      hours = parseInt(hours, 10) + 12;
    }
    const dt = new Date(selectedDate);
    dt.setHours(hours, minutes, 0, 0);

    const payload = {
      startTime: dt.toISOString(),
      serviceId,
      staffId,
      customerId,
      channel: 'web'
    };

    try {
      await appointmentService.book(payload);
      showToast(`Booked appointment successfully!`);
      hideBookingDialog();
      render();
    } catch (err) {
      showToast(err.message || 'Failed to book appointment');
    }
  });

  const closeDialog = () => hideBookingDialog();
  if (cancelBtn) cancelBtn.addEventListener('click', closeDialog);
  if (cancelBtn2) cancelBtn2.addEventListener('click', closeDialog);
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

function updateClock() {
  const clockEl = document.getElementById("header-clock");
  if (clockEl) {
    const tz = (currentUser && currentUser.business && currentUser.business.timezone) || "America/New_York";
    try {
      clockEl.textContent = new Date().toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    } catch (e) {
      clockEl.textContent = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    }
  }
}

updateClock();
setInterval(updateClock, 1000);

