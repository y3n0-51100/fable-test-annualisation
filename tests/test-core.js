/* =============================================================================
   Tests du cœur métier (js/core.js) — exécutables sans navigateur :
       node tests/test-core.js
   ========================================================================== */

const core = require("../js/core.js");

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ÉCHEC : ${label}`); }
}
function eq(label, actual, expected) {
  assert(`${label} (attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const CFG = { startMonth: 6, startYear: 2026 }; // juin 2026 → mai 2027

// -----------------------------------------------------------------------------
console.log("\n— Période annuelle —");
const bounds = core.periodBounds(CFG);
eq("début de période", core.dateKey(bounds.start), "2026-06-01");
eq("fin de période", core.dateKey(bounds.end), "2027-05-31");
const months = core.periodMonths(CFG);
eq("12 mois générés", months.length, 12);
eq("1er mois", months[0].key, "2026-06");
eq("dernier mois", months[11].key, "2027-05");
eq("ratio à mi-période ~50 %", Math.round(core.elapsedRatio(CFG, new Date(2026, 10, 30)) * 100), 50);
eq("ratio borné avant période", core.elapsedRatio(CFG, new Date(2026, 0, 1)), 0);
eq("ratio borné après période", core.elapsedRatio(CFG, new Date(2028, 0, 1)), 1);
const dflt = core.defaultPeriodConfig(new Date(2026, 6, 11)); // 11 juillet 2026
eq("période par défaut (juillet 2026)", dflt, { startMonth: 6, startYear: 2026 });
eq("période par défaut (mars 2026)", core.defaultPeriodConfig(new Date(2026, 2, 1)), { startMonth: 6, startYear: 2025 });

// -----------------------------------------------------------------------------
console.log("\n— Total réalisé —");
const days = {
  "2026-06-01": { hours: 7, type: "normal" },
  "2026-06-02": { hours: 7, type: "Maladie" },      // compte comme travaillé
  "2026-06-03": { hours: 7, type: "Formation" },    // compte comme travaillé
  "2026-06-04": { hours: 7, type: "CP" },           // NE compte PAS
  "2026-06-05": { hours: 5, type: "Récupération" }, // NE compte PAS
  "2026-06-06": { hours: 4, type: "Autre" },        // NE compte PAS
  "2025-06-01": { hours: 9, type: "normal" },       // hors période
};
eq("Maladie/Formation comptées, CP/Récup/Autre exclues, hors période ignoré",
  core.computeRealized(days, CFG), 21);
eq("réalisé mensuel", core.computeMonthRealized(days, 2026, 6), 21);
eq("comptage des CP", core.countTypeDays(days, CFG, "CP"), 1);

// -----------------------------------------------------------------------------
console.log("\n— Jours ouvrés (dimanche exclu) —");
// Du lundi 1er juin 2026 au dimanche 7 juin 2026 : 6 jours ouvrés.
eq("semaine complète = 6 jours", core.countOpenDays("2026-06-01", "2026-06-07"), 6);
eq("dimanche seul = 0 jour", core.countOpenDays("2026-06-07", "2026-06-07"), 0);
eq("férié fermé exclu si fourni",
  core.openDayKeys("2026-06-01", "2026-06-03", { "2026-06-02": { open: false } }).length, 2);

// -----------------------------------------------------------------------------
console.log("\n— Duplication de mois (occurrence de jour de semaine) —");
eq("occurrence jour 1", core.weekdayOccurrence(1), 1);
eq("occurrence jour 8", core.weekdayOccurrence(8), 2);
eq("occurrence jour 15", core.weekdayOccurrence(15), 3);
// Juin 2026 : le 1er lundi est le 1er. Juillet 2026 : le 1er lundi est le 6.
const dupSrc = {
  "2026-06-01": { hours: 8, type: "normal", note: "ouverture" },
  "2026-07-06": { hours: 0, type: "CP", absenceId: "abs1" }, // cible protégée
};
const dup = core.duplicateMonth(dupSrc, 2026, 6, 2026, 7);
assert("le 1er lundi source n'écrase pas la cible protégée",
  dup.days["2026-07-06"].absenceId === "abs1" && dup.skipped >= 1);
// Le 1er mardi de juin (le 2) → 1er mardi de juillet (le 7).
const dup2 = core.duplicateMonth({ "2026-06-02": { hours: 6.5, type: "normal", note: "" } }, 2026, 6, 2026, 7);
eq("1er mardi juin → 1er mardi juillet", dup2.days["2026-07-07"].hours, 6.5);

// -----------------------------------------------------------------------------
console.log("\n— Planning type hebdomadaire —");
const tpl = { lundi: 7, mardi: 7, mercredi: 0, jeudi: 7, vendredi: 7, samedi: 5, dimanche: 0 };
const withProtected = {
  "2026-06-04": { hours: 0, type: "CP", absenceId: "absX" },
  "2026-06-05": { hours: 0, type: "repos", holidayClosed: true },
};
const applied = core.applyWeeklyTemplate(withProtected, tpl, CFG);
eq("lundi 1er juin = 7 h", applied["2026-06-01"].hours, 7);
eq("mercredi 3 juin = repos", applied["2026-06-03"].type, "repos");
assert("jour avec absenceId non écrasé", applied["2026-06-04"].absenceId === "absX");
assert("férié fermé non écrasé", applied["2026-06-05"].holidayClosed === true);
eq("dimanche 7 juin = 0 h", applied["2026-06-07"].hours, 0);

// -----------------------------------------------------------------------------
console.log("\n— Application / retrait d'absence —");
// CP sur 3 jours (jeudi 4 → samedi 6 juin), avec un férié fermé le vendredi 5.
const before = {
  "2026-06-04": { hours: 7, type: "normal", note: "" },
  "2026-06-05": { hours: 0, type: "repos", holidayClosed: true },
  "2026-06-06": { hours: 5, type: "normal", note: "" },
};
const reqCP = { id: "abs42", type: "CP", date: "2026-06-04", dateEnd: "2026-06-06" };
const resCP = core.applyAbsence(before, reqCP, { "2026-06-05": { open: false } });
eq("jeudi transformé en CP", resCP.days["2026-06-04"].type, "CP");
eq("heures du jeudi mémorisées", resCP.days["2026-06-04"].prevHours, 7);
assert("férié fermé intact", resCP.days["2026-06-05"].holidayClosed === true && !resCP.days["2026-06-05"].absenceId);
eq("samedi transformé en CP", resCP.days["2026-06-06"].type, "CP");
const restored = core.removeAbsence(resCP.days, "abs42");
eq("retrait : heures du jeudi restaurées", restored["2026-06-04"].hours, 7);
eq("retrait : type restauré", restored["2026-06-06"].type, "normal");

// Récupération de 10 h sur 2 jours de 7 h et 5 h.
const reqRec = { id: "rec1", type: "Récupération", date: "2026-06-08", dateEnd: "2026-06-09", hours: 10 };
const beforeRec = {
  "2026-06-08": { hours: 7, type: "normal", note: "" },
  "2026-06-09": { hours: 5, type: "normal", note: "" },
};
const resRec = core.applyAbsence(beforeRec, reqRec, {});
eq("1er jour entièrement déduit → type Récupération", resRec.days["2026-06-08"].type, "Récupération");
eq("1er jour à 0 h", resRec.days["2026-06-08"].hours, 0);
eq("2e jour partiellement déduit : 5-3=2 h", resRec.days["2026-06-09"].hours, 2);
eq("2e jour reste de type normal", resRec.days["2026-06-09"].type, "normal");
eq("aucun reliquat", resRec.leftover, 0);

// -----------------------------------------------------------------------------
console.log("\n— Moteur d'alertes —");
const user = { name: "Test", isCadre: false, hoursTarget: 1607, cpDays: 25, cpAnciennete: 0 };
// Milieu de période (~50 %), attendu ≈ 803 h.
const mid = new Date(2026, 10, 30);
const mkDays = (total) => {
  // Répartit `total` heures sur des jours de 10 h à partir du 1er juin.
  const d = {};
  let rest = total, day = new Date(2026, 5, 1);
  while (rest > 0) {
    if (day.getDay() !== 0) { const h = Math.min(10, rest); d[core.dateKey(day)] = { hours: h, type: "normal" }; rest -= h; }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return d;
};
let alerts = core.computeAlerts(user, {}, CFG, mid);
assert("aucune saisie à 50 % → critique no-entries",
  alerts.some((a) => a.code === "no-entries" && a.level === "critical"));
alerts = core.computeAlerts(user, mkDays(600), CFG, mid); // ~200 h de retard
assert("retard important → critique behind", alerts.some((a) => a.code === "behind"));
alerts = core.computeAlerts(user, mkDays(1700), CFG, mid);
assert("cible dépassée → critique over-target", alerts.some((a) => a.code === "over-target"));
alerts = core.computeAlerts(user, mkDays(900), CFG, mid); // ~+97 h d'avance
assert("avance significative → vigilance ahead", alerts.some((a) => a.code === "ahead" && a.level === "warning"));
assert("récupération à planifier → info plan-recup", alerts.some((a) => a.code === "plan-recup" && a.level === "info"));
// Fin de période (< 90 j), CP non posés.
const late = new Date(2027, 3, 15); // 15 avril 2027
alerts = core.computeAlerts(user, mkDays(1400), CFG, late);
assert("CP non soldés → vigilance cp-unsold", alerts.some((a) => a.code === "cp-unsold"));
// Situation conforme : réalisé ≈ attendu, CP posés.
const okDays = mkDays(800);
let cpCount = 0, d0 = new Date(2026, 5, 1);
// (les CP ne modifient pas le total réalisé, on en pose 20 sur des jours vides)
for (let i = 0; cpCount < 20; i++) {
  const day = new Date(2027, 0, 1 + i);
  if (day.getDay() !== 0) { okDays[core.dateKey(day)] = { hours: 0, type: "CP" }; cpCount++; }
}
alerts = core.computeAlerts(user, okDays, CFG, mid);
eq("situation conforme → aucune alerte", alerts.length, 0);

// -----------------------------------------------------------------------------
console.log("\n— Divers —");
assert("camionnette week-end → stationnement requis",
  core.vanNeedsParking("2026-06-06T10:00", "2026-06-06T18:00")); // samedi
assert("camionnette multi-jours → stationnement requis",
  core.vanNeedsParking("2026-06-01T10:00", "2026-06-02T18:00"));
assert("camionnette 1 jour en semaine → pas de stationnement",
  !core.vanNeedsParking("2026-06-01T10:00", "2026-06-01T18:00"));
assert("jour protégé par absenceId", core.isProtectedDay({ absenceId: "x" }));
assert("jour protégé par férié fermé", core.isProtectedDay({ holidayClosed: true }));
assert("jour normal non protégé", !core.isProtectedDay({ hours: 7, type: "normal" }));

// -----------------------------------------------------------------------------
console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
process.exit(failed ? 1 : 0);
