/* =============================================================================
   SUIVI ANNUALISATION — Module principal : état, navigation, connexion
   ========================================================================== */

window.Pages = window.Pages || {};

const App = {
  state: {
    currentUser: null,   // fiche complète de l'utilisateur connecté
    users: {},           // username → fiche (chargé après connexion)
    periodConfig: null,
    holidays: {},        // "YYYY-MM-DD" → {name, open}
    openSundays: {},     // "YYYY-MM-DD" → {note}
    lockedMonths: {},    // "YYYY-MM" → true
    page: null,
    pageParams: {},
    _scheduleCache: {},  // username → {userId, days}
  },

  // ==========================================================================
  // Définition de la navigation
  // ==========================================================================
  NAV: [
    {
      section: "Mon espace", pages: [
        { id: "accueil", label: "Tableau de bord", icon: "🏠" },
        { id: "mon-planning", label: "Mon Planning", icon: "📅" },
        { id: "planning-type", label: "Planning Type Hebdo", icon: "🗓" },
        { id: "demande-absence", label: "Demande d'Absence", icon: "🏖" },
        { id: "mes-demandes", label: "Mes Demandes d'Absence", icon: "📋" },
        { id: "camionnette", label: "Emprunt Camionnette", icon: "🚐" },
        { id: "mes-documents", label: "Mes Documents", icon: "📁" },
        { id: "acomptes", label: "Acomptes sur Salaire", icon: "💶" },
        { id: "info-1607", label: "Tout sur les 1607 h", icon: "🎓" },
      ],
    },
    {
      section: "Équipe", pages: [
        { id: "planning-equipe", label: "Planning Équipe", icon: "👥" },
      ],
    },
    {
      section: "Gestion", admin: true, pages: [
        { id: "alertes", label: "Alertes & Bilan", icon: "🚨" },
        { id: "modif-planning", label: "Modifier un Planning", icon: "✏️" },
        { id: "impression", label: "Impression Planning", icon: "🖨" },
        { id: "gestion-absences", label: "Demandes d'Absence", icon: "✅", badge: "absences" },
        { id: "gestion-camion", label: "Demandes d'Emprunt", icon: "🔑", badge: "van" },
        { id: "mes-absences-admin", label: "Mes Absences", icon: "🗒" },
        { id: "documents-admin", label: "Documents RH", icon: "🗄" },
        { id: "acomptes-admin", label: "Gestion des Acomptes", icon: "🖋" },
      ],
    },
    {
      section: "Administration", admin: true, pages: [
        { id: "gestion-equipe", label: "Gestion Équipe", icon: "🧑‍🤝‍🧑" },
        { id: "feries", label: "Fériés & Dimanches", icon: "🎌" },
        { id: "blocage-mois", label: "Blocage des Mois", icon: "🔒" },
        { id: "config-periode", label: "Config Période", icon: "⚙️" },
        { id: "annonces", label: "Annonces", icon: "📢" },
        { id: "historique", label: "Historique", icon: "📜" },
        { id: "sauvegardes", label: "Sauvegardes", icon: "💾" },
        { id: "all-reset", label: "ALL RESET", icon: "⚠️" },
      ],
    },
  ],

  _badges: { absences: 0, van: 0 },

  // ==========================================================================
  // Initialisation
  // ==========================================================================
  async init() {
    UI.initTheme();
    if (DEMO_MODE) document.getElementById("demo-banner").hidden = false;

    document.getElementById("login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      App.login();
    });
    document.getElementById("logout-btn").addEventListener("click", () => App.logout());
    document.getElementById("theme-toggle").addEventListener("click", () => UI.toggleTheme());
    document.getElementById("burger").addEventListener("click", () =>
      document.getElementById("sidebar").classList.toggle("open"));

    await Store.init();
    Store.onAuthChange(async (username) => {
      if (username && !App.state.currentUser) await App.onSignedIn(username);
      if (!username && App.state.currentUser) App.showLogin();
    });
  },

  async login() {
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;
    try {
      await Store.signIn(username, password);
      // onAuthChange prend le relais.
    } catch (e) {
      console.warn(e);
      UI.toast("Identifiant ou mot de passe incorrect.", "error");
    }
  },

  async logout() {
    await Store.signOut();
    App.showLogin();
  },

  showLogin() {
    App.state.currentUser = null;
    App.state._scheduleCache = {};
    document.getElementById("app").hidden = true;
    document.getElementById("login-screen").hidden = false;
    document.getElementById("login-password").value = "";
  },

  async onSignedIn(username) {
    const user = await Store.get("users", username);
    if (!user) {
      UI.toast("Compte de connexion valide mais fiche collaborateur introuvable. Contactez l'administrateur.", "error", 7000);
      await Store.signOut();
      return;
    }
    App.state.currentUser = user;
    await App.reloadSettings();
    await App.reloadUsers();

    document.getElementById("login-screen").hidden = true;
    document.getElementById("app").hidden = false;
    document.getElementById("topbar-user").textContent = user.name;
    document.getElementById("brand-role").textContent =
      user.role === "admin" ? "Espace responsable" : "Espace collaborateur";

    App.renderNav();
    await App.refreshBadges();
    App.navigate("accueil");
    App.showAnnouncements();

    if (user.role === "admin") {
      // Tâches quotidiennes déclenchées à la première connexion admin du jour.
      PagesAdmin.maybeAutoSnapshot().catch(console.warn);
      PagesAdmin.maybeSendDigest(false).catch(console.warn);
    }
  },

  // ==========================================================================
  // Chargement des données partagées
  // ==========================================================================
  async reloadSettings() {
    const [period, holidays, sundays, locked] = await Promise.all([
      Store.get("settings", "periodConfig"),
      Store.get("settings", "holidays"),
      Store.get("settings", "openSundays"),
      Store.get("settings", "lockedMonths"),
    ]);
    App.state.periodConfig = period || defaultPeriodConfig();
    App.state.holidays = holidays?.list || {};
    App.state.openSundays = sundays?.list || {};
    App.state.lockedMonths = locked?.list || {};
  },

  async reloadUsers() {
    App.state.users = await Store.list("users");
  },

  /** Liste triée des collaborateurs (fiches). */
  usersList() {
    return Object.values(App.state.users).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },

  isAdmin() { return App.state.currentUser?.role === "admin"; },

  isMonthLocked(year, month) {
    return !!App.state.lockedMonths[`${year}-${pad2(month)}`];
  },

  // --- Plannings (avec cache de session) ---------------------------------------
  async getSchedule(username, { fresh = false } = {}) {
    if (!fresh && App.state._scheduleCache[username]) return App.state._scheduleCache[username];
    const doc = await Store.get("schedules", username);
    const schedule = doc || { userId: username, days: {} };
    schedule.days = schedule.days || {};
    App.state._scheduleCache[username] = schedule;
    return schedule;
  },

  async saveSchedule(username, days) {
    const schedule = { userId: username, days };
    App.state._scheduleCache[username] = schedule;
    await Store.set("schedules", username, schedule);
  },

  clearScheduleCache(username) {
    if (username) delete App.state._scheduleCache[username];
    else App.state._scheduleCache = {};
  },

  // ==========================================================================
  // Navigation
  // ==========================================================================
  renderNav() {
    const nav = document.getElementById("sidebar-nav");
    nav.innerHTML = "";
    for (const section of App.NAV) {
      if (section.admin && !App.isAdmin()) continue;
      const sec = document.createElement("div");
      sec.className = "nav-section";
      const title = document.createElement("button");
      title.className = "nav-section-title";
      title.innerHTML = `<span>${UI.esc(section.section)}</span><span class="chev">▾</span>`;
      title.addEventListener("click", () => sec.classList.toggle("collapsed"));
      sec.appendChild(title);
      for (const p of section.pages) {
        const btn = document.createElement("button");
        btn.className = "nav-item";
        btn.dataset.page = p.id;
        btn.innerHTML = `<span class="icon">${p.icon}</span><span>${UI.esc(p.label)}</span>` +
          (p.badge ? `<span class="nav-badge" data-badge="${p.badge}" hidden></span>` : "");
        btn.addEventListener("click", () => {
          App.navigate(p.id);
          document.getElementById("sidebar").classList.remove("open");
        });
        sec.appendChild(btn);
      }
      nav.appendChild(sec);
    }
    App.renderBadges();
  },

  async refreshBadges() {
    if (!App.isAdmin()) return;
    try {
      const [absences, vans] = await Promise.all([
        Store.list("absenceRequests"), Store.list("vanRequests"),
      ]);
      App._badges.absences = Object.values(absences).filter((r) => r.status === "pending").length;
      App._badges.van = Object.values(vans).filter((r) => r.status === "pending").length;
      App.renderBadges();
    } catch (e) { console.warn(e); }
  },

  renderBadges() {
    document.querySelectorAll("[data-badge]").forEach((el) => {
      const n = App._badges[el.dataset.badge] || 0;
      el.hidden = n === 0;
      el.textContent = n;
    });
  },

  navigate(pageId, params = {}) {
    const renderer = Pages[pageId];
    if (!renderer) { UI.toast("Page introuvable.", "error"); return; }
    App.state.page = pageId;
    App.state.pageParams = params;

    document.querySelectorAll(".nav-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.page === pageId));
    const label = App.NAV.flatMap((s) => s.pages).find((p) => p.id === pageId)?.label || "";
    document.getElementById("topbar-title").textContent = label;

    const container = document.getElementById("page");
    container.innerHTML = UI.spinner();
    Promise.resolve(renderer(container, params)).catch((e) => {
      console.error(e);
      container.innerHTML = `<div class="banner banner-danger">Erreur de chargement de la page : ${UI.esc(e.message)}</div>`;
    });
    App.refreshBadges();
  },

  // ==========================================================================
  // Annonces (popup à acquitter à la connexion)
  // ==========================================================================
  async showAnnouncements() {
    try {
      const all = await Store.list("announcements");
      const me = App.state.currentUser.username;
      const pending = Object.values(all)
        .filter((a) => a.active && !(a.acknowledgedBy || {})[me])
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const showNext = () => {
        const a = pending.shift();
        if (!a) return;
        UI.modal({
          title: `📢 ${a.title}`,
          body: `<p style="white-space:pre-wrap">${UI.esc(a.message)}</p>`,
          actions: [{
            label: "J'ai bien pris connaissance", className: "btn btn-primary",
            onClick: async (close) => {
              await Store.update("announcements", a.id, {
                acknowledgedBy: { ...(a.acknowledgedBy || {}), [me]: Date.now() },
              });
              close();
              showNext();
            },
          }],
        });
      };
      showNext();
    } catch (e) { console.warn(e); }
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
