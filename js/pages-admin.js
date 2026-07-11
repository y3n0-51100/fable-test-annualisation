/* =============================================================================
   SUIVI ANNUALISATION — Pages espace administrateur
   ========================================================================== */

window.Pages = window.Pages || {};

const PagesAdmin = {

  // ==========================================================================
  // Helpers
  // ==========================================================================
  /** Calcule les alertes de tous les collaborateurs. */
  async computeAllAlerts() {
    const cfg = App.state.periodConfig;
    const out = [];
    for (const u of App.usersList()) {
      const schedule = await App.getSchedule(u.username);
      const alerts = computeAlerts(u, schedule.days, cfg);
      out.push({ user: u, alerts });
    }
    return out;
  },

  // ==========================================================================
  // Tableau de bord admin
  // ==========================================================================
  async dashboard(container) {
    const cfg = App.state.periodConfig;
    const [absences, vans, digestLog] = await Promise.all([
      Store.list("absenceRequests"), Store.list("vanRequests"), Store.get("settings", "digestLog"),
    ]);
    const pendingAbs = Object.values(absences).filter((r) => r.status === "pending").length;
    const pendingVan = Object.values(vans).filter((r) => r.status === "pending").length;
    const allAlerts = await PagesAdmin.computeAllAlerts();
    const nCrit = allAlerts.reduce((n, a) => n + a.alerts.filter((x) => x.level === "critical").length, 0);
    const nWarn = allAlerts.reduce((n, a) => n + a.alerts.filter((x) => x.level === "warning").length, 0);

    // Statut « aujourd'hui » de toute l'équipe.
    const tk = todayKey();
    const todayRows = [];
    for (const u of App.usersList()) {
      const schedule = await App.getSchedule(u.username);
      const st = PagesEmployee.dayStatus(schedule.days[tk], u);
      todayRows.push(`<div>${st.icon} <strong>${UI.esc(u.name)}</strong> — ${UI.esc(st.label)}</div>`);
    }

    // 3 prochains jours fériés.
    const upcoming = Object.entries(App.state.holidays)
      .filter(([k]) => k >= tk).sort(([a], [b]) => a.localeCompare(b)).slice(0, 3);

    const lastSent = digestLog?.lastSentMs
      ? new Date(digestLog.lastSentMs).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
      : "jamais";

    container.innerHTML = `
      <div class="grid grid-kpi">
        <div class="kpi accent clickable" data-nav="gestion-absences"><div class="kpi-label">Absences en attente</div>
          <div class="kpi-value">${pendingAbs}</div><div class="kpi-sub">cliquer pour gérer</div></div>
        <div class="kpi accent clickable" data-nav="gestion-camion"><div class="kpi-label">Camionnette en attente</div>
          <div class="kpi-value">${pendingVan}</div><div class="kpi-sub">cliquer pour gérer</div></div>
        <div class="kpi danger clickable" data-nav="alertes"><div class="kpi-label">Alertes critiques</div>
          <div class="kpi-value">${nCrit}</div><div class="kpi-sub">cliquer pour le bilan</div></div>
        <div class="kpi warning clickable" data-nav="alertes"><div class="kpi-label">Alertes de vigilance</div>
          <div class="kpi-value">${nWarn}</div><div class="kpi-sub">cliquer pour le bilan</div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>Aujourd'hui — ${frDateLabel(tk)}</h3>
          <div class="today-list">${todayRows.join("") || '<p class="muted">Aucun collaborateur.</p>'}</div>
        </div>
        <div>
          <div class="card">
            <h3>Prochains jours fériés</h3>
            ${upcoming.length === 0 ? '<p class="muted">Aucun férié à venir enregistré.</p>' :
              upcoming.map(([k, h]) => `<div style="margin-bottom:.3rem">🎌 <strong>${frDateShort(k)}</strong> —
                ${UI.esc(h.name)} <span class="day-badge" style="background:${h.open ? "var(--success)" : "var(--danger)"}">${h.open ? "Ouvert" : "Fermé"}</span></div>`).join("")}
          </div>
          <div class="card">
            <h3>Récapitulatif e-mail quotidien</h3>
            <p class="muted">Dernier envoi : ${lastSent}. Envoi automatique au maximum une fois par 24 h, à la
            première connexion admin de la journée.</p>
            <button class="btn btn-secondary" id="send-digest">📧 Envoyer maintenant</button>
          </div>
        </div>
      </div>`;

    container.querySelectorAll("[data-nav]").forEach((el) =>
      el.addEventListener("click", () => App.navigate(el.dataset.nav)));
    container.querySelector("#send-digest").addEventListener("click", async () => {
      const ok = await PagesAdmin.maybeSendDigest(true);
      if (ok) App.navigate("accueil");
    });
  },

  // ==========================================================================
  // Récapitulatif e-mail (auto 1×/24 h ou manuel)
  // ==========================================================================
  async maybeSendDigest(force = false) {
    const digestLog = (await Store.get("settings", "digestLog")) || { lastSentMs: 0 };
    if (!force && Date.now() - (digestLog.lastSentMs || 0) < DIGEST_INTERVAL_MS) return false;
    if (!emailConfigured()) {
      if (force) UI.toast("Service e-mail non configuré : récapitulatif non envoyé.", "warning");
      return false;
    }
    const [absences, vans] = await Promise.all([
      Store.list("absenceRequests"), Store.list("vanRequests"),
    ]);
    const allAlerts = await PagesAdmin.computeAllAlerts();
    const criticals = allAlerts.flatMap(({ user, alerts }) =>
      alerts.filter((a) => a.level === "critical").map((a) => `• ${user.name} : ${a.message}`));
    const ok = await sendEmail("adminDigest", {
      to_email: MANAGER_EMAIL,
      pending_absences: Object.values(absences).filter((r) => r.status === "pending").length,
      pending_vans: Object.values(vans).filter((r) => r.status === "pending").length,
      critical_count: criticals.length,
      warning_count: allAlerts.reduce((n, a) => n + a.alerts.filter((x) => x.level === "warning").length, 0),
      critical_list: criticals.slice(0, 8).join("\n") || "Aucune alerte critique.",
    });
    if (ok) {
      await Store.set("settings", "digestLog", { lastSentMs: Date.now() });
      UI.toast("Récapitulatif envoyé.", "success");
    }
    return ok;
  },

  // ==========================================================================
  // Alertes & bilan d'annualisation
  // ==========================================================================
  async alertes(container) {
    const cfg = App.state.periodConfig;
    const all = await PagesAdmin.computeAllAlerts();
    const flat = all.flatMap(({ user, alerts }) => alerts.map((a) => ({ user, ...a })));
    const counts = {
      critical: flat.filter((a) => a.level === "critical").length,
      warning: flat.filter((a) => a.level === "warning").length,
      info: flat.filter((a) => a.level === "info").length,
      ok: all.filter((x) => x.alerts.length === 0).length,
    };
    let filter = "all";

    const render = () => {
      const shown = filter === "all" ? flat
        : filter === "ok" ? [] : flat.filter((a) => a.level === filter);
      container.innerHTML = `
        <div class="grid grid-kpi">
          <div class="kpi"><div class="kpi-label">Période écoulée</div>
            <div class="kpi-value">${Math.round(elapsedRatio(cfg) * 100)} %</div></div>
          <div class="kpi danger"><div class="kpi-label">Critiques</div><div class="kpi-value">${counts.critical}</div></div>
          <div class="kpi warning"><div class="kpi-label">Vigilance</div><div class="kpi-value">${counts.warning}</div></div>
          <div class="kpi"><div class="kpi-label">Infos</div><div class="kpi-value">${counts.info}</div></div>
          <div class="kpi" style="border-top-color:var(--success)"><div class="kpi-label">Conformes</div><div class="kpi-value">${counts.ok}</div></div>
        </div>
        <div class="filters-row">
          ${[["all", "Toutes"], ["critical", "🔴 Critiques"], ["warning", "🟠 Vigilance"], ["info", "🔵 Infos"], ["ok", "🟢 Conformes"]]
            .map(([k, l]) => `<button class="chip ${filter === k ? "active" : ""}" data-filter="${k}">${l}</button>`).join("")}
        </div>
        <div id="alert-list">
          ${filter === "ok"
            ? all.filter((x) => x.alerts.length === 0).map(({ user }) => `
              <div class="alert-item alert-ok"><span>🟢</span>
                <div style="flex:1"><strong>${UI.esc(user.name)}</strong> — situation conforme.</div>
                <button class="btn btn-sm" data-planning="${UI.esc(user.username)}">Voir le planning</button></div>`).join("")
              || '<p class="muted">Aucun collaborateur conforme.</p>'
            : shown.map((a) => `
              <div class="alert-item alert-${a.level}">
                <span>${{ critical: "🔴", warning: "🟠", info: "🔵" }[a.level]}</span>
                <div style="flex:1"><strong>${UI.esc(a.user.name)}</strong><br><span class="muted">${UI.esc(a.message)}</span></div>
                <button class="btn btn-sm" data-planning="${UI.esc(a.user.username)}">Voir le planning</button>
              </div>`).join("") || '<p class="muted">Aucune alerte dans cette catégorie. 👍</p>'}
        </div>`;
      container.querySelectorAll("[data-filter]").forEach((b) =>
        b.addEventListener("click", () => { filter = b.dataset.filter; render(); }));
      container.querySelectorAll("[data-planning]").forEach((b) =>
        b.addEventListener("click", () => App.navigate("modif-planning", { username: b.dataset.planning })));
    };
    render();
  },

  // ==========================================================================
  // Modifier le planning d'un collaborateur
  // ==========================================================================
  async modifPlanning(container, params = {}) {
    const users = App.usersList();
    if (!users.length) { container.innerHTML = '<p class="muted">Aucun collaborateur.</p>'; return; }
    let selected = params.username || users[0].username;
    const cfg = App.state.periodConfig;
    const months = periodMonths(cfg);

    container.innerHTML = `
      <div class="card no-print">
        <div class="form-grid">
          <div class="field"><label>Collaborateur</label>
            <select class="select" id="mp-user">
              ${users.map((u) => `<option value="${UI.esc(u.username)}" ${u.username === selected ? "selected" : ""}>${UI.esc(u.name)}</option>`).join("")}
            </select></div>
          <div class="field"><label>Actions</label>
            <div class="btn-row">
              <button class="btn btn-secondary" id="mp-apply-template">Appliquer le planning type</button>
            </div></div>
        </div>
        <h3>Duplication de mois</h3>
        <p class="muted">Copie un mois vers un autre en alignant par occurrence du jour de semaine
        (1er lundi → 1er lundi…). Les jours protégés (absence validée, férié fermé) ne sont jamais écrasés.</p>
        <div class="btn-row">
          <select class="select" id="dup-src" style="width:auto">${months.map((m) => `<option value="${m.key}">${m.label}</option>`).join("")}</select>
          <span>→</span>
          <select class="select" id="dup-tgt" style="width:auto">${months.map((m) => `<option value="${m.key}">${m.label}</option>`).join("")}</select>
          <button class="btn btn-primary" id="dup-apply">Dupliquer</button>
        </div>
      </div>
      <div id="mp-editor"></div>`;

    let editor = null;
    const loadEditor = async () => {
      const editorDiv = container.querySelector("#mp-editor");
      editorDiv.innerHTML = UI.spinner();
      editorDiv.innerHTML = "";
      editor = await PagesEmployee.renderScheduleEditor(editorDiv, selected, { adminMode: true });
    };
    await loadEditor();

    container.querySelector("#mp-user").addEventListener("change", async (e) => {
      selected = e.target.value;
      await loadEditor();
    });

    container.querySelector("#mp-apply-template").addEventListener("click", () => {
      const user = App.state.users[selected];
      UI.confirm({
        title: "Appliquer le planning type",
        message: `Réécrire le planning de <strong>${UI.esc(user.name)}</strong> sur toute la période à partir de son planning type hebdomadaire (hors jours protégés) ?`,
        confirmLabel: "Appliquer",
        onConfirm: async () => {
          const days = applyWeeklyTemplate(editor.getDays(), user.typePlanning || {}, cfg);
          editor.setDays(days);
          await logAudit("planning-template", `Planning type appliqué au planning de ${user.name}`);
          UI.toast("Planning type appliqué.", "success");
        },
      });
    });

    container.querySelector("#dup-apply").addEventListener("click", async () => {
      const src = container.querySelector("#dup-src").value;
      const tgt = container.querySelector("#dup-tgt").value;
      if (src === tgt) { UI.toast("Choisissez deux mois différents.", "warning"); return; }
      const [sy, sm] = src.split("-").map(Number);
      const [ty, tm] = tgt.split("-").map(Number);
      const { days, copied, skipped } = duplicateMonth(editor.getDays(), sy, sm, ty, tm);
      editor.setDays(days);
      const user = App.state.users[selected];
      await logAudit("planning-duplicate", `Duplication ${monthLabel(sy, sm)} → ${monthLabel(ty, tm)} pour ${user.name} (${copied} jours copiés, ${skipped} protégés)`);
      UI.toast(`Mois dupliqué : ${copied} jour(s) copié(s)${skipped ? `, ${skipped} protégé(s) ignoré(s)` : ""}.`, "success");
    });
  },

  // ==========================================================================
  // Impression planning
  // ==========================================================================
  async impression(container) {
    const users = App.usersList();
    const months = periodMonths(App.state.periodConfig);
    container.innerHTML = `
      <div class="card">
        <h2>Impression / export du planning</h2>
        <div class="field"><label>Collaborateurs</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.3rem">
            ${users.map((u) => `<label class="checkbox-label"><input type="checkbox" class="pr-user" value="${UI.esc(u.username)}" checked> ${UI.esc(u.name)}</label>`).join("")}
          </div></div>
        <div class="form-grid">
          <div class="field"><label>Du mois</label>
            <select class="select" id="pr-from">${months.map((m, i) => `<option value="${i}">${m.label}</option>`).join("")}</select></div>
          <div class="field"><label>Au mois</label>
            <select class="select" id="pr-to">${months.map((m, i) => `<option value="${i}" ${i === months.length - 1 ? "selected" : ""}>${m.label}</option>`).join("")}</select></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="pr-print">🖨 Vue imprimable</button>
          <button class="btn btn-secondary" id="pr-pdf">📄 Export PDF</button>
        </div>
      </div>`;

    const gather = async () => {
      const selected = [...container.querySelectorAll(".pr-user:checked")].map((c) => c.value);
      if (!selected.length) { UI.toast("Sélectionnez au moins un collaborateur.", "warning"); return null; }
      const from = Number(container.querySelector("#pr-from").value);
      const to = Number(container.querySelector("#pr-to").value);
      if (to < from) { UI.toast("La plage de mois est invalide.", "warning"); return null; }
      const range = months.slice(from, to + 1);
      const data = [];
      for (const username of selected) {
        const user = App.state.users[username];
        const schedule = await App.getSchedule(username, { fresh: true });
        data.push({ user, days: schedule.days });
      }
      return { data, range };
    };

    container.querySelector("#pr-print").addEventListener("click", async () => {
      const g = await gather();
      if (!g) return;
      const html = `
        <html lang="fr"><head><meta charset="utf-8"><title>Planning</title><style>
          body{font-family:sans-serif;font-size:11px;margin:16px}
          h2{page-break-before:always}h2:first-of-type{page-break-before:avoid}
          table{border-collapse:collapse;width:100%;margin-bottom:12px}
          th,td{border:1px solid #999;padding:2px 5px;text-align:left}
          th{background:#eee}
        </style></head><body>
        <h1>Suivi Annualisation — Planning</h1>
        ${g.data.map(({ user, days }) => `
          <h2>${UI.esc(user.name)}${user.isCadre ? " (cadre)" : ""}</h2>
          ${g.range.map((m) => `
            <h3>${m.label} — total travaillé : ${fmtNum(computeMonthRealized(days, m.year, m.month))}${userUnit(user)}</h3>
            <table><tr><th>Jour</th><th>${user.isCadre ? "Journée" : "Heures"}</th><th>Type</th><th>Note</th></tr>
            ${monthDateKeys(m.year, m.month).map((k) => {
              const day = days[k] || { hours: 0, type: "repos", note: "" };
              return `<tr><td>${frDateLabel(k)}</td><td>${fmtNum(day.hours || 0)}</td><td>${UI.esc(day.type || "")}</td><td>${UI.esc(day.note || "")}</td></tr>`;
            }).join("")}</table>`).join("")}`).join("")}
        <script>window.print()<\/script></body></html>`;
      const w = window.open("", "_blank");
      if (!w) { UI.toast("Autorisez les fenêtres pop-up pour l'impression.", "warning"); return; }
      w.document.write(html);
      w.document.close();
    });

    container.querySelector("#pr-pdf").addEventListener("click", async () => {
      const g = await gather();
      if (!g) return;
      if (!window.jspdf) { UI.toast("Bibliothèque PDF non chargée.", "error"); return; }
      const doc = new window.jspdf.jsPDF();
      let first = true;
      for (const { user, days } of g.data) {
        for (const m of g.range) {
          if (!first) doc.addPage();
          first = false;
          doc.setFontSize(14);
          doc.text(`${user.name} — ${m.label}`, 14, 14);
          doc.setFontSize(9);
          let y = 24;
          for (const k of monthDateKeys(m.year, m.month)) {
            const day = days[k] || { hours: 0, type: "repos", note: "" };
            doc.text(`${frDateShort(k)}  ${String(fmtNum(day.hours || 0)).padStart(5)}${userUnit(user)}  ${day.type || ""}  ${day.note || ""}`.slice(0, 95), 14, y);
            y += 5;
            if (y > 285) { doc.addPage(); y = 14; }
          }
          doc.text(`Total travaillé : ${fmtNum(computeMonthRealized(days, m.year, m.month))}${userUnit(user)}`, 14, Math.min(y + 4, 290));
        }
      }
      doc.save(`planning-${todayKey()}.pdf`);
      UI.toast("PDF généré.", "success");
    });
  },

  // ==========================================================================
  // Gestion des demandes (absences + camionnette) — moteur générique
  // ==========================================================================
  _kbCtx: null,
  _kbInstalled: false,

  _installKeyboard() {
    if (PagesAdmin._kbInstalled) return;
    PagesAdmin._kbInstalled = true;
    document.addEventListener("keydown", (e) => {
      const ctx = PagesAdmin._kbCtx;
      if (!ctx || App.state.page !== ctx.pageId) return;
      const tag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      const k = e.key;
      if (["ArrowDown", "j"].includes(k)) { e.preventDefault(); ctx.move(1); }
      else if (["ArrowUp", "k"].includes(k)) { e.preventDefault(); ctx.move(-1); }
      else if (k === " ") { e.preventDefault(); ctx.toggle(); }
      else if (k.toLowerCase() === "a") { e.preventDefault(); ctx.approve(); }
      else if (k.toLowerCase() === "r") { e.preventDefault(); ctx.reject(); }
    });
  },

  async requestManager(container, kind) {
    const isAbsence = kind === "absence";
    const col = isAbsence ? "absenceRequests" : "vanRequests";
    const pageId = isAbsence ? "gestion-absences" : "gestion-camion";
    let filter = "pending";
    let activeIndex = 0;
    const checked = new Set();

    const load = async () => Object.values(await Store.list(col))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    let requests = await load();

    const FILTERS = [
      ["all", "Toutes"], ["pending", "En attente"], ["approved", "Approuvées"],
      ["waiting", "En cours"], ["rejected", "Refusées"], ["cancelled", "Annulées"], ["archived", "Archivées"],
    ];

    const visible = () => filter === "all"
      ? requests.filter((r) => r.status !== "archived")
      : requests.filter((r) => r.status === filter);

    // --- Actions métier -------------------------------------------------------
    const applyStatus = async (req, action) => {
      try {
        if (action === "approve") {
          if (isAbsence) {
            const schedule = await App.getSchedule(req.userId, { fresh: true });
            const { days, leftover } = applyAbsence(schedule.days, req, App.state.holidays);
            await App.saveSchedule(req.userId, days);
            if (leftover > 0) UI.toast(`${fmtNum(leftover)} h n'ont pas pu être déduites (planning insuffisant sur la plage).`, "warning", 6000);
          }
          await Store.update(col, req.id, { status: "approved", processedAt: Date.now() });
          await logAudit(`${kind}-approve`, `Demande ${isAbsence ? req.type : "camionnette"} de ${req.userName} (${req.dateLabel}) approuvée`);
          await sendEmail("requestResponse", {
            to_email: req.userEmail || MANAGER_EMAIL, user_name: req.userName,
            request_type: isAbsence ? req.type : "Emprunt camionnette",
            request_dates: req.dateLabel, decision: "APPROUVÉE",
          }, { silent: !req.userEmail || !emailConfigured() });
        } else if (action === "reject") {
          if (isAbsence && req.status === "approved") {
            // Retire l'absence déjà appliquée au planning.
            const schedule = await App.getSchedule(req.userId, { fresh: true });
            await App.saveSchedule(req.userId, removeAbsence(schedule.days, req.id));
          }
          await Store.update(col, req.id, { status: "rejected", previousStatus: req.status, processedAt: Date.now() });
          await logAudit(`${kind}-reject`, `Demande ${isAbsence ? req.type : "camionnette"} de ${req.userName} (${req.dateLabel}) refusée`);
          await sendEmail("requestResponse", {
            to_email: req.userEmail || MANAGER_EMAIL, user_name: req.userName,
            request_type: isAbsence ? req.type : "Emprunt camionnette",
            request_dates: req.dateLabel, decision: "REFUSÉE",
          }, { silent: !req.userEmail || !emailConfigured() });
        } else if (action === "waiting") {
          await Store.update(col, req.id, { status: "waiting", previousStatus: req.status });
          await logAudit(`${kind}-waiting`, `Demande de ${req.userName} (${req.dateLabel}) mise en attente`);
        } else if (action === "archive") {
          await Store.update(col, req.id, { status: "archived", previousStatus: req.status, archivedAt: Date.now() });
        } else if (action === "restore") {
          await Store.update(col, req.id, { status: req.previousStatus || "pending" });
        }
      } catch (e) {
        console.error(e);
        UI.toast(`Échec de l'action sur la demande de ${req.userName}.`, "error");
      }
    };

    const runAndRefresh = async (fn) => {
      await fn();
      requests = await load();
      checked.clear();
      render();
      App.refreshBadges();
    };

    // Traitement séquentiel (jamais en parallèle : écritures sur un même planning).
    const massAction = (action) => {
      const targets = visible().filter((r) => checked.has(r.id));
      if (!targets.length) { UI.toast("Cochez au moins une demande.", "warning"); return; }
      UI.confirm({
        title: action === "approve" ? "Valider la sélection" : "Refuser la sélection",
        message: `${targets.length} demande(s) seront ${action === "approve" ? "approuvées" : "refusées"}. Continuer ?`,
        confirmLabel: action === "approve" ? "Valider" : "Refuser", danger: action === "reject",
        onConfirm: () => runAndRefresh(async () => {
          for (const req of targets) await applyStatus(req, action);
          UI.toast(`${targets.length} demande(s) traitée(s).`, "success");
        }),
      });
    };

    // --- Rendu ------------------------------------------------------------------
    const render = () => {
      const rows = visible();
      activeIndex = Math.min(activeIndex, Math.max(0, rows.length - 1));
      container.innerHTML = `
        <div class="card">
          <h2>${isAbsence ? "Gestion des demandes d'absence" : "Gestion des demandes d'emprunt (camionnette)"}</h2>
          <div class="filters-row">
            ${FILTERS.map(([k, l]) => {
              const n = k === "all" ? requests.filter((r) => r.status !== "archived").length
                : requests.filter((r) => r.status === k).length;
              return `<button class="chip ${filter === k ? "active" : ""}" data-filter="${k}">${l} (${n})</button>`;
            }).join("")}
          </div>
          <div class="btn-row no-print" style="margin-bottom:.6rem">
            <button class="btn btn-primary btn-sm" id="mass-approve">✓ Valider la sélection</button>
            <button class="btn btn-danger btn-sm" id="mass-reject">✕ Refuser la sélection</button>
          </div>
          ${rows.length === 0 ? '<p class="muted">Aucune demande dans cette catégorie.</p>' : `
          <div class="table-wrap"><table class="data" id="req-table">
            <thead><tr><th></th><th>Collaborateur</th>
              ${isAbsence ? "<th>Type</th><th>Dates</th><th>Quantité</th>" : "<th>Période</th><th>Stationnement</th>"}
              <th>Commentaire</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>${rows.map((r, i) => `
              <tr class="${i === activeIndex ? "row-active" : ""}" data-row="${i}">
                <td><input type="checkbox" class="req-check" data-id="${r.id}" ${checked.has(r.id) ? "checked" : ""}></td>
                <td><strong>${UI.esc(r.userName)}</strong></td>
                ${isAbsence
                  ? `<td>${UI.typeBadge(r.type)}</td><td>${UI.esc(r.dateLabel)}</td><td>${UI.esc(r.qLabel || "")}</td>`
                  : `<td>${UI.esc(r.dateLabel)}</td><td>${UI.esc(r.parking || "—")}</td>`}
                <td>${UI.esc(r.comment || "—")}</td>
                <td>${UI.statusBadge(r.status)}</td>
                <td style="white-space:nowrap">
                  ${["pending", "waiting"].includes(r.status) ? `
                    <button class="btn btn-sm btn-primary" data-act="approve" data-id="${r.id}" title="Approuver">✓</button>
                    ${r.status === "pending" ? `<button class="btn btn-sm" data-act="waiting" data-id="${r.id}" title="Mettre en attente">⏸</button>` : ""}
                    <button class="btn btn-sm btn-danger" data-act="reject" data-id="${r.id}" title="Refuser">✕</button>` : ""}
                  ${r.status === "approved" ? `<button class="btn btn-sm btn-danger" data-act="reject" data-id="${r.id}" title="Annuler l'approbation (retire du planning)">✕</button>` : ""}
                  ${r.status !== "archived" ? `<button class="btn btn-sm" data-act="archive" data-id="${r.id}" title="Archiver">🗃</button>`
                    : `<button class="btn btn-sm" data-act="restore" data-id="${r.id}" title="Restaurer">↩</button>`}
                </td>
              </tr>`).join("")}</tbody>
          </table></div>
          ${UI.kbdHint(`Raccourcis : <kbd>↑</kbd>/<kbd>↓</kbd> ou <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>Espace</kbd> cocher · <kbd>A</kbd> approuver · <kbd>R</kbd> refuser la ligne active.`)}`}
        </div>`;

      container.querySelectorAll("[data-filter]").forEach((b) =>
        b.addEventListener("click", () => { filter = b.dataset.filter; activeIndex = 0; render(); }));
      container.querySelectorAll(".req-check").forEach((c) => c.addEventListener("change", () => {
        if (c.checked) checked.add(c.dataset.id); else checked.delete(c.dataset.id);
      }));
      container.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
        const req = requests.find((r) => r.id === b.dataset.id);
        runAndRefresh(() => applyStatus(req, b.dataset.act));
      }));
      container.querySelector("#mass-approve")?.addEventListener("click", () => massAction("approve"));
      container.querySelector("#mass-reject")?.addEventListener("click", () => massAction("reject"));
      container.querySelectorAll("[data-row]").forEach((tr) => tr.addEventListener("click", (e) => {
        if (e.target.closest("button, input")) return;
        activeIndex = Number(tr.dataset.row);
        highlight();
      }));
    };

    const highlight = () => {
      container.querySelectorAll("[data-row]").forEach((tr) =>
        tr.classList.toggle("row-active", Number(tr.dataset.row) === activeIndex));
      container.querySelector(`[data-row="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    };

    // Contexte raccourcis clavier de la page courante.
    PagesAdmin._kbCtx = {
      pageId,
      move(delta) {
        const n = visible().length;
        if (!n) return;
        activeIndex = Math.min(n - 1, Math.max(0, activeIndex + delta));
        highlight();
      },
      toggle() {
        const r = visible()[activeIndex];
        if (!r) return;
        if (checked.has(r.id)) checked.delete(r.id); else checked.add(r.id);
        render();
      },
      approve() {
        const r = visible()[activeIndex];
        if (!r || !["pending", "waiting"].includes(r.status)) return;
        runAndRefresh(() => applyStatus(r, "approve"));
      },
      reject() {
        const r = visible()[activeIndex];
        if (!r || !["pending", "waiting", "approved"].includes(r.status)) return;
        runAndRefresh(() => applyStatus(r, "reject"));
      },
    };
    PagesAdmin._installKeyboard();
    render();
  },

  // ==========================================================================
  // Mes absences (admin, suivi simplifié matin / après-midi / journée)
  // ==========================================================================
  async mesAbsencesAdmin(container) {
    const doc = (await Store.get("settings", "managerAbsences")) || { list: {} };
    const list = doc.list || {};
    const now = new Date();
    let year = now.getFullYear(), month = now.getMonth() + 1;
    const CYCLE = [null, "Matin", "Après-midi", "Journée"];

    const render = () => {
      const first = new Date(year, month - 1, 1);
      const offset = (first.getDay() + 6) % 7; // lundi = 0
      container.innerHTML = `
        <div class="card">
          <h2>Mes absences (responsable)</h2>
          <p class="muted">Cliquez sur un jour pour alterner : rien → matin → après-midi → journée.</p>
          <div class="btn-row" style="margin-bottom:.7rem">
            <button class="btn btn-sm" id="ma-prev">←</button>
            <strong>${monthLabel(year, month)}</strong>
            <button class="btn btn-sm" id="ma-next">→</button>
          </div>
          <div class="mini-cal">
            ${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => `<div class="mc-head">${d}</div>`).join("")}
            ${Array(offset).fill('<button class="mc-day mc-empty"></button>').join("")}
            ${monthDateKeys(year, month).map((k) => `
              <button class="mc-day" data-key="${k}">${parseKey(k).getDate()}
                ${list[k] ? `<span class="mc-mark">${UI.esc(list[k])}</span>` : ""}</button>`).join("")}
          </div>
        </div>`;
      container.querySelector("#ma-prev").addEventListener("click", () => {
        month--; if (month < 1) { month = 12; year--; } render();
      });
      container.querySelector("#ma-next").addEventListener("click", () => {
        month++; if (month > 12) { month = 1; year++; } render();
      });
      container.querySelectorAll(".mc-day:not(.mc-empty)").forEach((b) => b.addEventListener("click", async () => {
        const k = b.dataset.key;
        const next = CYCLE[(CYCLE.indexOf(list[k] || null) + 1) % CYCLE.length];
        if (next) list[k] = next; else delete list[k];
        await Store.set("settings", "managerAbsences", { list });
        render();
      }));
    };
    render();
  },

  // ==========================================================================
  // Gestion équipe (CRUD collaborateurs)
  // ==========================================================================
  async gestionEquipe(container) {
    const users = App.usersList();
    container.innerHTML = `
      <div class="card">
        <div class="btn-row" style="justify-content:space-between">
          <h2 style="margin:0">Gestion de l'équipe</h2>
          <button class="btn btn-primary" id="user-new">＋ Nouveau collaborateur</button>
        </div>
        <div class="table-wrap" style="margin-top:.8rem"><table class="data">
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Statut</th><th>Cible</th><th>CP</th><th>CP anc.</th><th>Actions</th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td><strong>${UI.esc(u.name)}</strong><br><span class="muted">${UI.esc(u.email || "")}</span></td>
              <td>${UI.esc(u.username)}${u.matricule ? `<br><span class="muted">${UI.esc(u.matricule)}</span>` : ""}</td>
              <td>${u.role === "admin" ? '<span class="day-badge" style="background:var(--orange)">Admin</span>' : "Collaborateur"}</td>
              <td>${u.isCadre ? '<span class="day-badge type-cpanc">Cadre</span>' : "Non-cadre"}</td>
              <td>${u.isCadre ? `${u.daysTarget || DEFAULT_DAYS_TARGET} j` : `${u.hoursTarget || DEFAULT_HOURS_TARGET} h`}</td>
              <td>${u.cpDays ?? DEFAULT_CP_DAYS}</td>
              <td>${u.cpAnciennete || 0}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm" data-edit="${UI.esc(u.username)}">✏️</button>
                ${u.username !== App.state.currentUser.username
                  ? `<button class="btn btn-sm btn-danger" data-del="${UI.esc(u.username)}">🗑</button>` : ""}
              </td>
            </tr>`).join("")}</tbody>
        </table></div>
      </div>`;

    container.querySelector("#user-new").addEventListener("click", () => PagesAdmin.userForm(null));
    container.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => PagesAdmin.userForm(App.state.users[b.dataset.edit])));
    container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const u = App.state.users[b.dataset.del];
      UI.confirmTyped({
        title: "Supprimer le collaborateur",
        message: `La fiche et le planning de <strong>${UI.esc(u.name)}</strong> seront définitivement supprimés.
          ${Store.backend === "firebase" ? "Le compte de connexion Firebase devra être supprimé séparément dans la console Firebase Authentication." : ""}`,
        word: "SUPPRIMER", confirmLabel: "Supprimer",
        onConfirm: async () => {
          await Store.remove("users", u.username);
          await Store.remove("schedules", u.username);
          App.clearScheduleCache(u.username);
          await logAudit("user-delete", `Fiche et planning de ${u.name} (${u.username}) supprimés`);
          await App.reloadUsers();
          UI.toast("Collaborateur supprimé.", "success");
          App.navigate("gestion-equipe");
        },
      });
    }));
  },

  userForm(existing) {
    const u = existing || {
      name: "", username: "", role: "employee", email: "", matricule: "",
      isCadre: false, hoursTarget: DEFAULT_HOURS_TARGET, daysTarget: DEFAULT_DAYS_TARGET,
      cpDays: DEFAULT_CP_DAYS, cpAnciennete: 0,
      typePlanning: { lundi: 7, mardi: 7, mercredi: 7, jeudi: 7, vendredi: 7, samedi: 0, dimanche: 0 },
    };
    const isNew = !existing;
    const daysOrder = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
    const others = App.usersList().filter((x) => x.username !== u.username);

    UI.modal({
      title: isNew ? "Nouveau collaborateur" : `Modifier — ${u.name}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field"><label>Nom complet *</label><input class="input" id="uf-name" value="${UI.esc(u.name)}"></div>
          <div class="field"><label>Identifiant *</label><input class="input" id="uf-username" value="${UI.esc(u.username)}" ${isNew ? "" : "disabled"}></div>
          <div class="field"><label>${isNew ? "Mot de passe * (min. 6 caractères)" : "Nouveau mot de passe (optionnel)"}</label>
            <input class="input" id="uf-password" type="password" autocomplete="new-password"></div>
          <div class="field"><label>Rôle</label>
            <select class="select" id="uf-role">
              <option value="employee" ${u.role !== "admin" ? "selected" : ""}>Collaborateur</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrateur</option>
            </select></div>
          <div class="field"><label>E-mail</label><input class="input" id="uf-email" type="email" value="${UI.esc(u.email || "")}"></div>
          <div class="field"><label>Matricule</label><input class="input" id="uf-matricule" value="${UI.esc(u.matricule || "")}"></div>
          <div class="field"><label>Statut</label>
            <label class="checkbox-label"><input type="checkbox" id="uf-cadre" ${u.isCadre ? "checked" : ""}> Cadre au forfait jours</label></div>
          <div class="field"><label>Cible heures/an (non-cadre)</label><input class="input" id="uf-hours" type="number" min="0" value="${u.hoursTarget || DEFAULT_HOURS_TARGET}"></div>
          <div class="field"><label>Cible jours/an (cadre)</label><input class="input" id="uf-days" type="number" min="0" value="${u.daysTarget || DEFAULT_DAYS_TARGET}"></div>
          <div class="field"><label>CP dus / an</label><input class="input" id="uf-cp" type="number" min="0" value="${u.cpDays ?? DEFAULT_CP_DAYS}"></div>
          <div class="field"><label>CP ancienneté</label><input class="input" id="uf-cpanc" type="number" min="0" value="${u.cpAnciennete || 0}"></div>
        </div>
        <h4 style="margin:.6rem 0 .4rem">Planning type hebdomadaire (heures ou journées/jour)</h4>
        ${others.length ? `<div class="field"><label>Copier depuis un collaborateur existant</label>
          <select class="select" id="uf-copy-from"><option value="">— Ne pas copier —</option>
            ${others.map((o) => `<option value="${UI.esc(o.username)}">${UI.esc(o.name)}</option>`).join("")}
          </select></div>` : ""}
        <div class="form-grid">
          ${daysOrder.map((d) => `<div class="field"><label>${d}</label>
            <input class="input uf-tp" data-day="${d}" type="number" min="0" step="0.5" value="${Number(u.typePlanning?.[d]) || 0}"></div>`).join("")}
        </div>
        ${Store.backend === "firebase" && !isNew ? `<p class="muted">⚠ En mode Firebase, le changement de mot de passe d'un autre compte s'effectue dans la console Firebase Authentication.</p>` : ""}`,
      actions: [
        { label: "Annuler", className: "btn", onClick: (close) => close() },
        {
          label: isNew ? "Créer" : "Enregistrer", className: "btn btn-primary",
          onClick: async (close) => {
            const name = document.getElementById("uf-name").value.trim();
            const username = document.getElementById("uf-username").value.trim().toLowerCase();
            const password = document.getElementById("uf-password").value;
            if (!name || !username) { UI.toast("Nom et identifiant sont obligatoires.", "warning"); return; }
            if (isNew && password.length < 6) { UI.toast("Mot de passe : 6 caractères minimum.", "warning"); return; }
            if (isNew && App.state.users[username]) { UI.toast("Cet identifiant existe déjà.", "warning"); return; }
            const typePlanning = {};
            document.querySelectorAll(".uf-tp").forEach((i) => { typePlanning[i.dataset.day] = Math.max(0, Number(i.value) || 0); });
            const doc = {
              id: username, name, username,
              role: document.getElementById("uf-role").value,
              email: document.getElementById("uf-email").value.trim(),
              matricule: document.getElementById("uf-matricule").value.trim(),
              isCadre: document.getElementById("uf-cadre").checked,
              hoursTarget: Number(document.getElementById("uf-hours").value) || DEFAULT_HOURS_TARGET,
              daysTarget: Number(document.getElementById("uf-days").value) || DEFAULT_DAYS_TARGET,
              cpDays: Number(document.getElementById("uf-cp").value) || 0,
              cpAnciennete: Number(document.getElementById("uf-cpanc").value) || 0,
              typePlanning,
            };
            try {
              if (isNew) {
                await Store.createAccount(username, password);
                await Store.set("users", username, doc, true);
                await logAudit("user-create", `Collaborateur ${name} (${username}) créé`);
              } else {
                await Store.set("users", username, doc, true);
                if (password) {
                  try {
                    await Store.changePassword(username, password);
                    UI.toast("Mot de passe mis à jour.", "success");
                  } catch (e) { UI.toast(e.message, "warning", 7000); }
                }
                await logAudit("user-update", `Fiche de ${name} (${username}) modifiée`);
              }
              await App.reloadUsers();
              UI.toast(isNew ? "Collaborateur créé." : "Fiche enregistrée.", "success");
              close();
              App.navigate("gestion-equipe");
            } catch (e) {
              console.error(e);
              UI.toast(`Échec : ${e.message}`, "error", 6000);
            }
          },
        },
      ],
    });

    document.getElementById("uf-copy-from")?.addEventListener("change", (e) => {
      const src = App.state.users[e.target.value];
      if (!src) return;
      document.querySelectorAll(".uf-tp").forEach((i) => {
        i.value = Number(src.typePlanning?.[i.dataset.day]) || 0;
      });
      UI.toast(`Planning type copié depuis ${src.name}.`, "info");
    });
  },

  // ==========================================================================
  // Fériés & dimanches ouverts
  // ==========================================================================
  async feries(container) {
    const holidays = App.state.holidays;
    const sundays = App.state.openSundays;

    const saveHolidays = async () => {
      await Store.set("settings", "holidays", { list: holidays });
      App.state.holidays = holidays;
    };

    const render = () => {
      const hKeys = Object.keys(holidays).sort();
      const sKeys = Object.keys(sundays).sort();
      container.innerHTML = `
        <div class="grid grid-2">
          <div class="card">
            <h2>Jours fériés</h2>
            <div class="form-grid">
              <div class="field"><label>Date</label><input class="input" id="h-date" type="date"></div>
              <div class="field"><label>Nom</label><input class="input" id="h-name" placeholder="Ex. : 14 Juillet"></div>
              <div class="field"><label>&nbsp;</label>
                <label class="checkbox-label"><input type="checkbox" id="h-open"> Magasin ouvert ce jour</label></div>
            </div>
            <button class="btn btn-primary" id="h-add">Ajouter le férié</button>
            <div class="table-wrap" style="margin-top:.8rem"><table class="data">
              <thead><tr><th>Date</th><th>Nom</th><th>Magasin</th><th>Plannings</th><th></th></tr></thead>
              <tbody>${hKeys.map((k) => `
                <tr><td>${frDateShort(k)}</td><td>${UI.esc(holidays[k].name)}</td>
                  <td><button class="btn btn-sm" data-toggle-open="${k}">${holidays[k].open ? "🟢 Ouvert" : "🔴 Fermé"}</button></td>
                  <td>${holidays[k].open ? "—" : `
                    <button class="btn btn-sm btn-secondary" data-apply="${k}" title="Fermer ce jour sur le planning de tous les collaborateurs">Appliquer fermeture</button>
                    <button class="btn btn-sm" data-unapply="${k}" title="Retirer la fermeture des plannings">Retirer</button>`}</td>
                  <td><button class="btn btn-sm btn-danger" data-del-h="${k}">🗑</button></td>
                </tr>`).join("") || '<tr><td colspan="5" class="muted">Aucun férié enregistré.</td></tr>'}</tbody>
            </table></div>
          </div>

          <div class="card">
            <h2>Dimanches exceptionnellement ouverts</h2>
            <div class="form-grid">
              <div class="field"><label>Date (un dimanche)</label><input class="input" id="s-date" type="date"></div>
              <div class="field"><label>Note</label><input class="input" id="s-note" placeholder="Ex. : dimanche avant Noël"></div>
            </div>
            <button class="btn btn-primary" id="s-add">Ajouter le dimanche ouvert</button>
            <div class="table-wrap" style="margin-top:.8rem"><table class="data">
              <thead><tr><th>Date</th><th>Note</th><th></th></tr></thead>
              <tbody>${sKeys.map((k) => `
                <tr><td>${frDateShort(k)}</td><td>${UI.esc(sundays[k].note || "")}</td>
                  <td><button class="btn btn-sm btn-danger" data-del-s="${k}">🗑</button></td></tr>`).join("")
                || '<tr><td colspan="3" class="muted">Aucun dimanche ouvert enregistré.</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>`;

      container.querySelector("#h-add").addEventListener("click", async () => {
        const date = container.querySelector("#h-date").value;
        const name = container.querySelector("#h-name").value.trim();
        if (!date || !name) { UI.toast("Date et nom obligatoires.", "warning"); return; }
        holidays[date] = { name, open: container.querySelector("#h-open").checked };
        await saveHolidays();
        await logAudit("holiday-add", `Férié ajouté : ${name} (${frDateShort(date)})`);
        UI.toast("Férié ajouté.", "success");
        render();
      });
      container.querySelectorAll("[data-toggle-open]").forEach((b) => b.addEventListener("click", async () => {
        const k = b.dataset.toggleOpen;
        holidays[k].open = !holidays[k].open;
        await saveHolidays();
        render();
      }));
      container.querySelectorAll("[data-del-h]").forEach((b) => b.addEventListener("click", async () => {
        const k = b.dataset.delH;
        await logAudit("holiday-delete", `Férié supprimé : ${holidays[k].name} (${frDateShort(k)})`);
        delete holidays[k];
        await saveHolidays();
        UI.toast("Férié supprimé.", "success");
        render();
      }));

      // Application / retrait de la fermeture sur tous les plannings.
      container.querySelectorAll("[data-apply]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.apply;
        UI.confirm({
          title: "Appliquer la fermeture",
          message: `Le ${frDateShort(k)} (${UI.esc(holidays[k].name)}) sera marqué « férié fermé, 0 h » sur le planning de <strong>tous</strong> les collaborateurs (les jours en absence validée sont ignorés).`,
          confirmLabel: "Appliquer",
          onConfirm: async () => {
            let n = 0;
            for (const u of App.usersList()) {
              const schedule = await App.getSchedule(u.username, { fresh: true });
              const day = schedule.days[k];
              if (day?.absenceId) continue;
              schedule.days[k] = {
                hours: 0, type: "repos", note: holidays[k].name, holidayClosed: true,
                prevHours: Number(day?.hours) || 0, prevType: day?.type || "normal",
              };
              await App.saveSchedule(u.username, schedule.days);
              n++;
            }
            await logAudit("holiday-apply", `Fermeture du ${frDateShort(k)} appliquée à ${n} planning(s)`);
            UI.toast(`Fermeture appliquée à ${n} planning(s).`, "success");
          },
        });
      }));
      container.querySelectorAll("[data-unapply]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.unapply;
        UI.confirm({
          title: "Retirer la fermeture",
          message: `Le marquage « férié fermé » du ${frDateShort(k)} sera retiré des plannings, en restaurant les heures antérieures.`,
          confirmLabel: "Retirer",
          onConfirm: async () => {
            let n = 0;
            for (const u of App.usersList()) {
              const schedule = await App.getSchedule(u.username, { fresh: true });
              const day = schedule.days[k];
              if (!day?.holidayClosed) continue;
              schedule.days[k] = { hours: day.prevHours ?? 0, type: day.prevType || "normal", note: "" };
              await App.saveSchedule(u.username, schedule.days);
              n++;
            }
            await logAudit("holiday-unapply", `Fermeture du ${frDateShort(k)} retirée de ${n} planning(s)`);
            UI.toast(`Fermeture retirée de ${n} planning(s).`, "success");
          },
        });
      }));

      container.querySelector("#s-add").addEventListener("click", async () => {
        const date = container.querySelector("#s-date").value;
        if (!date) { UI.toast("Sélectionnez une date.", "warning"); return; }
        if (parseKey(date).getDay() !== 0) { UI.toast("Cette date n'est pas un dimanche.", "warning"); return; }
        sundays[date] = { note: container.querySelector("#s-note").value.trim() };
        await Store.set("settings", "openSundays", { list: sundays });
        App.state.openSundays = sundays;
        await logAudit("sunday-add", `Dimanche ouvert ajouté : ${frDateShort(date)}`);
        UI.toast("Dimanche ouvert ajouté.", "success");
        render();
      });
      container.querySelectorAll("[data-del-s]").forEach((b) => b.addEventListener("click", async () => {
        delete sundays[b.dataset.delS];
        await Store.set("settings", "openSundays", { list: sundays });
        App.state.openSundays = sundays;
        UI.toast("Dimanche ouvert supprimé.", "success");
        render();
      }));
    };
    render();
  },

  // ==========================================================================
  // Blocage des mois
  // ==========================================================================
  async blocageMois(container) {
    const months = periodMonths(App.state.periodConfig);
    const locked = { ...App.state.lockedMonths };

    const render = () => {
      container.innerHTML = `
        <div class="card">
          <h2>Blocage des mois</h2>
          <p class="muted">Un mois verrouillé passe en lecture seule pour tous les collaborateurs
          (les admins peuvent toujours le modifier depuis « Modifier un Planning »).</p>
          <div class="month-lock-grid" style="margin-top:.8rem">
            ${months.map((m) => `
              <button class="btn ${locked[m.key] ? "btn-danger" : ""}" data-lock="${m.key}">
                ${locked[m.key] ? "🔒" : "🔓"} ${m.label}</button>`).join("")}
          </div>
        </div>`;
      container.querySelectorAll("[data-lock]").forEach((b) => b.addEventListener("click", async () => {
        const k = b.dataset.lock;
        if (locked[k]) delete locked[k]; else locked[k] = true;
        await Store.set("settings", "lockedMonths", { list: locked });
        App.state.lockedMonths = locked;
        await logAudit("month-lock", `Mois ${k} ${locked[k] ? "verrouillé" : "déverrouillé"}`);
        UI.toast(`Mois ${locked[k] ? "verrouillé" : "déverrouillé"}.`, "success");
        render();
      }));
    };
    render();
  },

  // ==========================================================================
  // Configuration de la période annuelle
  // ==========================================================================
  async configPeriode(container) {
    const cfg = App.state.periodConfig;
    const thisYear = new Date().getFullYear();
    container.innerHTML = `
      <div class="card">
        <h2>Configuration de la période annuelle</h2>
        <p class="muted">La période court sur 12 mois à partir du mois choisi. Modifier la période
        régénère les onglets du calendrier sans supprimer les données saisies.</p>
        <div class="form-grid" style="margin-top:.8rem">
          <div class="field"><label>Mois de début</label>
            <select class="select" id="pc-month">
              ${MONTH_NAMES_FR.map((n, i) => `<option value="${i + 1}" ${cfg.startMonth === i + 1 ? "selected" : ""}>${n}</option>`).join("")}
            </select></div>
          <div class="field"><label>Année de début</label>
            <select class="select" id="pc-year">
              ${[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) =>
                `<option ${cfg.startYear === y ? "selected" : ""}>${y}</option>`).join("")}
            </select></div>
        </div>
        <p class="muted" id="pc-preview"></p>
        <button class="btn btn-primary" id="pc-save">Enregistrer la période</button>
      </div>`;

    const preview = () => {
      const c = {
        startMonth: Number(container.querySelector("#pc-month").value),
        startYear: Number(container.querySelector("#pc-year").value),
      };
      const { start, end } = periodBounds(c);
      container.querySelector("#pc-preview").textContent =
        `Période : ${frDateShort(dateKey(start))} → ${frDateShort(dateKey(end))}.`;
      return c;
    };
    preview();
    ["#pc-month", "#pc-year"].forEach((s) => container.querySelector(s).addEventListener("change", preview));
    container.querySelector("#pc-save").addEventListener("click", async () => {
      const c = preview();
      await Store.set("settings", "periodConfig", c);
      App.state.periodConfig = c;
      App.clearScheduleCache();
      await logAudit("period-config", `Période configurée : ${monthLabel(c.startYear, c.startMonth)} → 12 mois`);
      UI.toast("Période enregistrée.", "success");
    });
  },

  // ==========================================================================
  // Annonces
  // ==========================================================================
  async annonces(container) {
    const all = Object.values(await Store.list("announcements"))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const totalUsers = App.usersList().length;

    container.innerHTML = `
      <div class="card">
        <h2>Nouvelle annonce</h2>
        <div class="field"><label>Titre</label><input class="input" id="an-title" maxlength="120"></div>
        <div class="field"><label>Message (1000 caractères max)</label>
          <textarea class="input" id="an-message" rows="4" maxlength="1000"></textarea></div>
        <button class="btn btn-primary" id="an-create">Publier l'annonce</button>
        <p class="muted">L'annonce s'affiche en popup à la connexion de chaque collaborateur, jusqu'à acquittement.</p>
      </div>
      <div class="card">
        <h3>Annonces existantes</h3>
        ${all.length === 0 ? '<p class="muted">Aucune annonce.</p>' : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Titre</th><th>Créée le</th><th>Acquittements</th><th>Statut</th><th></th></tr></thead>
          <tbody>${all.map((a) => {
            const acks = Object.keys(a.acknowledgedBy || {}).length;
            return `<tr>
              <td><strong>${UI.esc(a.title)}</strong><br><span class="muted">${UI.esc((a.message || "").slice(0, 80))}${(a.message || "").length > 80 ? "…" : ""}</span></td>
              <td>${new Date(a.createdAt).toLocaleDateString("fr-FR")}</td>
              <td>${acks}/${totalUsers}</td>
              <td><button class="btn btn-sm" data-toggle="${a.id}">${a.active ? "🟢 Active" : "⚪ Inactive"}</button></td>
              <td><button class="btn btn-sm btn-danger" data-del="${a.id}">🗑</button></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>`}
      </div>`;

    container.querySelector("#an-create").addEventListener("click", async () => {
      const title = container.querySelector("#an-title").value.trim();
      const message = container.querySelector("#an-message").value.trim();
      if (!title || !message) { UI.toast("Titre et message obligatoires.", "warning"); return; }
      const id = genId("ann");
      await Store.set("announcements", id, {
        id, title, message, active: true, createdAt: Date.now(), acknowledgedBy: {},
      });
      await logAudit("announcement-create", `Annonce publiée : ${title}`);
      UI.toast("Annonce publiée.", "success");
      App.navigate("annonces");
    });
    container.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const a = all.find((x) => x.id === b.dataset.toggle);
      await Store.update("announcements", a.id, { active: !a.active });
      App.navigate("annonces");
    }));
    container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      UI.confirm({
        title: "Supprimer l'annonce", message: "Supprimer définitivement cette annonce ?",
        confirmLabel: "Supprimer", danger: true,
        onConfirm: async () => {
          await Store.remove("announcements", b.dataset.del);
          UI.toast("Annonce supprimée.", "success");
          App.navigate("annonces");
        },
      });
    }));
  },

  // ==========================================================================
  // Historique (journal d'audit)
  // ==========================================================================
  async historique(container) {
    const all = Object.values(await Store.list("auditLog"))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 300);
    let query = "";

    const render = () => {
      const shown = query
        ? all.filter((e) => `${e.action} ${e.message} ${e.actor}`.toLowerCase().includes(query))
        : all;
      container.innerHTML = `
        <div class="card">
          <h2>Historique des modifications</h2>
          <div class="field"><input class="input" id="hist-search" placeholder="Filtrer… (action, collaborateur, texte)" value="${UI.esc(query)}"></div>
          ${shown.length === 0 ? '<p class="muted">Aucune entrée.</p>' : `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Détail</th></tr></thead>
            <tbody>${shown.map((e) => `
              <tr><td style="white-space:nowrap">${new Date(e.timestamp).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>${UI.esc(e.actor)}</td><td><code>${UI.esc(e.action)}</code></td><td>${UI.esc(e.message)}</td></tr>`).join("")}</tbody>
          </table></div>`}
        </div>`;
      const inp = container.querySelector("#hist-search");
      inp.addEventListener("input", () => { query = inp.value.toLowerCase(); render(); });
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    };
    render();
  },

  // ==========================================================================
  // Sauvegardes (snapshots)
  // ==========================================================================
  async createSnapshot(auto = false) {
    const schedules = await Store.list("schedules");
    const id = genId("snap");
    await Store.set("snapshots", id, {
      id, createdAt: Date.now(), auto,
      userCount: Object.keys(schedules).length,
      data: JSON.stringify(schedules),
    });
    await logAudit("snapshot-create", `Sauvegarde ${auto ? "automatique" : "manuelle"} créée (${Object.keys(schedules).length} plannings)`);
    return id;
  },

  async maybeAutoSnapshot() {
    const all = Object.values(await Store.list("snapshots"));
    const latest = Math.max(0, ...all.map((s) => s.createdAt || 0));
    if (Date.now() - latest > 24 * 60 * 60 * 1000) {
      await PagesAdmin.createSnapshot(true);
      UI.toast("Sauvegarde quotidienne automatique effectuée.", "info");
    }
  },

  async sauvegardes(container) {
    const all = Object.values(await Store.list("snapshots"))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
      <div class="card">
        <div class="btn-row" style="justify-content:space-between">
          <h2 style="margin:0">Sauvegardes des plannings</h2>
          <div class="btn-row">
            <button class="btn" id="snap-purge">🧹 Purger les anciennes</button>
            <button class="btn btn-primary" id="snap-create">💾 Sauvegarder maintenant</button>
          </div>
        </div>
        <p class="muted">Une sauvegarde automatique est réalisée au maximum une fois par 24 h à la connexion d'un admin.
        La purge conserve les ${SNAPSHOT_KEEP_COUNT} sauvegardes les plus récentes.</p>
        ${all.length === 0 ? '<p class="muted">Aucune sauvegarde.</p>' : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Type</th><th>Plannings couverts</th><th>Actions</th></tr></thead>
          <tbody>${all.map((s) => `
            <tr>
              <td>${new Date(s.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
              <td>${s.auto ? "Automatique" : "Manuelle"}</td>
              <td>${s.userCount}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm" data-dl="${s.id}">⬇ Télécharger</button>
                <button class="btn btn-sm btn-danger" data-restore="${s.id}">↩ Restaurer</button>
                <button class="btn btn-sm" data-del="${s.id}">🗑</button>
              </td>
            </tr>`).join("")}</tbody>
        </table></div>`}
      </div>`;

    container.querySelector("#snap-create").addEventListener("click", async () => {
      await PagesAdmin.createSnapshot(false);
      UI.toast("Sauvegarde créée.", "success");
      App.navigate("sauvegardes");
    });
    container.querySelector("#snap-purge").addEventListener("click", () => {
      const toDelete = all.slice(SNAPSHOT_KEEP_COUNT);
      if (!toDelete.length) { UI.toast(`Rien à purger (moins de ${SNAPSHOT_KEEP_COUNT} sauvegardes).`, "info"); return; }
      UI.confirm({
        title: "Purger les sauvegardes",
        message: `${toDelete.length} sauvegarde(s) ancienne(s) seront supprimées définitivement.`,
        confirmLabel: "Purger", danger: true,
        onConfirm: async () => {
          for (const s of toDelete) await Store.remove("snapshots", s.id);
          await logAudit("snapshot-purge", `${toDelete.length} sauvegarde(s) purgée(s)`);
          UI.toast("Purge effectuée.", "success");
          App.navigate("sauvegardes");
        },
      });
    });
    container.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => {
      const s = all.find((x) => x.id === b.dataset.dl);
      const blob = new Blob([s.data], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sauvegarde-plannings-${new Date(s.createdAt).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }));
    container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      UI.confirm({
        title: "Supprimer la sauvegarde", message: "Supprimer définitivement cette sauvegarde ?",
        confirmLabel: "Supprimer", danger: true,
        onConfirm: async () => {
          await Store.remove("snapshots", b.dataset.del);
          UI.toast("Sauvegarde supprimée.", "success");
          App.navigate("sauvegardes");
        },
      });
    }));
    container.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => {
      const s = all.find((x) => x.id === b.dataset.restore);
      UI.confirmTyped({
        title: "Restaurer la sauvegarde",
        message: `⚠ Les plannings actuels de <strong>tous</strong> les collaborateurs seront remplacés par ceux de la
          sauvegarde du ${new Date(s.createdAt).toLocaleString("fr-FR")}. Cette action est irréversible
          (pensez à créer une sauvegarde de l'état actuel avant).`,
        word: "RESTAURER", confirmLabel: "Restaurer",
        onConfirm: async () => {
          await logAudit("snapshot-restore", `Restauration de la sauvegarde du ${new Date(s.createdAt).toLocaleString("fr-FR")}`);
          const schedules = JSON.parse(s.data);
          for (const [username, schedule] of Object.entries(schedules)) {
            await Store.set("schedules", username, schedule);
          }
          App.clearScheduleCache();
          UI.toast("Sauvegarde restaurée.", "success");
        },
      });
    }));
  },

  // ==========================================================================
  // ALL RESET (réinitialisation totale)
  // ==========================================================================
  async allReset(container) {
    container.innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <h2 style="color:var(--danger)">⚠️ ALL RESET — Réinitialisation totale</h2>
        <p>Cette action supprime définitivement :</p>
        <ul style="margin:.5rem 0 .8rem 1.3rem">
          <li>tous les <strong>plannings</strong> de tous les collaborateurs ;</li>
          <li>toutes les <strong>demandes d'absence</strong> et <strong>d'emprunt</strong> ;</li>
          <li>toutes les <strong>annonces</strong>.</li>
        </ul>
        <p class="muted">Les fiches collaborateurs, les réglages (fériés, période…), les sauvegardes, les documents
        et l'historique sont conservés. L'action est journalisée avant exécution.</p>
        <button class="btn btn-danger" id="reset-start" style="margin-top:.6rem">Lancer la réinitialisation…</button>
      </div>`;

    container.querySelector("#reset-start").addEventListener("click", () => {
      UI.confirmTyped({
        title: "Réinitialisation totale",
        message: "Première confirmation : cette action est <strong>irréversible</strong>.",
        word: "SUPPRIMER", confirmLabel: "Continuer",
        onConfirm: () => {
          // Deuxième garde-fou : compte à rebours annulable.
          let seconds = 10;
          let timer = null;
          const m = UI.modal({
            title: "Dernière chance",
            body: `<p>La réinitialisation démarre dans <strong id="reset-count">${seconds}</strong> secondes.
              Fermez cette fenêtre ou cliquez sur « Annuler » pour interrompre.</p>`,
            actions: [{ label: "Annuler", className: "btn btn-primary", onClick: (close) => { clearInterval(timer); close(); UI.toast("Réinitialisation annulée.", "info"); } }],
            onClose: () => clearInterval(timer),
          });
          timer = setInterval(async () => {
            seconds--;
            const el = document.getElementById("reset-count");
            if (el) el.textContent = seconds;
            if (seconds <= 0) {
              clearInterval(timer);
              m.close();
              await logAudit("all-reset", "RÉINITIALISATION TOTALE exécutée (plannings, demandes, annonces)");
              for (const col of ["schedules", "absenceRequests", "vanRequests", "announcements"]) {
                const docs = await Store.list(col);
                for (const id of Object.keys(docs)) await Store.remove(col, id);
              }
              App.clearScheduleCache();
              UI.toast("Réinitialisation totale effectuée.", "success", 7000);
              App.navigate("accueil");
            }
          }, 1000);
        },
      });
    });
  },
};

// --- Enregistrement des pages ---------------------------------------------------
Object.assign(window.Pages, {
  "alertes": PagesAdmin.alertes,
  "modif-planning": (c, p) => PagesAdmin.modifPlanning(c, p),
  "impression": PagesAdmin.impression,
  "gestion-absences": (c) => PagesAdmin.requestManager(c, "absence"),
  "gestion-camion": (c) => PagesAdmin.requestManager(c, "van"),
  "mes-absences-admin": PagesAdmin.mesAbsencesAdmin,
  "gestion-equipe": PagesAdmin.gestionEquipe,
  "feries": PagesAdmin.feries,
  "blocage-mois": PagesAdmin.blocageMois,
  "config-periode": PagesAdmin.configPeriode,
  "annonces": PagesAdmin.annonces,
  "historique": PagesAdmin.historique,
  "sauvegardes": PagesAdmin.sauvegardes,
  "all-reset": PagesAdmin.allReset,
});
