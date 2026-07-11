/* =============================================================================
   SUIVI ANNUALISATION — Pages espace collaborateur
   (+ éditeur de planning partagé avec l'espace admin)
   ========================================================================== */

window.Pages = window.Pages || {};

const PagesEmployee = {

  // ==========================================================================
  // Statut d'une journée (pour les vues « Aujourd'hui »)
  // ==========================================================================
  dayStatus(day, user) {
    const unit = userUnit(user);
    if (!day || ((Number(day.hours) || 0) === 0 && (!day.type || day.type === "normal" || day.type === "repos"))) {
      return { icon: "⚪", label: "Repos" };
    }
    if (NON_WORKED_TYPES.has(day.type) || day.type === "Maladie") {
      return { icon: "🔴", label: `Absent — ${day.type}` };
    }
    return { icon: "🟢", label: `Travaille ${fmtNum(day.hours)}${unit}${day.type !== "normal" ? ` (${day.type})` : ""}` };
  },

  // ==========================================================================
  // Tableau de bord collaborateur
  // ==========================================================================
  async dashboard(container) {
    const user = App.state.currentUser;
    const cfg = App.state.periodConfig;
    const schedule = await App.getSchedule(user.username);
    const s = computeStats(user, schedule.days, cfg);
    const today = schedule.days[todayKey()];
    const status = PagesEmployee.dayStatus(today, user);
    const { start, end } = periodBounds(cfg);
    const u = s.unit;

    container.innerHTML = `
      <div class="grid grid-kpi">
        <div class="kpi accent"><div class="kpi-label">Cible annuelle</div>
          <div class="kpi-value">${fmtNum(s.target)}${u}</div>
          <div class="kpi-sub">${frDateShort(dateKey(start))} → ${frDateShort(dateKey(end))}</div></div>
        <div class="kpi"><div class="kpi-label">Réalisé</div>
          <div class="kpi-value">${fmtNum(s.realized)}${u}</div>
          <div class="kpi-sub">attendu à date : ${fmtNum(s.expected)}${u}</div></div>
        <div class="kpi"><div class="kpi-label">Restant</div>
          <div class="kpi-value">${fmtNum(s.remaining)}${u}</div>
          <div class="kpi-sub">écart vs attendu : ${s.ecart >= 0 ? "+" : ""}${fmtNum(s.ecart)}${u}</div></div>
        <div class="kpi"><div class="kpi-label">Progression</div>
          <div class="kpi-value">${s.progressPct} %</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${s.progressPct}%"></div></div></div>
        <div class="kpi"><div class="kpi-label">CP restants</div>
          <div class="kpi-value">${s.cpRemaining}</div>
          <div class="kpi-sub">${s.cpUsed}/${s.cpDays} posés</div></div>
        ${s.cpAnc > 0 ? `<div class="kpi"><div class="kpi-label">CP ancienneté restants</div>
          <div class="kpi-value">${s.cpAncRemaining}</div>
          <div class="kpi-sub">${s.cpAncUsed}/${s.cpAnc} posés</div></div>` : ""}
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>Aujourd'hui — ${frDateLabel(todayKey())}</h3>
          <p style="font-size:1.1rem">${status.icon} ${UI.esc(status.label)}</p>
        </div>
        <div class="card">
          <h3>Accès rapide</h3>
          <div class="btn-row">
            <button class="btn btn-primary" data-nav="demande-absence">🏖 Poser une absence</button>
            <button class="btn" data-nav="mes-demandes">📋 Mes demandes</button>
            <button class="btn" data-nav="planning-equipe">👥 Planning équipe</button>
            <button class="btn" data-nav="mon-planning">📅 Mon planning</button>
          </div>
        </div>
      </div>`;
    container.querySelectorAll("[data-nav]").forEach((b) =>
      b.addEventListener("click", () => App.navigate(b.dataset.nav)));
  },

  // ==========================================================================
  // Éditeur de planning (partagé collaborateur / admin)
  // opts = { adminMode: bool, onSaved: fn }
  // ==========================================================================
  async renderScheduleEditor(container, username, opts = {}) {
    const user = App.state.users[username] || App.state.currentUser;
    const cfg = App.state.periodConfig;
    const schedule = await App.getSchedule(username, { fresh: true });
    let days = { ...schedule.days };
    const months = periodMonths(cfg);
    const nowKey = todayKey().slice(0, 7);
    let current = months.find((m) => m.key === nowKey) || months[0];
    let saveTimer = null;
    const isCadre = !!user.isCadre;
    const unit = userUnit(user);

    const scheduleSave = () => {
      UI.savingIndicator("saving");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await App.saveSchedule(username, days);
          UI.savingIndicator("saved");
          opts.onSaved && opts.onSaved(days);
        } catch (e) {
          console.error(e);
          UI.toast("Échec de la sauvegarde du planning.", "error");
          UI.savingIndicator("");
        }
      }, 800);
    };

    const wrap = document.createElement("div");
    container.appendChild(wrap);

    const render = () => {
      const locked = App.isMonthLocked(current.year, current.month) && !opts.adminMode;
      const s = computeStats(user, days, cfg);
      const monthRealized = computeMonthRealized(days, current.year, current.month);
      // Cible mensuelle indicative = cible annuelle / 12 (choix d'implémentation).
      const monthTarget = Math.round((s.target / 12) * 10) / 10;
      const keys = monthDateKeys(current.year, current.month);

      // Bannière de fiabilité CP en fin de période.
      let reliability = "";
      if (s.daysToEnd <= 90 && (s.cpRemaining > 0.3 * s.cpDays || (s.cpAnc > 0 && s.cpAncRemaining > 0.3 * s.cpAnc))) {
        reliability = `<div class="banner banner-warning">⚠ Fin de période dans ${s.daysToEnd} jours :
          il vous reste ${s.cpRemaining} CP${s.cpAnc > 0 ? ` et ${s.cpAncRemaining} CP ancienneté` : ""} à poser.</div>`;
      }

      wrap.innerHTML = `
        ${reliability}
        <div class="month-tabs">${months.map((m) => `
          <button class="month-tab ${m.key === current.key ? "active" : ""} ${App.isMonthLocked(m.year, m.month) ? "locked" : ""}"
            data-month="${m.key}">${UI.esc(m.label)}</button>`).join("")}
        </div>
        ${locked ? `<div class="banner banner-locked">🔒 Ce mois est verrouillé par l'administration : lecture seule.</div>` : ""}
        ${opts.adminMode && App.isMonthLocked(current.year, current.month) ? `<div class="banner banner-info">🔒 Mois verrouillé pour les collaborateurs — modifiable en tant qu'admin.</div>` : ""}

        <div class="card collapsible">
          <div class="collapsible-head" data-toggle="synth">
            <h3 style="margin:0">Synthèse mensuelle — ${UI.esc(current.label)}</h3><span>▾</span>
          </div>
          <div data-body="synth" hidden>
            <p style="margin-top:.6rem">Réalisé ce mois :
              <strong style="color:${monthRealized >= monthTarget ? "var(--success)" : "var(--danger)"}">
              ${fmtNum(monthRealized)}${unit}</strong> / cible indicative ${fmtNum(monthTarget)}${unit} (cible annuelle ÷ 12).</p>
            <p class="muted">Cumul période : ${fmtNum(s.realized)}${unit} réalisés · ${fmtNum(s.expected)}${unit} attendus ·
              écart ${s.ecart >= 0 ? "+" : ""}${fmtNum(s.ecart)}${unit}.</p>
          </div>
        </div>

        ${locked ? "" : `
        <div class="card no-print">
          <h3>Édition en masse</h3>
          <div class="btn-row">
            <button class="btn btn-sm" id="check-all">Tout cocher</button>
            <button class="btn btn-sm" id="uncheck-all">Tout décocher</button>
            <span style="flex:1"></span>
            <label class="muted">${isCadre ? "Journées" : "Heures"} :</label>
            <input class="input" id="mass-hours" type="number" min="0" ${isCadre ? 'max="1"' : ""} step="0.5" style="width:90px" value="0">
            <label class="muted">Type :</label>
            <select class="select" id="mass-type" style="width:auto">
              ${DAY_TYPES.map((t) => `<option>${t}</option>`).join("")}
            </select>
            <button class="btn btn-primary btn-sm" id="mass-apply">Appliquer aux jours cochés</button>
          </div>
        </div>`}

        <div class="card">
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                ${locked ? "" : `<th></th>`}
                <th>Jour</th><th>${isCadre ? "Journée (0 / 0,5 / 1)" : "Heures"}</th><th>Type</th><th>Note</th><th></th>
              </tr></thead>
              <tbody>
                ${keys.map((key) => {
                  const d = parseKey(key);
                  const day = days[key] || { hours: 0, type: d.getDay() === 0 ? "repos" : "normal", note: "" };
                  const holiday = App.state.holidays[key];
                  const openSunday = App.state.openSundays[key];
                  const isSunday = d.getDay() === 0;
                  const protectedDay = isProtectedDay(day);
                  const dis = locked || (protectedDay && !opts.adminMode) ? "disabled" : "";
                  const tags = [
                    holiday ? `<span class="day-badge" style="background:var(--navy-light)">Férié ${holiday.open ? "ouvert" : "fermé"}</span>` : "",
                    openSunday ? `<span class="day-badge" style="background:var(--teal)">Dim. ouvert</span>` : "",
                    day.absenceId ? `<span class="day-badge type-cp" title="Généré par une absence validée">Absence validée</span>` : "",
                  ].join(" ");
                  return `<tr class="${isSunday ? "row-sunday" : ""} ${key === todayKey() ? "row-today" : ""}">
                    ${locked ? "" : `<td><input type="checkbox" class="day-check" data-key="${key}" ${protectedDay && !opts.adminMode ? "disabled" : ""}></td>`}
                    <td style="white-space:nowrap">${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}</td>
                    <td><input type="number" class="input day-hours" data-key="${key}" min="0" ${isCadre ? 'max="1"' : ""} step="0.5"
                      value="${Number(day.hours) || 0}" style="width:85px" ${dis}></td>
                    <td><select class="select day-type" data-key="${key}" style="width:auto;border-left:4px solid var(--c-${UI.typeClass(day.type)})" ${dis}>
                      ${DAY_TYPES.map((t) => `<option ${t === day.type ? "selected" : ""}>${t}</option>`).join("")}
                    </select></td>
                    <td><input type="text" class="input day-note" data-key="${key}" value="${UI.esc(day.note || "")}" placeholder="Note…" ${dis}></td>
                    <td>${tags}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
          ${locked ? "" : `<p class="kbd-hint">Les modifications sont enregistrées automatiquement (« Sauvegarde… » en haut de page).</p>`}
        </div>`;

      // --- Wiring -------------------------------------------------------------
      wrap.querySelectorAll(".month-tab").forEach((b) => b.addEventListener("click", () => {
        current = months.find((m) => m.key === b.dataset.month);
        render();
      }));
      wrap.querySelector("[data-toggle=synth]")?.addEventListener("click", () => {
        const body = wrap.querySelector("[data-body=synth]");
        body.hidden = !body.hidden;
      });

      const touch = (key) => {
        if (!days[key]) days[key] = { hours: 0, type: "normal", note: "" };
        return days[key];
      };
      wrap.querySelectorAll(".day-hours").forEach((inp) => inp.addEventListener("change", () => {
        const day = { ...touch(inp.dataset.key) };
        day.hours = Math.max(0, Number(inp.value) || 0);
        days[inp.dataset.key] = day;
        scheduleSave();
      }));
      wrap.querySelectorAll(".day-type").forEach((sel) => sel.addEventListener("change", () => {
        const day = { ...touch(sel.dataset.key) };
        day.type = sel.value;
        days[sel.dataset.key] = day;
        sel.style.borderLeft = `4px solid var(--c-${UI.typeClass(sel.value)})`;
        scheduleSave();
      }));
      wrap.querySelectorAll(".day-note").forEach((inp) => inp.addEventListener("change", () => {
        const day = { ...touch(inp.dataset.key) };
        day.note = inp.value;
        days[inp.dataset.key] = day;
        scheduleSave();
      }));

      wrap.querySelector("#check-all")?.addEventListener("click", () =>
        wrap.querySelectorAll(".day-check:not(:disabled)").forEach((c) => { c.checked = true; }));
      wrap.querySelector("#uncheck-all")?.addEventListener("click", () =>
        wrap.querySelectorAll(".day-check").forEach((c) => { c.checked = false; }));
      wrap.querySelector("#mass-apply")?.addEventListener("click", () => {
        const hours = Math.max(0, Number(wrap.querySelector("#mass-hours").value) || 0);
        const type = wrap.querySelector("#mass-type").value;
        const checked = [...wrap.querySelectorAll(".day-check:checked")];
        if (!checked.length) { UI.toast("Cochez au moins un jour.", "warning"); return; }
        let applied = 0, skipped = 0;
        for (const c of checked) {
          const key = c.dataset.key;
          if (isProtectedDay(days[key]) && !opts.adminMode) { skipped++; continue; }
          days[key] = { ...(days[key] || {}), hours, type, note: days[key]?.note || "" };
          applied++;
        }
        scheduleSave();
        render();
        UI.toast(`${applied} jour(s) modifié(s)${skipped ? `, ${skipped} protégé(s) ignoré(s)` : ""}.`, "success");
      });
    };

    render();
    return {
      getDays: () => days,
      setDays: (d) => { days = { ...d }; scheduleSave(); render(); },
      rerender: render,
    };
  },

  async monPlanning(container) {
    container.innerHTML = "";
    await PagesEmployee.renderScheduleEditor(container, App.state.currentUser.username);
  },

  // ==========================================================================
  // Planning type hebdomadaire
  // ==========================================================================
  async planningType(container) {
    const user = App.state.currentUser;
    const tp = user.typePlanning || {};
    const isCadre = !!user.isCadre;
    const daysOrder = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

    container.innerHTML = `
      <div class="card">
        <h2>Planning Type Hebdomadaire</h2>
        <p class="muted">Définissez vos ${isCadre ? "journées (0 / 0,5 / 1)" : "heures"} habituelles par jour de semaine,
        puis appliquez-les à l'ensemble de la période. Les jours avec une absence validée ou un férié fermé ne sont jamais écrasés.</p>
        <div class="form-grid" style="margin:1rem 0">
          ${daysOrder.map((d) => `
            <div class="field"><label>${d.charAt(0).toUpperCase() + d.slice(1)}</label>
              <input class="input tp-input" data-day="${d}" type="number" min="0" ${isCadre ? 'max="1"' : ""} step="0.5"
                value="${Number(tp[d]) || 0}"></div>`).join("")}
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="tp-save">Enregistrer le planning type</button>
          <button class="btn btn-primary" id="tp-apply">Appliquer à toute la période</button>
        </div>
      </div>`;

    const readTemplate = () => {
      const out = {};
      container.querySelectorAll(".tp-input").forEach((i) => { out[i.dataset.day] = Math.max(0, Number(i.value) || 0); });
      return out;
    };

    container.querySelector("#tp-save").addEventListener("click", async () => {
      const typePlanning = readTemplate();
      await Store.update("users", user.username, { typePlanning });
      App.state.currentUser.typePlanning = typePlanning;
      App.state.users[user.username] = { ...App.state.users[user.username], typePlanning };
      UI.toast("Planning type enregistré.", "success");
    });

    container.querySelector("#tp-apply").addEventListener("click", () => {
      UI.confirm({
        title: "Appliquer le planning type",
        message: "Le planning de toute la période sera réécrit sur la base du planning type (hors jours protégés : absences validées et fériés fermés). Continuer ?",
        confirmLabel: "Appliquer",
        onConfirm: async () => {
          const typePlanning = readTemplate();
          await Store.update("users", user.username, { typePlanning });
          App.state.currentUser.typePlanning = typePlanning;
          const schedule = await App.getSchedule(user.username, { fresh: true });
          const days = applyWeeklyTemplate(schedule.days, typePlanning, App.state.periodConfig);
          await App.saveSchedule(user.username, days);
          UI.toast("Planning type appliqué à toute la période.", "success");
        },
      });
    });
  },

  // ==========================================================================
  // Demande d'absence
  // ==========================================================================
  async demandeAbsence(container) {
    const user = App.state.currentUser;
    const cfg = App.state.periodConfig;
    const schedule = await App.getSchedule(user.username, { fresh: true });
    const s = computeStats(user, schedule.days, cfg);

    container.innerHTML = `
      <div class="grid grid-kpi">
        <div class="kpi"><div class="kpi-label">CP restants</div><div class="kpi-value">${s.cpRemaining}</div>
          <div class="kpi-sub">${s.cpUsed}/${s.cpDays} posés</div></div>
        <div class="kpi"><div class="kpi-label">CP ancienneté restants</div><div class="kpi-value">${s.cpAncRemaining}</div>
          <div class="kpi-sub">${s.cpAncUsed}/${s.cpAnc} posés</div></div>
        <div class="kpi accent"><div class="kpi-label">Récupération disponible</div>
          <div class="kpi-value">${fmtNum(s.recupAvailable)}${s.unit}</div>
          <div class="kpi-sub">heures réalisées au-delà de l'attendu</div></div>
      </div>

      <div class="card">
        <h2>Nouvelle demande d'absence</h2>
        <div class="form-grid">
          <div class="field"><label>Type d'absence</label>
            <select class="select" id="abs-type">
              <option>CP</option>
              ${s.cpAnc > 0 ? "<option>CP Ancienneté</option>" : ""}
              <option>Récupération</option>
              <option>Événement Familial</option>
            </select></div>
          <div class="field"><label>Du</label><input class="input" id="abs-start" type="date" required></div>
          <div class="field"><label>Au (inclus)</label><input class="input" id="abs-end" type="date"></div>
          <div class="field" id="abs-hours-field" hidden><label>Heures à déduire</label>
            <input class="input" id="abs-hours" type="number" min="0.5" step="0.5" value="7"></div>
        </div>
        <p class="muted" id="abs-summary"></p>
        <div class="field"><label>Commentaire (facultatif)</label>
          <textarea class="input" id="abs-comment" rows="2" maxlength="500"></textarea></div>
        <button class="btn btn-primary" id="abs-submit">Envoyer la demande</button>
      </div>`;

    const typeSel = container.querySelector("#abs-type");
    const startInp = container.querySelector("#abs-start");
    const endInp = container.querySelector("#abs-end");
    const hoursField = container.querySelector("#abs-hours-field");
    const summary = container.querySelector("#abs-summary");

    const refresh = () => {
      const isDayType = ABSENCE_DAY_TYPES.includes(typeSel.value);
      hoursField.hidden = isDayType;
      if (startInp.value) {
        const end = endInp.value || startInp.value;
        if (isDayType) {
          const n = countOpenDays(startInp.value, end);
          summary.textContent = `Soit ${n} jour(s) ouvré(s) (dimanches exclus).`;
        } else {
          summary.textContent = `Du ${frDateShort(startInp.value)} au ${frDateShort(end)} — heures déduites du planning prévu.`;
        }
      } else summary.textContent = "";
    };
    [typeSel, startInp, endInp].forEach((el) => el.addEventListener("change", refresh));
    refresh();

    container.querySelector("#abs-submit").addEventListener("click", async () => {
      const type = typeSel.value;
      const date = startInp.value;
      const dateEnd = endInp.value || date;
      if (!date) { UI.toast("Sélectionnez une date de début.", "warning"); return; }
      if (dateEnd < date) { UI.toast("La date de fin doit être postérieure à la date de début.", "warning"); return; }
      const isDayType = ABSENCE_DAY_TYPES.includes(type);
      const nDays = countOpenDays(date, dateEnd);
      const hours = isDayType ? 0 : Number(container.querySelector("#abs-hours").value) || 0;
      if (isDayType && nDays === 0) { UI.toast("Aucun jour ouvré dans la période sélectionnée.", "warning"); return; }
      if (!isDayType && hours <= 0) { UI.toast("Indiquez un nombre d'heures à déduire.", "warning"); return; }
      // Garde-fous sur les soldes (avertissement, non bloquant : le manager tranche).
      if (type === "CP" && nDays > s.cpRemaining) UI.toast(`Attention : ${nDays} jours demandés pour ${s.cpRemaining} CP restants.`, "warning", 6000);
      if (type === "CP Ancienneté" && nDays > s.cpAncRemaining) UI.toast(`Attention : ${nDays} jours demandés pour ${s.cpAncRemaining} CP ancienneté restants.`, "warning", 6000);

      const id = genId("abs");
      const dateLabel = date === dateEnd ? frDateLabel(date) : `du ${frDateShort(date)} au ${frDateShort(dateEnd)}`;
      const request = {
        id, userId: user.username, userName: user.name, userEmail: user.email || "",
        type, date, dateEnd, dateLabel,
        hours, qLabel: isDayType ? `${nDays} jour(s)` : `${fmtNum(hours)} h`,
        comment: container.querySelector("#abs-comment").value.trim(),
        status: "pending", createdAt: Date.now(),
      };
      await Store.set("absenceRequests", id, request);
      UI.toast("Demande d'absence envoyée.", "success");
      await sendEmail("absenceRequest", {
        to_email: MANAGER_EMAIL, user_name: user.name, request_type: type,
        request_dates: dateLabel, request_quantity: request.qLabel, request_comment: request.comment || "—",
      }, { silent: !emailConfigured() });
      App.navigate("mes-demandes");
    });
  },

  // ==========================================================================
  // Mes demandes d'absence
  // ==========================================================================
  async mesDemandes(container) {
    const user = App.state.currentUser;
    const all = await Store.list("absenceRequests");
    const mine = Object.values(all)
      .filter((r) => r.userId === user.username)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
      <div class="card">
        <h2>Mes demandes d'absence</h2>
        ${mine.length === 0 ? `<p class="muted">Aucune demande pour le moment.</p>` : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Type</th><th>Dates</th><th>Quantité</th><th>Commentaire</th><th>Statut</th><th></th></tr></thead>
          <tbody>${mine.map((r) => `
            <tr>
              <td>${UI.typeBadge(r.type)}</td>
              <td>${UI.esc(r.dateLabel)}</td>
              <td>${UI.esc(r.qLabel || "")}</td>
              <td>${UI.esc(r.comment || "—")}</td>
              <td>${UI.statusBadge(r.status)}</td>
              <td>${["pending", "waiting"].includes(r.status)
                ? `<button class="btn btn-sm btn-danger" data-cancel="${r.id}">Annuler</button>` : ""}</td>
            </tr>`).join("")}</tbody>
        </table></div>`}
      </div>`;

    container.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => {
      UI.confirm({
        title: "Annuler la demande",
        message: "Confirmez-vous l'annulation de cette demande d'absence ?",
        confirmLabel: "Annuler la demande", danger: true,
        onConfirm: async () => {
          await Store.update("absenceRequests", b.dataset.cancel, { status: "cancelled", cancelledAt: Date.now() });
          UI.toast("Demande annulée.", "success");
          App.navigate("mes-demandes");
        },
      });
    }));
  },

  // ==========================================================================
  // Emprunt de la camionnette
  // ==========================================================================
  async camionnette(container) {
    const user = App.state.currentUser;
    const all = await Store.list("vanRequests");
    const mine = Object.values(all)
      .filter((r) => r.userId === user.username)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
      <div class="card">
        <h2>Emprunter la camionnette</h2>
        <div class="form-grid">
          <div class="field"><label>Début</label><input class="input" id="van-start" type="datetime-local"></div>
          <div class="field"><label>Fin</label><input class="input" id="van-end" type="datetime-local"></div>
        </div>
        <div class="field" id="van-parking-field" hidden>
          <label>Lieu de stationnement la nuit (obligatoire pour un emprunt multi-jours ou le week-end)</label>
          <input class="input" id="van-parking" placeholder="Ex. : parking résidence, 12 rue des Lilas…">
        </div>
        <div class="field"><label>Motif / commentaire</label>
          <textarea class="input" id="van-comment" rows="2" maxlength="500"></textarea></div>
        <button class="btn btn-primary" id="van-submit">Envoyer la demande</button>
      </div>

      <div class="card">
        <h3>Mes demandes d'emprunt</h3>
        ${mine.length === 0 ? `<p class="muted">Aucune demande pour le moment.</p>` : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Période</th><th>Stationnement</th><th>Commentaire</th><th>Statut</th><th></th></tr></thead>
          <tbody>${mine.map((r) => `
            <tr>
              <td>${UI.esc(r.dateLabel)}</td>
              <td>${UI.esc(r.parking || "—")}</td>
              <td>${UI.esc(r.comment || "—")}</td>
              <td>${UI.statusBadge(r.status)}</td>
              <td>${["pending", "waiting"].includes(r.status)
                ? `<button class="btn btn-sm btn-danger" data-cancel="${r.id}">Annuler</button>` : ""}</td>
            </tr>`).join("")}</tbody>
        </table></div>`}
      </div>`;

    const startInp = container.querySelector("#van-start");
    const endInp = container.querySelector("#van-end");
    const parkingField = container.querySelector("#van-parking-field");
    const refreshParking = () => {
      if (startInp.value && endInp.value) parkingField.hidden = !vanNeedsParking(startInp.value, endInp.value);
    };
    [startInp, endInp].forEach((el) => el.addEventListener("change", refreshParking));

    container.querySelector("#van-submit").addEventListener("click", async () => {
      const dateStart = startInp.value, dateEnd = endInp.value;
      if (!dateStart || !dateEnd) { UI.toast("Renseignez les dates de début et de fin.", "warning"); return; }
      if (dateEnd <= dateStart) { UI.toast("La fin doit être postérieure au début.", "warning"); return; }
      const needsParking = vanNeedsParking(dateStart, dateEnd);
      const parking = container.querySelector("#van-parking").value.trim();
      if (needsParking && !parking) {
        UI.toast("Indiquez le lieu de stationnement la nuit (emprunt multi-jours ou week-end).", "warning");
        parkingField.hidden = false;
        return;
      }
      const id = genId("van");
      const fmt = (v) => new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
      const request = {
        id, userId: user.username, userName: user.name, userEmail: user.email || "",
        dateStart, dateEnd, dateLabel: `${fmt(dateStart)} → ${fmt(dateEnd)}`,
        parking: needsParking ? parking : "",
        comment: container.querySelector("#van-comment").value.trim(),
        status: "pending", createdAt: Date.now(),
      };
      await Store.set("vanRequests", id, request);
      UI.toast("Demande d'emprunt envoyée.", "success");
      await sendEmail("vanRequest", {
        to_email: MANAGER_EMAIL, user_name: user.name, request_dates: request.dateLabel,
        request_parking: request.parking || "—", request_comment: request.comment || "—",
      }, { silent: !emailConfigured() });
      App.navigate("camionnette");
    });

    container.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => {
      UI.confirm({
        title: "Annuler la demande",
        message: "Confirmez-vous l'annulation de cette demande d'emprunt ?",
        confirmLabel: "Annuler la demande", danger: true,
        onConfirm: async () => {
          await Store.update("vanRequests", b.dataset.cancel, { status: "cancelled", cancelledAt: Date.now() });
          UI.toast("Demande annulée.", "success");
          App.navigate("camionnette");
        },
      });
    }));
  },

  // ==========================================================================
  // Page pédagogique 1607 heures
  // ==========================================================================
  async info1607(container) {
    container.innerHTML = `
      <div class="card info-page">
        <h2>Tout sur les 1607 heures</h2>
        <h3>Qu'est-ce que l'annualisation du temps de travail ?</h3>
        <p>Plutôt qu'un horaire hebdomadaire fixe (ex. 35 h chaque semaine), l'annualisation répartit le temps de
        travail sur une <strong>période de 12 mois</strong>. Les semaines chargées (fêtes, soldes, inventaires)
        peuvent dépasser 35 h et sont compensées par des semaines plus légères, tant que le total annuel respecte
        la cible.</p>
        <h3>Pourquoi 1607 heures ?</h3>
        <p>Le calcul de référence pour un salarié à temps plein est le suivant :</p>
        <ul>
          <li>365 jours – 104 jours de repos hebdomadaire (samedis/dimanches) = 261 jours</li>
          <li>– 25 jours de congés payés = 236 jours</li>
          <li>– 8 jours fériés chômés en moyenne = 228 jours</li>
          <li>228 jours × 7 h = 1596 h, arrondies à <strong>1600 h</strong></li>
          <li>+ 7 h au titre de la <strong>journée de solidarité</strong> = <strong>1607 h</strong></li>
        </ul>
        <h3>Et pour les cadres ?</h3>
        <p>Les cadres autonomes relèvent d'un <strong>forfait en jours</strong> (218 jours/an par défaut) : on ne
        compte pas leurs heures mais leurs journées et demi-journées travaillées (2 demi-journées = 1 jour).</p>
        <h3>Les congés payés (CP)</h3>
        <ul>
          <li>Chaque salarié acquiert <strong>25 jours ouvrés</strong> de CP par an (hors ancienneté).</li>
          <li>Des jours supplémentaires peuvent s'ajouter selon l'ancienneté (« CP ancienneté »).</li>
          <li>Les CP doivent être <strong>soldés avant la fin de la période</strong> : posez-les régulièrement,
          l'application vous alerte à l'approche de l'échéance.</li>
        </ul>
        <h3>Récupération</h3>
        <p>Si vos heures réalisées dépassent la courbe attendue, l'excédent constitue de la
        <strong>récupération</strong> à poser (type « Récupération ») avant la fin de période, pour revenir sur la
        cible annuelle sans perdre ces heures.</p>
        <h3>Comment lire mon tableau de bord ?</h3>
        <ul>
          <li><strong>Réalisé</strong> : heures comptées comme travaillées (la maladie et la formation maintiennent le cumul).</li>
          <li><strong>Attendu à date</strong> : cible annuelle × % de période écoulée.</li>
          <li><strong>Écart</strong> : réalisé – attendu. Négatif = retard, positif = avance à récupérer.</li>
        </ul>
      </div>`;
  },

  // ==========================================================================
  // Planning équipe (mensuel + annuel)
  // ==========================================================================
  async planningEquipe(container) {
    const cfg = App.state.periodConfig;
    const months = periodMonths(cfg);
    const nowKey = todayKey().slice(0, 7);
    let current = months.find((m) => m.key === nowKey) || months[0];
    let view = "month";
    const users = App.usersList();
    const schedules = {};
    for (const u of users) schedules[u.username] = (await App.getSchedule(u.username)).days;

    const render = () => {
      if (view === "annual") {
        container.innerHTML = `
          <div class="card">
            <div class="btn-row" style="margin-bottom:.8rem">
              <button class="btn" id="view-month">Vue mensuelle</button>
              <button class="btn btn-primary" disabled>Vue annuelle</button>
              <span style="flex:1"></span>
              <button class="btn btn-secondary" id="export-xlsx">📊 Export Excel</button>
            </div>
            <h3>Bilan annuel de l'équipe</h3>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Collaborateur</th><th>Cible</th><th>Réalisé</th><th>Attendu à date</th><th>Écart</th><th>Progression</th></tr></thead>
              <tbody>${users.map((u) => {
                const s = computeStats(u, schedules[u.username], cfg);
                return `<tr>
                  <td><strong>${UI.esc(u.name)}</strong>${u.isCadre ? ' <span class="day-badge type-cpanc">Cadre</span>' : ""}</td>
                  <td>${fmtNum(s.target)}${s.unit}</td>
                  <td>${fmtNum(s.realized)}${s.unit}</td>
                  <td>${fmtNum(s.expected)}${s.unit}</td>
                  <td style="color:${s.ecart < 0 ? "var(--danger)" : "var(--success)"}">${s.ecart >= 0 ? "+" : ""}${fmtNum(s.ecart)}${s.unit}</td>
                  <td style="min-width:140px">${s.progressPct} %
                    <div class="progress-bar"><div class="progress-fill" style="width:${s.progressPct}%"></div></div></td>
                </tr>`;
              }).join("")}</tbody>
            </table></div>
          </div>`;
        container.querySelector("#view-month").addEventListener("click", () => { view = "month"; render(); });
        container.querySelector("#export-xlsx").addEventListener("click", () => {
          if (typeof XLSX === "undefined") { UI.toast("Bibliothèque Excel non chargée.", "error"); return; }
          const rows = users.map((u) => {
            const s = computeStats(u, schedules[u.username], cfg);
            return {
              Collaborateur: u.name, Statut: u.isCadre ? "Cadre" : "Non-cadre",
              Cible: s.target, "Réalisé": s.realized, "Attendu à date": s.expected,
              "Écart": s.ecart, "Progression (%)": s.progressPct,
              "CP posés": s.cpUsed, "CP restants": s.cpRemaining,
            };
          });
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Bilan annuel");
          XLSX.writeFile(wb, `bilan-annualisation-${todayKey()}.xlsx`);
        });
        return;
      }

      const keys = monthDateKeys(current.year, current.month);
      container.innerHTML = `
        <div class="card">
          <div class="btn-row" style="margin-bottom:.8rem">
            <button class="btn btn-primary" disabled>Vue mensuelle</button>
            <button class="btn" id="view-annual">Vue annuelle</button>
          </div>
          <div class="month-tabs">${months.map((m) => `
            <button class="month-tab ${m.key === current.key ? "active" : ""}" data-month="${m.key}">${UI.esc(m.label)}</button>`).join("")}
          </div>
          <div class="team-grid-wrap">
            <table class="team-grid">
              <thead><tr><th class="name-col">Collaborateur</th>
                ${keys.map((k) => {
                  const d = parseKey(k);
                  return `<th title="${frDateLabel(k)}" style="${d.getDay() === 0 ? "background:var(--surface-2)" : ""}">${d.getDate()}</th>`;
                }).join("")}
              </tr></thead>
              <tbody>${users.map((u) => `
                <tr><td class="name-col">${UI.esc(u.name)}</td>
                  ${keys.map((k) => {
                    const day = schedules[u.username]?.[k];
                    if (!day || (!Number(day.hours) && (!day.type || day.type === "normal" || day.type === "repos"))) return "<td></td>";
                    const cls = UI.typeClass(day.type);
                    const label = NON_WORKED_TYPES.has(day.type) || day.type === "Maladie"
                      ? day.type.slice(0, 3) : fmtNum(day.hours);
                    return `<td title="${frDateLabel(k)} — ${UI.esc(day.type)} ${fmtNum(day.hours)}">
                      <span class="team-cell type-${cls}">${label}</span></td>`;
                  }).join("")}
                </tr>`).join("")}</tbody>
            </table>
          </div>
          <p class="kbd-hint">Légende : ${DAY_TYPES.filter((t) => t !== "normal" && t !== "repos").map((t) => UI.typeBadge(t)).join(" ")}</p>
        </div>`;
      container.querySelector("#view-annual").addEventListener("click", () => { view = "annual"; render(); });
      container.querySelectorAll(".month-tab").forEach((b) => b.addEventListener("click", () => {
        current = months.find((m) => m.key === b.dataset.month);
        render();
      }));
    };
    render();
  },
};

// --- Enregistrement des pages --------------------------------------------------
Object.assign(window.Pages, {
  // « accueil » bascule automatiquement sur le tableau de bord admin.
  accueil: (c) => (App.isAdmin() ? PagesAdmin.dashboard(c) : PagesEmployee.dashboard(c)),
  "mon-planning": PagesEmployee.monPlanning,
  "planning-type": PagesEmployee.planningType,
  "demande-absence": PagesEmployee.demandeAbsence,
  "mes-demandes": PagesEmployee.mesDemandes,
  "camionnette": PagesEmployee.camionnette,
  "info-1607": PagesEmployee.info1607,
  "planning-equipe": PagesEmployee.planningEquipe,
});
