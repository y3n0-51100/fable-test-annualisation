/* =============================================================================
   SUIVI ANNUALISATION — Documents RH & Acomptes sur salaire
   ========================================================================== */

window.Pages = window.Pages || {};

/* -----------------------------------------------------------------------------
   Canvas de signature (dessin souris + tactile)
----------------------------------------------------------------------------- */
class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = "round";
    this.ctx.strokeStyle = "#1b2a4a";
    this.empty = true;
    this._drawing = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
    };
    const start = (e) => { e.preventDefault(); this._drawing = true; const { x, y } = pos(e); this.ctx.beginPath(); this.ctx.moveTo(x, y); };
    const move = (e) => {
      if (!this._drawing) return;
      e.preventDefault();
      const { x, y } = pos(e);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.empty = false;
    };
    const end = () => { this._drawing = false; };
    canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
  }
  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.empty = true; }
  dataURL() { return this.canvas.toDataURL("image/png"); }
}

const PagesDocs = {

  CATEGORIES: ["Bulletin de paie", "Contrat", "Attestation", "Autre"],

  // ==========================================================================
  // Outils fichiers
  // ==========================================================================
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  },

  base64Size(b64) { return Math.round(b64.length * 3 / 4); },

  /**
   * Compression d'un PDF : rendu de chaque page via pdf.js sur un canvas,
   * réencodage en JPEG dans un nouveau PDF (jsPDF). Perd l'interactivité
   * (texte sélectionnable) mais divise généralement la taille par 3 à 10.
   */
  async compressPdf(base64) {
    if (typeof pdfjsLib === "undefined" || !window.jspdf) throw new Error("Bibliothèques PDF non chargées.");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let doc = null;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const img = canvas.toDataURL("image/jpeg", 0.6);
      const w = 210, h = (canvas.height / canvas.width) * w; // A4 portrait
      if (!doc) doc = new window.jspdf.jsPDF({ unit: "mm", format: [w, Math.max(h, 50)] });
      else doc.addPage([w, Math.max(h, 50)]);
      doc.addImage(img, "JPEG", 0, 0, w, h);
    }
    return doc.output("datauristring").split(",")[1];
  },

  // ==========================================================================
  // Documents — rendu partagé collaborateur / admin
  // ==========================================================================
  async renderDocuments(container, { adminMode }) {
    const me = App.state.currentUser;
    const users = App.usersList();
    let filterUser = adminMode ? "all" : me.username;

    const load = async () => Object.values(await Store.list("documents"))
      .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    let docs = await load();

    const render = () => {
      const shown = docs.filter((d) => adminMode
        ? (filterUser === "all" || d.userId === filterUser)
        : d.userId === me.username);
      container.innerHTML = `
        <div class="card">
          <h2>${adminMode ? "Documents RH de l'équipe" : "Mes documents"}</h2>
          <div class="form-grid">
            ${adminMode ? `<div class="field"><label>Collaborateur concerné</label>
              <select class="select" id="doc-user">
                ${users.map((u) => `<option value="${UI.esc(u.username)}">${UI.esc(u.name)}</option>`).join("")}
              </select></div>` : ""}
            <div class="field"><label>Catégorie</label>
              <select class="select" id="doc-cat">${PagesDocs.CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div>
            <div class="field"><label>Description</label><input class="input" id="doc-desc" maxlength="200"></div>
            <div class="field"><label>Fichier (≤ ${Math.round(DOCUMENT_MAX_BYTES / 1024)} Ko — compression PDF proposée au-delà)</label>
              <input class="input" id="doc-file" type="file" accept=".pdf,.png,.jpg,.jpeg"></div>
          </div>
          <button class="btn btn-primary" id="doc-upload">⬆ Ajouter le document</button>
        </div>
        <div class="card">
          ${adminMode ? `<div class="filters-row">
            <button class="chip ${filterUser === "all" ? "active" : ""}" data-fu="all">Tous</button>
            ${users.map((u) => `<button class="chip ${filterUser === u.username ? "active" : ""}" data-fu="${UI.esc(u.username)}">${UI.esc(u.name)}</button>`).join("")}
          </div>` : ""}
          ${shown.length === 0 ? '<p class="muted">Aucun document.</p>' : `
          <div class="table-wrap"><table class="data">
            <thead><tr>${adminMode ? "<th>Collaborateur</th>" : ""}<th>Fichier</th><th>Catégorie</th><th>Description</th><th>Taille</th><th>Ajouté le</th><th>Actions</th></tr></thead>
            <tbody>${shown.map((d) => `
              <tr>
                ${adminMode ? `<td>${UI.esc(App.state.users[d.userId]?.name || d.userId)}</td>` : ""}
                <td><strong>${UI.esc(d.fileName)}</strong></td>
                <td>${UI.esc(d.category)}</td>
                <td>${UI.esc(d.description || "—")}</td>
                <td>${Math.round(d.fileSize / 1024)} Ko</td>
                <td>${new Date(d.uploadedAt).toLocaleDateString("fr-FR")}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-sm" data-preview="${d.id}">👁</button>
                  <button class="btn btn-sm" data-dl="${d.id}">⬇</button>
                  ${adminMode || d.userId === me.username ? `<button class="btn btn-sm btn-danger" data-del="${d.id}">🗑</button>` : ""}
                </td>
              </tr>`).join("")}</tbody>
          </table></div>`}
        </div>`;

      container.querySelectorAll("[data-fu]").forEach((b) =>
        b.addEventListener("click", () => { filterUser = b.dataset.fu; render(); }));

      container.querySelector("#doc-upload").addEventListener("click", async () => {
        const fileInput = container.querySelector("#doc-file");
        const file = fileInput.files[0];
        if (!file) { UI.toast("Sélectionnez un fichier.", "warning"); return; }
        let base64 = await PagesDocs.fileToBase64(file);
        let size = PagesDocs.base64Size(base64);
        if (size > DOCUMENT_MAX_BYTES) {
          if (file.type === "application/pdf") {
            UI.toast("Fichier trop volumineux : compression du PDF en cours…", "info");
            try {
              base64 = await PagesDocs.compressPdf(base64);
              size = PagesDocs.base64Size(base64);
            } catch (e) {
              console.error(e);
              UI.toast("Échec de la compression du PDF.", "error");
              return;
            }
            if (size > DOCUMENT_MAX_BYTES) {
              UI.toast(`Toujours trop volumineux après compression (${Math.round(size / 1024)} Ko).`, "error", 6000);
              return;
            }
            UI.toast(`PDF compressé : ${Math.round(size / 1024)} Ko.`, "success");
          } else {
            UI.toast(`Fichier trop volumineux (${Math.round(size / 1024)} Ko, max ${Math.round(DOCUMENT_MAX_BYTES / 1024)} Ko).`, "error", 6000);
            return;
          }
        }
        const id = genId("doc");
        await Store.set("documents", id, {
          id,
          userId: adminMode ? container.querySelector("#doc-user").value : me.username,
          fileName: file.name,
          mimeType: file.type === "application/pdf" || file.name.endsWith(".pdf") ? "application/pdf" : file.type,
          fileSize: size,
          base64Data: base64,
          category: container.querySelector("#doc-cat").value,
          description: container.querySelector("#doc-desc").value.trim(),
          uploadedAt: Date.now(),
          uploadedBy: me.username,
        });
        if (adminMode) await logAudit("document-upload", `Document « ${file.name} » ajouté pour ${container.querySelector("#doc-user").value}`);
        UI.toast("Document ajouté.", "success");
        docs = await load();
        render();
      });

      const findDoc = (id) => docs.find((d) => d.id === id);
      container.querySelectorAll("[data-preview]").forEach((b) => b.addEventListener("click", () => {
        const d = findDoc(b.dataset.preview);
        const uri = `data:${d.mimeType};base64,${d.base64Data}`;
        UI.modal({
          title: d.fileName, wide: true,
          body: d.mimeType.startsWith("image/")
            ? `<img src="${uri}" style="max-width:100%">`
            : `<iframe src="${uri}" style="width:100%;height:65vh;border:none"></iframe>`,
          actions: [{ label: "Fermer", className: "btn", onClick: (close) => close() }],
        });
      }));
      container.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => {
        const d = findDoc(b.dataset.dl);
        const a = document.createElement("a");
        a.href = `data:${d.mimeType};base64,${d.base64Data}`;
        a.download = d.fileName;
        a.click();
      }));
      container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
        const d = findDoc(b.dataset.del);
        UI.confirm({
          title: "Supprimer le document",
          message: `Supprimer définitivement « ${UI.esc(d.fileName)} » ?`,
          confirmLabel: "Supprimer", danger: true,
          onConfirm: async () => {
            await Store.remove("documents", d.id);
            if (adminMode) await logAudit("document-delete", `Document « ${d.fileName} » supprimé`);
            UI.toast("Document supprimé.", "success");
            docs = await load();
            render();
          },
        });
      }));
    };
    render();
  },

  // ==========================================================================
  // Acomptes sur salaire
  // ==========================================================================
  STATUS_LABELS: {
    pending_admin: "En attente de validation",
    completed: "Validé & signé",
    rejected: "Refusé",
  },

  acompteStatusBadge(status) {
    const cls = { pending_admin: "status-pending", completed: "status-approved", rejected: "status-rejected" }[status] || "status-pending";
    return `<span class="status-badge ${cls}">${PagesDocs.STATUS_LABELS[status] || status}</span>`;
  },

  /** Génère le PDF signé de l'acompte (les deux signatures intégrées). */
  generateAcomptePdf(acompte) {
    const doc = new window.jspdf.jsPDF();
    doc.setFontSize(16);
    doc.text("Demande d'acompte sur salaire", 105, 20, { align: "center" });
    doc.setFontSize(11);
    let y = 40;
    const lines = [
      `Collaborateur : ${acompte.userName}`,
      `Matricule : ${App.state.users[acompte.userId]?.matricule || "—"}`,
      `Montant demandé : ${fmtNum(acompte.amount)} €`,
      `Versement souhaité le : ${frDateShort(acompte.date)}`,
      `Demande créée le : ${new Date(acompte.createdAt).toLocaleString("fr-FR")}`,
      `Validée par : ${acompte.adminName || ""} le ${new Date(acompte.processedAt || Date.now()).toLocaleString("fr-FR")}`,
      "",
      "Le collaborateur demande le versement d'un acompte sur salaire du montant",
      "indiqué ci-dessus, à déduire de la prochaine paie. L'employeur accepte cette",
      "demande dans les conditions prévues à l'article L3242-1 du Code du travail.",
    ];
    for (const l of lines) { doc.text(l, 20, y); y += 8; }
    y += 8;
    doc.text("Signature du collaborateur :", 20, y);
    doc.text("Signature du responsable :", 115, y);
    if (acompte.employeeSignature) doc.addImage(acompte.employeeSignature, "PNG", 20, y + 4, 60, 25);
    if (acompte.adminSignature) doc.addImage(acompte.adminSignature, "PNG", 115, y + 4, 60, 25);
    return doc;
  },

  signatureModal({ title, onSigned }) {
    UI.modal({
      title,
      body: `
        <p>Dessinez votre signature ci-dessous :</p>
        <canvas class="sig-canvas" id="sig-canvas" width="500" height="180"></canvas>
        <button class="btn btn-sm" id="sig-clear" style="margin-top:.4rem">Effacer</button>`,
      actions: [
        { label: "Annuler", className: "btn", onClick: (close) => close() },
        {
          label: "Signer", className: "btn btn-primary",
          onClick: (close) => {
            if (window._sigPad.empty) { UI.toast("Signez avant de valider.", "warning"); return; }
            const data = window._sigPad.dataURL();
            close();
            onSigned(data);
          },
        },
      ],
    });
    window._sigPad = new SignaturePad(document.getElementById("sig-canvas"));
    document.getElementById("sig-clear").addEventListener("click", () => window._sigPad.clear());
  },

  // --- Espace collaborateur -----------------------------------------------------
  async acomptes(container) {
    const me = App.state.currentUser;
    const all = Object.values(await Store.list("acomptes"))
      .filter((a) => a.userId === me.username)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
      <div class="card">
        <h2>Demande d'acompte sur salaire</h2>
        <p class="muted">Étape 1 : montant et date — Étape 2 : relecture et signature électronique.
        Votre demande est ensuite transmise au responsable pour contre-signature.</p>
        <div class="form-grid" style="margin-top:.6rem">
          <div class="field"><label>Montant (€)</label><input class="input" id="ac-amount" type="number" min="1" step="0.01"></div>
          <div class="field"><label>Versement souhaité le</label><input class="input" id="ac-date" type="date"></div>
        </div>
        <button class="btn btn-primary" id="ac-next">Continuer → relecture & signature</button>
      </div>
      <div class="card">
        <h3>Historique de mes demandes</h3>
        ${all.length === 0 ? '<p class="muted">Aucune demande d\'acompte.</p>' : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Montant</th><th>Date souhaitée</th><th>Créée le</th><th>Statut</th><th></th></tr></thead>
          <tbody>${all.map((a) => `
            <tr><td><strong>${fmtNum(a.amount)} €</strong></td><td>${frDateShort(a.date)}</td>
              <td>${new Date(a.createdAt).toLocaleDateString("fr-FR")}</td>
              <td>${PagesDocs.acompteStatusBadge(a.status)}</td>
              <td>${a.status === "completed" && a.pdfBase64
                ? `<button class="btn btn-sm" data-dl="${a.id}">⬇ PDF signé</button>` : ""}</td>
            </tr>`).join("")}</tbody>
        </table></div>`}
      </div>`;

    container.querySelector("#ac-next").addEventListener("click", () => {
      const amount = Number(container.querySelector("#ac-amount").value);
      const date = container.querySelector("#ac-date").value;
      if (!amount || amount <= 0 || !date) { UI.toast("Renseignez un montant et une date valides.", "warning"); return; }
      // Étape 2 : relecture + signature.
      UI.modal({
        title: "Étape 2 — Relecture de la demande",
        body: `
          <p>Vous demandez un acompte de <strong>${fmtNum(amount)} €</strong>,
          versé le <strong>${frDateShort(date)}</strong>, déduit de votre prochaine paie.</p>
          <p class="muted">En signant, vous confirmez cette demande.</p>`,
        actions: [
          { label: "Modifier", className: "btn", onClick: (close) => close() },
          {
            label: "Signer la demande", className: "btn btn-primary",
            onClick: (close) => {
              close();
              PagesDocs.signatureModal({
                title: "Signature du collaborateur",
                onSigned: async (signature) => {
                  const id = genId("ac");
                  await Store.set("acomptes", id, {
                    id, userId: me.username, userName: me.name,
                    amount, date, status: "pending_admin",
                    employeeSignature: signature, createdAt: Date.now(),
                  });
                  UI.toast("Demande d'acompte transmise au responsable.", "success");
                  App.navigate("acomptes");
                },
              });
            },
          },
        ],
      });
    });

    container.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => {
      const a = all.find((x) => x.id === b.dataset.dl);
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${a.pdfBase64}`;
      link.download = `acompte-${a.userId}-${a.date}.pdf`;
      link.click();
    }));
  },

  // --- Espace admin -----------------------------------------------------------------
  async acomptesAdmin(container) {
    const all = Object.values(await Store.list("acomptes"))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = `
      <div class="card">
        <h2>Gestion des acomptes sur salaire</h2>
        ${all.length === 0 ? '<p class="muted">Aucune demande d\'acompte.</p>' : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Collaborateur</th><th>Montant</th><th>Date souhaitée</th><th>Créée le</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${all.map((a) => `
            <tr>
              <td><strong>${UI.esc(a.userName)}</strong></td>
              <td>${fmtNum(a.amount)} €</td>
              <td>${frDateShort(a.date)}</td>
              <td>${new Date(a.createdAt).toLocaleDateString("fr-FR")}</td>
              <td>${PagesDocs.acompteStatusBadge(a.status)}</td>
              <td style="white-space:nowrap">
                ${a.status === "pending_admin" ? `
                  <button class="btn btn-sm btn-primary" data-sign="${a.id}">🖋 Contre-signer</button>
                  <button class="btn btn-sm btn-danger" data-reject="${a.id}">✕ Refuser</button>` : ""}
                ${a.status === "completed" && a.pdfBase64 ? `<button class="btn btn-sm" data-dl="${a.id}">⬇ PDF signé</button>` : ""}
              </td>
            </tr>`).join("")}</tbody>
        </table></div>`}
      </div>`;

    container.querySelectorAll("[data-sign]").forEach((b) => b.addEventListener("click", () => {
      const a = all.find((x) => x.id === b.dataset.sign);
      PagesDocs.signatureModal({
        title: `Contre-signature — acompte de ${a.userName} (${fmtNum(a.amount)} €)`,
        onSigned: async (signature) => {
          const updated = {
            ...a, adminSignature: signature, adminName: App.state.currentUser.name,
            processedAt: Date.now(), status: "completed",
          };
          if (!window.jspdf) { UI.toast("Bibliothèque PDF non chargée.", "error"); return; }
          const pdf = PagesDocs.generateAcomptePdf(updated);
          updated.pdfBase64 = pdf.output("datauristring").split(",")[1];
          await Store.set("acomptes", a.id, updated);
          await logAudit("acompte-approve", `Acompte de ${fmtNum(a.amount)} € pour ${a.userName} validé et signé`);
          UI.toast("Acompte validé, PDF signé généré.", "success");
          App.navigate("acomptes-admin");
        },
      });
    }));
    container.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => {
      const a = all.find((x) => x.id === b.dataset.reject);
      UI.confirm({
        title: "Refuser l'acompte",
        message: `Refuser la demande d'acompte de ${UI.esc(a.userName)} (${fmtNum(a.amount)} €) ?`,
        confirmLabel: "Refuser", danger: true,
        onConfirm: async () => {
          await Store.update("acomptes", a.id, { status: "rejected", processedAt: Date.now() });
          await logAudit("acompte-reject", `Acompte de ${fmtNum(a.amount)} € pour ${a.userName} refusé`);
          UI.toast("Demande refusée.", "success");
          App.navigate("acomptes-admin");
        },
      });
    }));
    container.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => {
      const a = all.find((x) => x.id === b.dataset.dl);
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${a.pdfBase64}`;
      link.download = `acompte-${a.userId}-${a.date}.pdf`;
      link.click();
    }));
  },
};

// --- Enregistrement des pages ------------------------------------------------------
Object.assign(window.Pages, {
  "mes-documents": (c) => PagesDocs.renderDocuments(c, { adminMode: false }),
  "documents-admin": (c) => PagesDocs.renderDocuments(c, { adminMode: true }),
  "acomptes": PagesDocs.acomptes,
  "acomptes-admin": PagesDocs.acomptesAdmin,
});
