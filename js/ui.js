/* =============================================================================
   SUIVI ANNUALISATION — Utilitaires d'interface (toasts, modales, thème…)
   ========================================================================== */

const UI = {
  // --- Toasts (4 niveaux, non bloquants) --------------------------------------
  toast(message, level = "info", duration = 4000) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast toast-${level}`;
    const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
    el.innerHTML = `<span class="toast-icon">${icons[level] || "ℹ"}</span><span>${UI.esc(message)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  // --- Modale générique --------------------------------------------------------
  /**
   * Affiche une modale. options = { title, body (HTML), actions: [{label,
   * className, onClick}], onClose, wide }. Retourne un objet {close}.
   */
  modal({ title, body, actions = [], onClose, wide = false }) {
    const root = document.getElementById("modal-root");
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>${UI.esc(title)}</h3>
          <button class="modal-close" aria-label="Fermer">✕</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-actions"></div>
      </div>`;
    overlay.querySelector(".modal-body").innerHTML = body;
    const actionsEl = overlay.querySelector(".modal-actions");
    const close = () => { overlay.remove(); onClose && onClose(); };
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.className = a.className || "btn";
      btn.textContent = a.label;
      btn.addEventListener("click", () => a.onClick(close));
      actionsEl.appendChild(btn);
    }
    overlay.querySelector(".modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    root.appendChild(overlay);
    return { close, el: overlay };
  },

  /**
   * Confirmation destructive à friction volontaire : l'utilisateur doit taper
   * `word` pour activer le bouton de confirmation.
   */
  confirmTyped({ title, message, word, confirmLabel, onConfirm }) {
    const m = UI.modal({
      title,
      body: `
        <p>${message}</p>
        <p>Pour confirmer, tapez <strong>${UI.esc(word)}</strong> ci-dessous :</p>
        <input type="text" id="confirm-typed-input" class="input" autocomplete="off" placeholder="${UI.esc(word)}">`,
      actions: [
        { label: "Annuler", className: "btn", onClick: (close) => close() },
        {
          label: confirmLabel || "Confirmer", className: "btn btn-danger",
          onClick: (close) => {
            const val = document.getElementById("confirm-typed-input").value.trim();
            if (val !== word) { UI.toast(`Saisissez exactement « ${word} » pour confirmer.`, "warning"); return; }
            close();
            onConfirm();
          },
        },
      ],
    });
    setTimeout(() => document.getElementById("confirm-typed-input")?.focus(), 50);
    return m;
  },

  /** Confirmation simple (actions sensibles mais réversibles). */
  confirm({ title, message, confirmLabel = "Confirmer", danger = false, onConfirm }) {
    return UI.modal({
      title,
      body: `<p>${message}</p>`,
      actions: [
        { label: "Annuler", className: "btn", onClick: (close) => close() },
        { label: confirmLabel, className: danger ? "btn btn-danger" : "btn btn-primary", onClick: (close) => { close(); onConfirm(); } },
      ],
    });
  },

  // --- Thème sombre (persistant) -----------------------------------------------
  initTheme() {
    const saved = localStorage.getItem("sa_theme");
    const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  },

  toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("sa_theme", next);
  },

  // --- Divers -------------------------------------------------------------------
  /** Échappe le HTML (protection XSS pour tout contenu saisi). */
  esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  /** Badge coloré pour un type de jour. */
  typeBadge(type) {
    return `<span class="day-badge type-${UI.typeClass(type)}">${UI.esc(type)}</span>`;
  },

  typeClass(type) {
    return {
      "normal": "normal", "repos": "repos", "CP": "cp", "CP Ancienneté": "cpanc",
      "Récupération": "recup", "Événement Familial": "evenement",
      "Maladie": "maladie", "Formation": "formation", "Autre": "autre",
    }[type] || "normal";
  },

  statusBadge(status) {
    const labels = {
      pending: "En attente", waiting: "En cours", approved: "Approuvée",
      rejected: "Refusée", cancelled: "Annulée", archived: "Archivée",
    };
    return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
  },

  /** Indicateur discret d'auto-sauvegarde. */
  savingIndicator(state) {
    const el = document.getElementById("saving-indicator");
    if (!el) return;
    if (state === "saving") { el.textContent = "Sauvegarde…"; el.className = "saving-indicator visible"; }
    else if (state === "saved") {
      el.textContent = "✓ Sauvegardé";
      el.className = "saving-indicator visible saved";
      setTimeout(() => el.classList.remove("visible"), 1500);
    } else { el.className = "saving-indicator"; }
  },

  /** Petit texte d'aide raccourcis clavier (découvrabilité). */
  kbdHint(text) {
    return `<p class="kbd-hint">⌨ ${text}</p>`;
  },

  spinner() { return `<div class="spinner"></div>`; },
};
