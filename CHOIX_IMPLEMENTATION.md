# Choix d'implémentation à valider

Points sous-spécifiés dans le cahier des charges, tranchés comme suit
(chacun est facilement ajustable — dites-moi ce que vous souhaitez modifier).

1. **Mode démo local** : tant que Firebase n'est pas configuré, l'app tourne
   sur localStorage (compte `admin`/`admin123`, mots de passe hachés). Permet
   de tester sans aucun compte tiers ; un bandeau l'indique sur l'écran de
   connexion.

2. **Saisie des cadres** : le forfait jours est saisi dans la même grille que
   les heures, mais en **fractions de journée** (0 / 0,5 / 1, pas de 0,5 =
   une demi-journée) avec l'unité « j ». La cible, le réalisé et les alertes
   sont exprimés en jours.

3. **« Récupération disponible »** : interprétée comme l'**avance sur la
   courbe attendue à date** (`réalisé − attendu`, plancher 0), plutôt que
   « au-delà de la cible annuelle » qui serait presque toujours nul en cours
   de période. Le moteur d'alertes utilise la même base.

4. **Seuils d'alerte des cadres** : les seuils en heures (30 h / 14 h) sont
   convertis en jours (4 j / 2 j), les seuils en % restent identiques.

5. **Déduction partielle d'heures (Récupération / Événement familial)** : si
   la déduction vide entièrement la journée, le jour prend le type de
   l'absence ; si elle est partielle, le jour reste « normal » avec les
   heures restantes et une note explicative. L'état antérieur est mémorisé
   (`prevHours`/`prevType`) pour restauration en cas de refus a posteriori.

6. **Cible mensuelle de la synthèse** : cible annuelle ÷ 12 (indicatif),
   plutôt qu'un prorata au nombre de jours ouvrés du mois.

7. **Annuaire visible par tous** : le « Planning Équipe » étant public en
   interne, les fiches (sans aucun secret : l'authentification est dans
   Firebase Auth) et les plannings sont lisibles par tout utilisateur
   authentifié. Une v2 pourrait extraire un annuaire minimal et fermer
   `users/` aux non-admins (noté dans `firestore.rules`).

8. **Gestion des mots de passe en production** : création de compte par
   l'admin via une instance Firebase secondaire (l'admin reste connecté).
   Le SDK client ne permettant pas de changer le mot de passe d'autrui ni de
   supprimer un autre compte Auth, ces deux cas passent par la console
   Firebase — c'est le prix du « zéro serveur » ; une Cloud Function pourrait
   les automatiser plus tard.

9. **ALL RESET** : supprime plannings, demandes (absence + camionnette) et
   annonces ; conserve fiches collaborateurs, réglages, documents, acomptes,
   sauvegardes et historique (le reset est journalisé avant exécution).

10. **Sauvegardes** : un snapshot = un document Firestore contenant le JSON de
    tous les plannings (limite Firestore ~1 Mo ≈ 30-40 collaborateurs sur une
    période ; à découper en plusieurs documents si l'équipe grossit). La purge
    conserve les 10 plus récentes.

11. **Verrouillage de mois** : au mois entier (grille de 12 toggles), pas de
    période partielle — le cahier des charges mentionnait l'option ; le
    modèle (`settings/lockedMonths.list`) permet de l'ajouter ensuite. Les
    admins peuvent toujours éditer un mois verrouillé via « Modifier un
    Planning ».

12. **E-mail « récapitulatif » et snapshot automatique** : déclenchés à la
    connexion d'un admin (pas de serveur pour un cron) ; l'horodatage en base
    (`settings/digestLog`, date du dernier snapshot) garantit le « max 1×/24 h »
    même avec plusieurs admins.

13. **Comptage des jours ouvrés d'une demande CP** : jours hors dimanche,
    conformément à la formule du cahier des charges ; à l'application sur le
    planning, les fériés fermés sont en plus ignorés (jour protégé).

14. **Compression PDF** : rendu des pages à l'échelle 1,3 et réencodage JPEG
    qualité 0,6 via pdf.js + jsPDF. Le PDF compressé devient une suite
    d'images (texte non sélectionnable) — compromis assumé pour tenir la
    limite de ~500 Ko par document en base.

15. **Rafraîchissement des données** : lectures à la navigation et après
    chaque action (pas d'écouteurs temps réel Firestore), pour garder le code
    simple et limiter les lectures facturées ; le badge des demandes en
    attente se met à jour à chaque changement de page.
