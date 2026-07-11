/* =============================================================================
   SUIVI ANNUALISATION — Configuration
   =============================================================================
   Remplacez chaque valeur "À_CONFIGURER" par vos propres identifiants.
   Tant que FIREBASE_CONFIG.apiKey vaut "À_CONFIGURER", l'application démarre
   en MODE DÉMO : les données sont stockées localement dans le navigateur
   (localStorage), sans aucun serveur. Idéal pour tester, à ne PAS utiliser
   en production.
   ========================================================================== */

// --- Firebase (https://console.firebase.google.com) -------------------------
// Créez un projet, activez Firestore + Authentication (Email/Mot de passe),
// puis copiez la configuration web ci-dessous.
const FIREBASE_CONFIG = {
  apiKey: "À_CONFIGURER",
  authDomain: "À_CONFIGURER",
  projectId: "À_CONFIGURER",
  storageBucket: "À_CONFIGURER",
  messagingSenderId: "À_CONFIGURER",
  appId: "À_CONFIGURER",
};

// Les comptes utilisent Firebase Authentication. L'identifiant saisi à la
// connexion est transformé en adresse e-mail technique :
//    <identifiant>@<AUTH_EMAIL_DOMAIN>
// (l'utilisateur peut aussi saisir directement une adresse e-mail complète).
const AUTH_EMAIL_DOMAIN = "suivi-annualisation.app";

// --- EmailJS (https://www.emailjs.com) ---------------------------------------
// Service d'e-mails transactionnels côté client. Créez un service + 4 modèles.
// Chaque modèle reçoit des variables décrites dans le README.
const EMAILJS_CONFIG = {
  publicKey: "À_CONFIGURER",
  serviceId: "À_CONFIGURER",
  templates: {
    absenceRequest: "À_CONFIGURER",   // notification manager : nouvelle demande d'absence
    vanRequest: "À_CONFIGURER",       // notification manager : nouvelle demande de camionnette
    requestResponse: "À_CONFIGURER",  // réponse au collaborateur (approbation/refus)
    adminDigest: "À_CONFIGURER",      // récapitulatif quotidien admin
  },
};

// Adresse e-mail du/des manager(s) recevant les notifications.
const MANAGER_EMAIL = "À_CONFIGURER";

// URL publique de l'application (utilisée dans les e-mails).
const APP_URL = "À_CONFIGURER";

// --- Constantes applicatives -------------------------------------------------
const APP_NAME = "Suivi Annualisation";
const DEFAULT_HOURS_TARGET = 1607; // heures/an, salarié non-cadre
const DEFAULT_DAYS_TARGET = 218;   // jours/an, cadre au forfait jours
const DEFAULT_CP_DAYS = 25;        // congés payés légaux/an
const DOCUMENT_MAX_BYTES = 500 * 1024; // ~500 Ko max par document
const SNAPSHOT_KEEP_COUNT = 10;    // nombre de sauvegardes conservées à la purge
const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 récapitulatif / 24 h max

// Mode démo : vrai tant que Firebase n'est pas configuré.
const DEMO_MODE = FIREBASE_CONFIG.apiKey === "À_CONFIGURER";
