/* =============================================================================
   SUIVI ANNUALISATION — Couche de données
   =============================================================================
   Abstraction unique au-dessus de deux backends :
   - "firebase" : Firestore + Firebase Authentication (production) ;
   - "demo"     : localStorage (aucun serveur), activé tant que Firebase n'est
                  pas configuré. Les mots de passe y sont hachés (SHA-256 +
                  sel aléatoire) — jamais stockés ni comparés en clair.

   API : Store.init(), Store.signIn(), Store.signOut(), Store.createAccount(),
   Store.get(col, id), Store.set(), Store.update(), Store.remove(),
   Store.list(col), Store.onAuthChange(cb).
   ========================================================================== */

const Store = {
  backend: DEMO_MODE ? "demo" : "firebase",
  _fb: null,           // instance Firestore
  _auth: null,         // instance Firebase Auth
  _authCallback: null,
  _demoUser: null,     // username connecté en mode démo

  // --------------------------------------------------------------------------
  async init() {
    if (this.backend === "firebase") {
      firebase.initializeApp(FIREBASE_CONFIG);
      this._fb = firebase.firestore();
      this._auth = firebase.auth();
      this._auth.onAuthStateChanged((fbUser) => {
        if (!this._authCallback) return;
        this._authCallback(fbUser ? this._usernameFromEmail(fbUser.email) : null);
      });
    } else {
      await this._demoSeed();
      // Restaure la session démo (l'onglet reste connecté après rechargement).
      this._demoUser = sessionStorage.getItem("sa_demo_session") || null;
      setTimeout(() => this._authCallback && this._authCallback(this._demoUser), 0);
    }
  },

  onAuthChange(cb) { this._authCallback = cb; },

  _usernameFromEmail(email) {
    if (!email) return null;
    return email.endsWith("@" + AUTH_EMAIL_DOMAIN) ? email.split("@")[0] : email;
  },

  _emailFromUsername(username) {
    return username.includes("@") ? username : `${username}@${AUTH_EMAIL_DOMAIN}`;
  },

  // --- Authentification -------------------------------------------------------
  async signIn(username, password) {
    username = username.trim().toLowerCase();
    if (this.backend === "firebase") {
      await this._auth.signInWithEmailAndPassword(this._emailFromUsername(username), password);
      return this._usernameFromEmail(this._auth.currentUser.email);
    }
    // Mode démo : vérification du hash local.
    const user = this._demoRead().users?.[username];
    if (!user) throw new Error("Identifiant ou mot de passe incorrect.");
    const hash = await sha256Hex(user.passwordSalt + password);
    if (hash !== user.passwordHash) throw new Error("Identifiant ou mot de passe incorrect.");
    this._demoUser = username;
    sessionStorage.setItem("sa_demo_session", username);
    if (this._authCallback) this._authCallback(username);
    return username;
  },

  async signOut() {
    if (this.backend === "firebase") { await this._auth.signOut(); return; }
    this._demoUser = null;
    sessionStorage.removeItem("sa_demo_session");
    if (this._authCallback) this._authCallback(null);
  },

  /**
   * Crée un compte de connexion (appelé par l'admin depuis Gestion Équipe).
   * En mode Firebase, utilise une application secondaire pour ne pas
   * déconnecter l'admin courant.
   */
  async createAccount(username, password) {
    username = username.trim().toLowerCase();
    if (this.backend === "firebase") {
      const name = "account-creation-" + Date.now();
      const secondary = firebase.initializeApp(FIREBASE_CONFIG, name);
      try {
        await secondary.auth().createUserWithEmailAndPassword(this._emailFromUsername(username), password);
        await secondary.auth().signOut();
      } finally {
        await secondary.delete();
      }
      return;
    }
    // Mode démo : hash + sel.
    const salt = genId("salt");
    const hash = await sha256Hex(salt + password);
    const db = this._demoRead();
    db.users = db.users || {};
    db.users[username] = { ...(db.users[username] || {}), passwordSalt: salt, passwordHash: hash };
    this._demoWrite(db);
  },

  /** Changement de mot de passe (mode démo uniquement, ou soi-même en Firebase). */
  async changePassword(username, newPassword) {
    if (this.backend === "firebase") {
      const current = this._auth.currentUser;
      if (!current || this._usernameFromEmail(current.email) !== username) {
        throw new Error("En mode Firebase, seul l'utilisateur connecté peut changer son mot de passe (ou via la console Firebase).");
      }
      await current.updatePassword(newPassword);
      return;
    }
    await this.createAccount(username, newPassword);
  },

  // --- CRUD documents ---------------------------------------------------------
  async get(col, id) {
    if (this.backend === "firebase") {
      const snap = await this._fb.collection(col).doc(id).get();
      return snap.exists ? snap.data() : null;
    }
    const db = this._demoRead();
    return db[col]?.[id] ? structuredClone(db[col][id]) : null;
  },

  async set(col, id, data, merge = false) {
    if (this.backend === "firebase") {
      await this._fb.collection(col).doc(id).set(data, { merge });
      return;
    }
    const db = this._demoRead();
    db[col] = db[col] || {};
    db[col][id] = merge ? { ...(db[col][id] || {}), ...structuredClone(data) } : structuredClone(data);
    this._demoWrite(db);
  },

  async update(col, id, patch) { return this.set(col, id, patch, true); },

  async remove(col, id) {
    if (this.backend === "firebase") { await this._fb.collection(col).doc(id).delete(); return; }
    const db = this._demoRead();
    if (db[col]) { delete db[col][id]; this._demoWrite(db); }
  },

  /** Liste une collection : retourne { id: data, ... }. */
  async list(col) {
    if (this.backend === "firebase") {
      const snap = await this._fb.collection(col).get();
      const out = {};
      snap.forEach((doc) => { out[doc.id] = doc.data(); });
      return out;
    }
    return structuredClone(this._demoRead()[col] || {});
  },

  // --- Backend démo (localStorage) ---------------------------------------------
  _demoRead() {
    try { return JSON.parse(localStorage.getItem("sa_demo_db") || "{}"); }
    catch { return {}; }
  },

  _demoWrite(db) { localStorage.setItem("sa_demo_db", JSON.stringify(db)); },

  /** Crée le compte admin de démonstration au premier lancement. */
  async _demoSeed() {
    const db = this._demoRead();
    if (db.users && Object.keys(db.users).length) return;
    const salt = genId("salt");
    const hash = await sha256Hex(salt + "admin123");
    const cfg = defaultPeriodConfig();
    db.users = {
      admin: {
        id: "admin", name: "Administrateur (démo)", username: "admin",
        passwordSalt: salt, passwordHash: hash,
        role: "admin", email: "", matricule: "ADM001",
        isCadre: false, hoursTarget: DEFAULT_HOURS_TARGET, daysTarget: DEFAULT_DAYS_TARGET,
        cpDays: DEFAULT_CP_DAYS, cpAnciennete: 0,
        typePlanning: { lundi: 7, mardi: 7, mercredi: 7, jeudi: 7, vendredi: 7, samedi: 0, dimanche: 0 },
      },
    };
    db.settings = {
      periodConfig: cfg,
      holidays: { list: {} },
      openSundays: { list: {} },
      lockedMonths: { list: {} },
      managerAbsences: { list: {} },
      digestLog: { lastSentMs: 0 },
    };
    this._demoWrite(db);
  },
};

/** SHA-256 → chaîne hexadécimale (WebCrypto). */
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* =============================================================================
   Journal d'audit
   ========================================================================== */
async function logAudit(action, message) {
  const id = genId("audit");
  try {
    await Store.set("auditLog", id, {
      id, action, message,
      actor: App.state.currentUser?.username || "système",
      timestamp: Date.now(),
    });
  } catch (e) {
    console.warn("Audit non journalisé :", e);
  }
}

/* =============================================================================
   E-mails transactionnels (EmailJS) — échec propre si non configuré
   ========================================================================== */
function emailConfigured() {
  return EMAILJS_CONFIG.publicKey !== "À_CONFIGURER" && typeof emailjs !== "undefined";
}

/**
 * Envoie un e-mail via EmailJS. Retourne true si envoyé, false sinon
 * (service non configuré ou erreur réseau) — ne bloque jamais l'application.
 */
async function sendEmail(templateKey, params, { silent = false } = {}) {
  if (!emailConfigured()) {
    if (!silent) UI.toast("Service e-mail non configuré : notification non envoyée.", "warning");
    return false;
  }
  try {
    emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templates[templateKey], {
      app_url: APP_URL, manager_email: MANAGER_EMAIL, ...params,
    });
    return true;
  } catch (e) {
    console.error("Échec d'envoi e-mail :", e);
    if (!silent) UI.toast("Échec de l'envoi de l'e-mail de notification.", "error");
    return false;
  }
}
