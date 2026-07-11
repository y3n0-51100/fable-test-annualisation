/* =============================================================================
   SUIVI ANNUALISATION — Logique métier (fonctions pures, testables sans UI)
   =============================================================================
   Aucune dépendance au DOM ni à la base de données : ce module peut être
   testé sous Node (voir tests/test-core.js).
   ========================================================================== */

// --- Types de jour -----------------------------------------------------------
const DAY_TYPES = [
  "normal", "repos", "CP", "CP Ancienneté", "Récupération",
  "Événement Familial", "Maladie", "Formation", "Autre",
];

// Un jour dont le type appartient à cet ensemble n'est PAS compté comme
// travaillé. Maladie et Formation comptent comme du temps de travail
// (maintien du cumul).
const NON_WORKED_TYPES = new Set([
  "CP", "CP Ancienneté", "Récupération", "Événement Familial", "Autre",
]);

// Types d'absence saisis en jours entiers vs en heures déductibles.
const ABSENCE_DAY_TYPES = ["CP", "CP Ancienneté"];
const ABSENCE_HOUR_TYPES = ["Récupération", "Événement Familial"];
const ABSENCE_TYPES = [...ABSENCE_DAY_TYPES, ...ABSENCE_HOUR_TYPES];

const WEEKDAY_KEYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// --- Dates -------------------------------------------------------------------
function pad2(n) { return String(n).padStart(2, "0"); }

/** Date → "YYYY-MM-DD" (fuseau local). */
function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM-DD" → Date locale (midi, pour éviter les surprises de DST). */
function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function todayKey() { return dateKey(new Date()); }

/** "YYYY-MM-DD" → "lundi 2 juin 2026". */
function frDateLabel(key) {
  const d = parseKey(key);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function frDateShort(key) {
  const d = parseKey(key);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** (année, mois 1-12) → "Juin 2026". */
function monthLabel(year, month) { return `${MONTH_NAMES_FR[month - 1]} ${year}`; }

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

/** Toutes les clés de dates d'un mois (année, mois 1-12). */
function monthDateKeys(year, month) {
  const keys = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) keys.push(`${year}-${pad2(month)}-${pad2(d)}`);
  return keys;
}

/** Occurrence du jour de semaine dans le mois : 1er lundi → 1, 2e lundi → 2… */
function weekdayOccurrence(dayOfMonth) { return Math.ceil(dayOfMonth / 7); }

// --- Période annuelle --------------------------------------------------------
/**
 * Configuration par défaut de la période : juin N → mai N+1, N étant choisi
 * pour que la date du jour tombe dans la période.
 */
function defaultPeriodConfig(today = new Date()) {
  const startMonth = 6; // juin
  const startYear = (today.getMonth() + 1) >= startMonth ? today.getFullYear() : today.getFullYear() - 1;
  return { startMonth, startYear };
}

/** Bornes de la période (dates incluses). */
function periodBounds(cfg) {
  const start = new Date(cfg.startYear, cfg.startMonth - 1, 1, 12);
  const end = new Date(cfg.startYear, cfg.startMonth - 1 + 12, 0, 12); // dernier jour du 12e mois
  return { start, end };
}

/** Les 12 mois de la période : [{year, month (1-12), key "YYYY-MM", label}]. */
function periodMonths(cfg) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(cfg.startYear, cfg.startMonth - 1 + i, 1, 12);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    months.push({ year, month, key: `${year}-${pad2(month)}`, label: monthLabel(year, month) });
  }
  return months;
}

/** % de période écoulée, borné [0, 1]. */
function elapsedRatio(cfg, today = new Date()) {
  const { start, end } = periodBounds(cfg);
  const ratio = (today - start) / (end - start);
  return Math.min(1, Math.max(0, ratio));
}

/** Nombre de jours restants avant la fin de période (≥ 0). */
function daysToPeriodEnd(cfg, today = new Date()) {
  const { end } = periodBounds(cfg);
  return Math.max(0, Math.round((end - today) / 86400000));
}

/** Une clé de date appartient-elle à la période ? */
function isInPeriod(key, cfg) {
  const { start, end } = periodBounds(cfg);
  const d = parseKey(key);
  return d >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) &&
         d <= new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59);
}

// --- Calculs d'heures --------------------------------------------------------
/**
 * Total réalisé sur la période : somme des heures (ou demi-journées pour un
 * cadre) des jours dont le type n'est pas dans NON_WORKED_TYPES.
 */
function computeRealized(days, cfg) {
  let total = 0;
  for (const [key, day] of Object.entries(days || {})) {
    if (!isInPeriod(key, cfg)) continue;
    if (NON_WORKED_TYPES.has(day.type)) continue;
    total += Number(day.hours) || 0;
  }
  return Math.round(total * 100) / 100;
}

/** Total réalisé sur un mois donné (année, mois 1-12). */
function computeMonthRealized(days, year, month) {
  let total = 0;
  const prefix = `${year}-${pad2(month)}-`;
  for (const [key, day] of Object.entries(days || {})) {
    if (!key.startsWith(prefix)) continue;
    if (NON_WORKED_TYPES.has(day.type)) continue;
    total += Number(day.hours) || 0;
  }
  return Math.round(total * 100) / 100;
}

/** Nombre de jours d'un type donné posés sur la période. */
function countTypeDays(days, cfg, type) {
  let n = 0;
  for (const [key, day] of Object.entries(days || {})) {
    if (isInPeriod(key, cfg) && day.type === type) n++;
  }
  return n;
}

/** Cible annuelle d'un utilisateur (heures ou jours selon statut cadre). */
function userTarget(user) {
  return user.isCadre
    ? (Number(user.daysTarget) || DEFAULT_DAYS_TARGET)
    : (Number(user.hoursTarget) || DEFAULT_HOURS_TARGET);
}

/** Unité d'affichage : "h" ou "j" (cadre au forfait jours). */
function userUnit(user) { return user.isCadre ? "j" : "h"; }

/**
 * Statistiques complètes d'un collaborateur sur la période.
 * Retourne un objet consommé par le tableau de bord et le moteur d'alertes.
 */
function computeStats(user, days, cfg, today = new Date()) {
  const target = userTarget(user);
  const ratio = elapsedRatio(cfg, today);
  const realized = computeRealized(days, cfg);
  const expected = Math.round(target * ratio * 100) / 100;
  const cpDays = Number(user.cpDays) || 0;
  const cpAnc = Number(user.cpAnciennete) || 0;
  const cpUsed = countTypeDays(days, cfg, "CP");
  const cpAncUsed = countTypeDays(days, cfg, "CP Ancienneté");
  const hasEntries = Object.keys(days || {}).some(
    (k) => isInPeriod(k, cfg) && ((Number(days[k].hours) || 0) > 0 || days[k].type !== "normal")
  );
  return {
    target, realized, expected,
    remaining: Math.round((target - realized) * 100) / 100,
    ecart: Math.round((realized - expected) * 100) / 100,
    progressPct: target > 0 ? Math.min(100, Math.round((realized / target) * 100)) : 0,
    elapsedPct: Math.round(ratio * 100),
    cpDays, cpUsed, cpRemaining: cpDays - cpUsed,
    cpAnc, cpAncUsed, cpAncRemaining: cpAnc - cpAncUsed,
    // Heures de récupération disponibles = avance sur la courbe attendue à
    // date (choix d'implémentation : « au-delà de la cible » proratisée).
    recupAvailable: Math.max(0, Math.round((realized - expected) * 100) / 100),
    recupPlanned: countTypeDays(days, cfg, "Récupération") > 0,
    hasEntries,
    daysToEnd: daysToPeriodEnd(cfg, today),
    unit: userUnit(user),
  };
}

// --- Moteur d'alertes --------------------------------------------------------
/**
 * Règles d'alertes d'annualisation pour un collaborateur.
 * Retourne [{level: "critical"|"warning"|"info", code, message}] ;
 * tableau vide = conforme.
 * Les seuils en heures sont convertis en jours pour les cadres (30 h ≈ 4 j,
 * 14 h ≈ 2 j) — choix d'implémentation documenté.
 */
function computeAlerts(user, days, cfg, today = new Date()) {
  const s = computeStats(user, days, cfg, today);
  const alerts = [];
  const u = s.unit;
  const bigGap = user.isCadre ? Math.max(4, 0.05 * s.target) : Math.max(30, 0.05 * s.target);
  const aheadGap = user.isCadre ? Math.max(4, 0.04 * s.target) : Math.max(30, 0.04 * s.target);
  const recupGap = user.isCadre ? 2 : 14;

  // 🔴 Aucune saisie alors que la période est entamée à ≥ 10 %.
  if (!s.hasEntries && s.elapsedPct >= 10) {
    alerts.push({
      level: "critical", code: "no-entries",
      message: `Aucune saisie de planning alors que ${s.elapsedPct} % de la période est écoulée.`,
    });
    return alerts; // les autres règles n'ont pas de sens sans saisie
  }

  // 🔴 Dépassement de la cible annuelle déjà atteint.
  if (s.realized > s.target) {
    alerts.push({
      level: "critical", code: "over-target",
      message: `Cible annuelle déjà dépassée : ${s.realized}${u} réalisés pour ${s.target}${u} (+${Math.round((s.realized - s.target) * 100) / 100}${u}).`,
    });
  }

  // 🔴 Retard important sur la courbe attendue.
  if (s.ecart <= -bigGap) {
    alerts.push({
      level: "critical", code: "behind",
      message: `Retard important : ${s.realized}${u} réalisés pour ${s.expected}${u} attendus (écart ${s.ecart}${u}).`,
    });
  }

  // 🟠 Avance significative sans avoir dépassé la cible.
  if (s.ecart >= aheadGap && s.realized <= s.target) {
    alerts.push({
      level: "warning", code: "ahead",
      message: `Avance significative : +${s.ecart}${u} par rapport à l'attendu — risque d'heures non récupérées.`,
    });
  }

  // 🟠 CP non soldés à l'approche de la fin de période.
  if (s.daysToEnd <= 90 && s.cpDays > 0 && s.cpUsed < 0.7 * s.cpDays) {
    alerts.push({
      level: "warning", code: "cp-unsold",
      message: `CP non soldés : ${s.cpUsed}/${s.cpDays} jours posés à ${s.daysToEnd} jours de la fin de période.`,
    });
  }

  // 🟠 Idem CP ancienneté.
  if (s.daysToEnd <= 90 && s.cpAnc > 0 && s.cpAncUsed < 0.7 * s.cpAnc) {
    alerts.push({
      level: "warning", code: "cpanc-unsold",
      message: `CP ancienneté non soldés : ${s.cpAncUsed}/${s.cpAnc} jours posés à ${s.daysToEnd} jours de la fin de période.`,
    });
  }

  // 🔵 Récupération à planifier.
  if (s.ecart >= recupGap && !s.recupPlanned) {
    alerts.push({
      level: "info", code: "plan-recup",
      message: `+${s.ecart}${u} d'avance et aucune récupération posée : planifier une récupération.`,
    });
  }

  return alerts;
}

// --- Jours ouvrés ------------------------------------------------------------
/**
 * Clés des jours ouvrés entre deux dates incluses (dimanche exclu).
 * `holidays` (optionnel) : map { "YYYY-MM-DD": {open: boolean} } — les fériés
 * fermés sont exclus du décompte s'il est fourni.
 */
function openDayKeys(startKey, endKey, holidays) {
  const keys = [];
  let d = parseKey(startKey);
  const end = parseKey(endKey || startKey);
  while (d <= end) {
    const key = dateKey(d);
    const isSunday = d.getDay() === 0;
    const closedHoliday = holidays && holidays[key] && holidays[key].open === false;
    if (!isSunday && !closedHoliday) keys.push(key);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12);
  }
  return keys;
}

/** Nombre de jours ouvrés (hors dimanche) sur une plage. */
function countOpenDays(startKey, endKey) { return openDayKeys(startKey, endKey).length; }

// --- Écritures de planning non destructives -----------------------------------
/** Un jour est-il protégé contre l'écrasement automatique ? */
function isProtectedDay(day) {
  return !!(day && (day.absenceId || day.holidayClosed));
}

/**
 * Applique le planning type hebdomadaire sur toutes les dates de la période.
 * Ne touche jamais aux jours protégés (absence validée / férié fermé).
 * Retourne le nouvel objet `days` (copie).
 */
function applyWeeklyTemplate(days, typePlanning, cfg) {
  const out = { ...(days || {}) };
  for (const m of periodMonths(cfg)) {
    for (const key of monthDateKeys(m.year, m.month)) {
      if (isProtectedDay(out[key])) continue;
      const weekday = WEEKDAY_KEYS[parseKey(key).getDay()];
      const hours = Number(typePlanning?.[weekday]) || 0;
      out[key] = { hours, type: hours > 0 ? "normal" : "repos", note: out[key]?.note || "" };
    }
  }
  return out;
}

/**
 * Duplication de mois : copie le planning d'un mois source vers un mois cible
 * en appariant les jours par (jour de semaine, numéro d'occurrence dans le
 * mois) — le 1er lundi source va sur le 1er lundi cible, etc.
 * Les jours cibles protégés ne sont jamais écrasés.
 * Retourne { days: nouvel objet, copied: n, skipped: n }.
 */
function duplicateMonth(days, srcYear, srcMonth, tgtYear, tgtMonth) {
  const source = {}; // "weekday-occurrence" → entrée source
  for (const key of monthDateKeys(srcYear, srcMonth)) {
    const d = parseKey(key);
    source[`${d.getDay()}-${weekdayOccurrence(d.getDate())}`] = days?.[key];
  }
  const out = { ...(days || {}) };
  let copied = 0, skipped = 0;
  for (const key of monthDateKeys(tgtYear, tgtMonth)) {
    const d = parseKey(key);
    const src = source[`${d.getDay()}-${weekdayOccurrence(d.getDate())}`];
    if (src === undefined) continue;
    if (isProtectedDay(out[key])) { skipped++; continue; }
    out[key] = { hours: Number(src.hours) || 0, type: src.type || "normal", note: src.note || "" };
    copied++;
  }
  return { days: out, copied, skipped };
}

// --- Application / retrait d'une absence approuvée -----------------------------
/**
 * Applique une demande d'absence approuvée sur un planning.
 * - Types « au jour » (CP, CP Ancienneté) : remplace les journées ouvrées
 *   entières de la plage (0 h, type de l'absence).
 * - Types « déductibles » (Récupération, Événement Familial) : déduit le
 *   nombre d'heures demandé des jours de la plage, séquentiellement.
 * L'état précédent de chaque jour est mémorisé (prevHours/prevType) pour
 * permettre une restauration au refus/annulation.
 * Retourne { days, applied: [clés modifiées], leftover: heures non déduites }.
 */
function applyAbsence(days, request, holidays) {
  const out = { ...(days || {}) };
  const applied = [];
  const keys = openDayKeys(request.date, request.dateEnd || request.date, holidays);
  let leftover = 0;

  if (ABSENCE_DAY_TYPES.includes(request.type)) {
    for (const key of keys) {
      if (out[key]?.holidayClosed) continue; // ne jamais écraser un férié fermé
      const prev = out[key] || { hours: 0, type: "normal", note: "" };
      out[key] = {
        hours: 0, type: request.type, note: prev.note || "",
        absenceId: request.id, prevHours: Number(prev.hours) || 0, prevType: prev.type || "normal",
      };
      applied.push(key);
    }
  } else {
    let remaining = Number(request.hours) || 0;
    for (const key of keys) {
      if (remaining <= 0) break;
      if (out[key]?.holidayClosed) continue;
      const prev = out[key] || { hours: 0, type: "normal", note: "" };
      const planned = Number(prev.hours) || 0;
      const deducted = Math.min(planned, remaining);
      remaining = Math.round((remaining - deducted) * 100) / 100;
      const newHours = Math.round((planned - deducted) * 100) / 100;
      out[key] = {
        hours: newHours,
        // journée entièrement déduite → type de l'absence ; déduction
        // partielle → le jour reste "normal" avec les heures restantes.
        type: newHours === 0 ? request.type : (prev.type || "normal"),
        note: prev.note ? `${prev.note} · ${request.type} -${deducted}h` : `${request.type} -${deducted}h`,
        absenceId: request.id, prevHours: planned, prevType: prev.type || "normal",
      };
      applied.push(key);
    }
    leftover = remaining;
  }
  return { days: out, applied, leftover };
}

/**
 * Retire d'un planning toutes les entrées générées par une demande d'absence
 * (au refus ou à l'annulation d'une demande déjà appliquée) en restaurant
 * l'état antérieur mémorisé. Retourne le nouvel objet `days`.
 */
function removeAbsence(days, absenceId) {
  const out = { ...(days || {}) };
  for (const [key, day] of Object.entries(out)) {
    if (day.absenceId !== absenceId) continue;
    out[key] = { hours: day.prevHours ?? 0, type: day.prevType || "normal", note: "" };
  }
  return out;
}

// --- Divers ------------------------------------------------------------------
/** Formatte un nombre d'heures/jours : 7 → "7", 7.5 → "7,5". */
function fmtNum(n) {
  return (Math.round(Number(n) * 100) / 100).toLocaleString("fr-FR");
}

/** Une demande de camionnette nécessite-t-elle le lieu de stationnement ? */
function vanNeedsParking(dateStart, dateEnd) {
  const start = new Date(dateStart), end = new Date(dateEnd || dateStart);
  if (dateKey(start) !== dateKey(end)) return true; // multi-jours
  const wd = start.getDay();
  return wd === 0 || wd === 6; // week-end
}

/** Génère un identifiant unique lisible. */
function genId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Export Node (tests) — sans effet dans le navigateur.
if (typeof module !== "undefined" && module.exports) {
  // Constantes de config nécessaires aux tests hors navigateur.
  global.DEFAULT_HOURS_TARGET = typeof DEFAULT_HOURS_TARGET !== "undefined" ? DEFAULT_HOURS_TARGET : 1607;
  global.DEFAULT_DAYS_TARGET = typeof DEFAULT_DAYS_TARGET !== "undefined" ? DEFAULT_DAYS_TARGET : 218;
  module.exports = {
    DAY_TYPES, NON_WORKED_TYPES, ABSENCE_DAY_TYPES, ABSENCE_HOUR_TYPES, ABSENCE_TYPES,
    WEEKDAY_KEYS, MONTH_NAMES_FR,
    pad2, dateKey, parseKey, todayKey, frDateLabel, frDateShort, monthLabel,
    daysInMonth, monthDateKeys, weekdayOccurrence,
    defaultPeriodConfig, periodBounds, periodMonths, elapsedRatio, daysToPeriodEnd, isInPeriod,
    computeRealized, computeMonthRealized, countTypeDays, userTarget, userUnit,
    computeStats, computeAlerts,
    openDayKeys, countOpenDays, isProtectedDay,
    applyWeeklyTemplate, duplicateMonth, applyAbsence, removeAbsence,
    fmtNum, vanNeedsParking, genId,
  };
}
