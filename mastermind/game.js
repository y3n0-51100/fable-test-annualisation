/* ============================================================
   Mastermind — Duel de couleurs
   Logique de jeu (vanilla JS, aucune dépendance).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Préréglages de difficulté ----------
     slots  = nombre d'emplacements dans le code
     colors = nombre de couleurs disponibles
     tries  = nombre d'essais autorisés                        */
  var DIFFICULTIES = {
    facile:    { slots: 4, colors: 6, tries: 12, label: "Facile" },
    classique: { slots: 4, colors: 6, tries: 10, label: "Classique" },
    difficile: { slots: 5, colors: 7, tries: 10, label: "Difficile" },
    expert:    { slots: 5, colors: 8, tries: 8,  label: "Expert" }
  };

  /* ---------- État global de la partie ---------- */
  var state = {
    mode: "solo",            // "solo" | "duo"
    difficulty: "classique",
    duplicates: true,
    slots: 4,
    colors: 6,
    tries: 10,
    secret: [],              // combinaison à trouver (indices de couleur 1..colors)
    guesses: [],             // historique des essais validés
    current: [],             // essai en cours de composition
    activeSlot: 0,           // emplacement ciblé
    selectedColor: 1,        // couleur choisie dans la palette
    coderDraft: [],          // brouillon du Joueur 1 (mode duo)
    finished: false
  };

  /* ---------- Raccourcis DOM ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  /* ============================================================
     SON — petits bips générés via Web Audio (aucun fichier)
     ============================================================ */
  var Sound = {
    on: true,
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { this.on = false; }
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    beep: function (freq, dur, type, vol) {
      if (!this.on) return;
      this.ensure();
      if (!this.ctx) return;
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.value = vol == null ? 0.06 : vol;
      o.connect(g); g.connect(this.ctx.destination);
      var t = this.ctx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.12));
      o.start(t); o.stop(t + (dur || 0.12));
    },
    pick:   function () { this.beep(520, 0.08, "triangle"); },
    place:  function () { this.beep(680, 0.09, "sine"); },
    submit: function () { this.beep(440, 0.1, "square", 0.04); },
    error:  function () { this.beep(160, 0.18, "sawtooth", 0.05); },
    win:    function () { var self = this; [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { self.beep(f, 0.18, "triangle", 0.07); }, i * 120); }); },
    lose:   function () { var self = this; [392, 330, 262].forEach(function (f, i) { setTimeout(function () { self.beep(f, 0.22, "sine", 0.06); }, i * 160); }); }
  };

  /* ============================================================
     NAVIGATION entre écrans
     ============================================================ */
  function showScreen(id) {
    $$(".screen").forEach(function (s) { s.classList.remove("is-active"); });
    var target = $("#screen-" + id);
    if (target) target.classList.add("is-active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ============================================================
     ÉCRAN RÉGLAGES
     ============================================================ */
  function updateSetupSummary() {
    var d = DIFFICULTIES[state.difficulty];
    $("#setupSummary").innerHTML =
      "<b>" + d.slots + "</b> emplacements &nbsp;•&nbsp; <b>" + d.colors +
      "</b> couleurs &nbsp;•&nbsp; <b>" + d.tries + "</b> essais";
  }

  function bindSetup() {
    $$("#difficultyRow .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        $$("#difficultyRow .chip").forEach(function (c) { c.classList.remove("is-selected"); });
        chip.classList.add("is-selected");
        state.difficulty = chip.getAttribute("data-diff");
        updateSetupSummary();
        Sound.pick();
      });
    });

    var dup = $("#dupToggle");
    dup.addEventListener("click", function () {
      state.duplicates = !state.duplicates;
      dup.setAttribute("aria-checked", state.duplicates ? "true" : "false");
      Sound.pick();
    });

    $("#startGameBtn").addEventListener("click", function () {
      applyDifficulty();
      Sound.submit();
      if (state.mode === "duo") startCoderScreen();
      else startSoloGame();
    });
  }

  function applyDifficulty() {
    var d = DIFFICULTIES[state.difficulty];
    state.slots = d.slots;
    state.colors = d.colors;
    state.tries = d.tries;
    // Sans doublons, il faut au moins autant de couleurs que d'emplacements.
    if (!state.duplicates && state.colors < state.slots) state.duplicates = true;
  }

  /* ============================================================
     PALETTE (réutilisée sur plusieurs écrans)
     ============================================================ */
  function buildPalette(container, onPick) {
    container.innerHTML = "";
    for (var i = 1; i <= state.colors; i++) {
      (function (color) {
        var p = el("button", "pick c" + color);
        p.setAttribute("aria-label", "Couleur " + color);
        p.addEventListener("click", function () { onPick(color, p, container); });
        container.appendChild(p);
      })(i);
    }
  }

  function markSelected(container, node) {
    $$(".pick", container).forEach(function (p) { p.classList.remove("is-selected"); });
    if (node) node.classList.add("is-selected");
  }

  /* ============================================================
     MODE DUO — Écran du codeur (Joueur 1)
     ============================================================ */
  function startCoderScreen() {
    state.coderDraft = new Array(state.slots).fill(0);
    state.selectedColor = 1;

    var slots = $("#secretSlots");
    slots.innerHTML = "";
    for (var i = 0; i < state.slots; i++) {
      (function (idx) {
        var s = el("div", "slot");
        s.addEventListener("click", function () { placeCoderPeg(idx); });
        slots.appendChild(s);
      })(i);
    }

    buildPalette($("#coderPalette"), function (color, node, container) {
      state.selectedColor = color;
      markSelected(container, node);
      Sound.pick();
    });
    // pré-sélectionne la première couleur
    markSelected($("#coderPalette"), $(".pick", $("#coderPalette")));

    refreshCoderSlots();
    showScreen("coder");
  }

  function placeCoderPeg(idx) {
    if (!state.duplicates) {
      // interdit la même couleur ailleurs
      var existing = state.coderDraft.indexOf(state.selectedColor);
      if (existing !== -1 && existing !== idx) state.coderDraft[existing] = 0;
    }
    state.coderDraft[idx] = state.selectedColor;
    Sound.place();
    refreshCoderSlots();
  }

  function refreshCoderSlots() {
    var nodes = $$("#secretSlots .slot");
    nodes.forEach(function (s, i) {
      s.innerHTML = "";
      s.classList.remove("filled");
      if (state.coderDraft[i]) {
        s.classList.add("filled");
        var peg = el("div", "peg c" + state.coderDraft[i]);
        s.appendChild(peg);
      }
    });
    var complete = state.coderDraft.every(function (v) { return v > 0; });
    $("#coderConfirmBtn").disabled = !complete;
  }

  function bindCoder() {
    $("#coderClearBtn").addEventListener("click", function () {
      state.coderDraft = new Array(state.slots).fill(0);
      refreshCoderSlots();
      Sound.error();
    });
    $("#coderRandomBtn").addEventListener("click", function () {
      state.coderDraft = randomCode();
      refreshCoderSlots();
      Sound.place();
    });
    $("#coderConfirmBtn").addEventListener("click", function () {
      state.secret = state.coderDraft.slice();
      Sound.submit();
      showScreen("handoff");
    });
    $("#handoffBtn").addEventListener("click", function () {
      Sound.submit();
      beginPlay();
    });
  }

  /* ============================================================
     MODE SOLO — code généré par l'ordinateur
     ============================================================ */
  function randomCode() {
    var code = [];
    if (state.duplicates) {
      for (var i = 0; i < state.slots; i++) {
        code.push(1 + Math.floor(Math.random() * state.colors));
      }
    } else {
      var pool = [];
      for (var c = 1; c <= state.colors; c++) pool.push(c);
      for (var j = pool.length - 1; j > 0; j--) {
        var k = Math.floor(Math.random() * (j + 1));
        var tmp = pool[j]; pool[j] = pool[k]; pool[k] = tmp;
      }
      code = pool.slice(0, state.slots);
    }
    return code;
  }

  function startSoloGame() {
    state.secret = randomCode();
    beginPlay();
  }

  /* ============================================================
     ÉCRAN DE JEU
     ============================================================ */
  function beginPlay() {
    state.guesses = [];
    state.current = new Array(state.slots).fill(0);
    state.activeSlot = 0;
    state.selectedColor = 1;
    state.finished = false;

    $("#attemptMax").textContent = state.tries;
    $("#attemptCur").textContent = 1;

    buildBoard();
    buildCurrentGuess();
    buildPalette($("#playPalette"), function (color, node, container) {
      state.selectedColor = color;
      markSelected(container, node);
      Sound.pick();
    });
    markSelected($("#playPalette"), $(".pick", $("#playPalette")));

    refreshCurrentGuess();
    showScreen("play");
  }

  function buildBoard() {
    var board = $("#board");
    board.innerHTML = "";
    for (var r = 0; r < state.tries; r++) {
      var row = el("div", "row");
      row.setAttribute("data-row", r);
      var num = el("div", "row-num"); num.textContent = r + 1;
      var pegs = el("div", "row-pegs");
      for (var c = 0; c < state.slots; c++) pegs.appendChild(el("div", "mini"));
      var hints = el("div", "hints");
      for (var h = 0; h < state.slots; h++) hints.appendChild(el("div", "hint"));
      row.appendChild(num); row.appendChild(pegs); row.appendChild(hints);
      board.appendChild(row);
    }
  }

  function buildCurrentGuess() {
    var wrap = $("#currentGuess");
    wrap.innerHTML = "";
    for (var i = 0; i < state.slots; i++) {
      (function (idx) {
        var s = el("div", "slot");
        s.addEventListener("click", function () { placeGuessPeg(idx); });
        wrap.appendChild(s);
      })(i);
    }
  }

  function placeGuessPeg(idx) {
    if (state.finished) return;
    if (!state.duplicates) {
      var existing = state.current.indexOf(state.selectedColor);
      if (existing !== -1 && existing !== idx) state.current[existing] = 0;
    }
    state.current[idx] = state.selectedColor;
    // avance automatiquement vers le prochain emplacement vide
    var next = state.current.indexOf(0);
    state.activeSlot = next === -1 ? idx : next;
    Sound.place();
    refreshCurrentGuess();
  }

  function refreshCurrentGuess() {
    var nodes = $$("#currentGuess .slot");
    nodes.forEach(function (s, i) {
      s.innerHTML = "";
      s.classList.remove("filled", "is-target");
      if (state.current[i]) {
        s.classList.add("filled");
        s.appendChild(el("div", "peg c" + state.current[i]));
      }
      if (i === state.activeSlot) s.classList.add("is-target");
    });
    var complete = state.current.every(function (v) { return v > 0; });
    $("#guessSubmitBtn").disabled = !complete;
  }

  function bindPlay() {
    $("#guessClearBtn").addEventListener("click", function () {
      if (state.finished) return;
      state.current = new Array(state.slots).fill(0);
      state.activeSlot = 0;
      refreshCurrentGuess();
      Sound.error();
    });
    $("#guessSubmitBtn").addEventListener("click", submitGuess);
    $("#hintLegendBtn").addEventListener("click", openLegend);
  }

  /* ---------- Cœur du jeu : calcul des indices ----------
     exact  = bonne couleur au bon endroit (clou noir/vert)
     color  = bonne couleur au mauvais endroit (clou blanc)   */
  function evaluate(guess, secret) {
    var exact = 0, color = 0;
    var secretRest = [], guessRest = [];
    for (var i = 0; i < secret.length; i++) {
      if (guess[i] === secret[i]) {
        exact++;
      } else {
        secretRest.push(secret[i]);
        guessRest.push(guess[i]);
      }
    }
    for (var g = 0; g < guessRest.length; g++) {
      var pos = secretRest.indexOf(guessRest[g]);
      if (pos !== -1) {
        color++;
        secretRest.splice(pos, 1);
      }
    }
    return { exact: exact, color: color };
  }

  function submitGuess() {
    if (state.finished) return;
    var complete = state.current.every(function (v) { return v > 0; });
    if (!complete) { shakeCurrent(); Sound.error(); return; }

    var guess = state.current.slice();
    var result = evaluate(guess, state.secret);
    var rowIndex = state.guesses.length;
    state.guesses.push({ guess: guess, result: result });

    renderRow(rowIndex, guess, result);
    Sound.submit();

    var won = result.exact === state.slots;
    var lost = !won && state.guesses.length >= state.tries;

    if (won || lost) {
      state.finished = true;
      setTimeout(function () { endGame(won); }, 700);
      return;
    }

    // essai suivant
    state.current = new Array(state.slots).fill(0);
    state.activeSlot = 0;
    $("#attemptCur").textContent = state.guesses.length + 1;
    refreshCurrentGuess();
  }

  function renderRow(index, guess, result) {
    var row = $('.row[data-row="' + index + '"]');
    if (!row) return;
    row.classList.add("is-done", "reveal-anim");
    var minis = $$(".mini", row);
    minis.forEach(function (m, i) {
      m.classList.add("filled", "c" + guess[i]);
      m.style.animationDelay = (i * 0.06) + "s";
    });
    var hints = $$(".hint", row);
    // Affiche d'abord les exacts, puis les couleurs, après l'animation des pions.
    setTimeout(function () {
      var hi = 0;
      for (var e = 0; e < result.exact; e++) hints[hi++].classList.add("exact");
      for (var c = 0; c < result.color; c++) hints[hi++].classList.add("color");
    }, 380);
  }

  function shakeCurrent() {
    var g = $("#currentGuess");
    g.classList.remove("shake");
    void g.offsetWidth; // relance l'animation
    g.classList.add("shake");
  }

  /* ============================================================
     FIN DE PARTIE
     ============================================================ */
  function endGame(won) {
    var emoji = $("#endEmoji");
    var title = $("#endTitle");
    var text = $("#endText");

    title.classList.remove("win", "lose");
    if (won) {
      emoji.textContent = ["🎉", "🏆", "🥳", "✨"][Math.floor(Math.random() * 4)];
      title.textContent = "Gagné !";
      title.classList.add("win");
      var n = state.guesses.length;
      var perf = n <= Math.ceil(state.tries / 2) ? "Chapeau, quelle vista !" : "Bien joué !";
      text.innerHTML = perf + "<br>Code percé en <b>" + n + "</b> essai" + (n > 1 ? "s" : "") + ".";
      Sound.win();
      launchConfetti();
    } else {
      emoji.textContent = "😵‍💫";
      title.textContent = "Perdu…";
      title.classList.add("lose");
      text.innerHTML = "Le mystère reste entier. La prochaine sera la bonne !";
      Sound.lose();
    }

    // révèle le code secret
    var reveal = $("#revealSlots");
    reveal.innerHTML = "";
    state.secret.forEach(function (color, i) {
      var s = el("div", "slot filled");
      var peg = el("div", "peg c" + color);
      peg.style.animationDelay = (i * 0.09) + "s";
      s.appendChild(peg);
      reveal.appendChild(s);
    });

    showScreen("end");
  }

  function bindEnd() {
    $("#endReplayBtn").addEventListener("click", function () {
      Sound.submit();
      applyDifficulty();
      if (state.mode === "duo") startCoderScreen();
      else startSoloGame();
    });
    $("#endHomeBtn").addEventListener("click", function () {
      Sound.pick();
      showScreen("home");
    });
  }

  /* ============================================================
     CONFETTIS (canvas)
     ============================================================ */
  var confettiCanvas, confettiCtx, confettiPieces = [], confettiRAF = null;
  function launchConfetti() {
    confettiCanvas = $("#confetti");
    confettiCtx = confettiCanvas.getContext("2d");
    resizeConfetti();
    var colors = ["#ff4d6d", "#4d9bff", "#35d07f", "#ffd23f", "#b06bff", "#ff9f43", "#2ee6d6", "#ff77e9"];
    confettiPieces = [];
    for (var i = 0; i < 140; i++) {
      confettiPieces.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * confettiCanvas.height,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        vy: 2 + Math.random() * 4,
        vx: -1.5 + Math.random() * 3,
        rot: Math.random() * Math.PI,
        vr: -0.15 + Math.random() * 0.3
      });
    }
    if (confettiRAF) cancelAnimationFrame(confettiRAF);
    var start = Date.now();
    (function frame() {
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      confettiPieces.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        confettiCtx.restore();
      });
      if (Date.now() - start < 4000) {
        confettiRAF = requestAnimationFrame(frame);
      } else {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      }
    })();
  }
  function resizeConfetti() {
    if (!confettiCanvas) return;
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeConfetti);

  /* ============================================================
     MODALE (règles & légende)
     ============================================================ */
  function openModal(title, html) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = html;
    $("#modal").hidden = false;
  }
  function closeModal() { $("#modal").hidden = true; }

  function openRules() {
    openModal("Comment jouer", [
      "<p>Un joueur cache une <b>combinaison secrète</b> de pions colorés. L'autre doit la <b>reconstituer</b> avant d'épuiser ses essais.</p>",
      "<p>À chaque proposition, le jeu donne des indices :</p>",
      legendHTML(),
      "<p>À toi de déduire les couleurs et leur ordre. Bonne chance ! 🍀</p>"
    ].join(""));
  }
  function openLegend() {
    openModal("Signification des indices", legendHTML());
  }
  function legendHTML() {
    return "" +
      '<div class="legend-row"><span class="legend-dot exact"></span><span>Pion vert' +
      '<small>Bonne couleur, au bon emplacement.</small></span></div>' +
      '<div class="legend-row"><span class="legend-dot color"></span><span>Pion blanc' +
      '<small>Bonne couleur, mais au mauvais emplacement.</small></span></div>' +
      '<p><small>Les indices ne sont pas classés : leur position ne révèle pas quel pion est correct.</small></p>';
  }

  function bindModal() {
    $$("[data-close]").forEach(function (n) { n.addEventListener("click", closeModal); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* ============================================================
     INITIALISATION
     ============================================================ */
  function bindHome() {
    $$(".mode-card").forEach(function (card) {
      card.addEventListener("click", function () {
        state.mode = card.getAttribute("data-mode");
        Sound.ensure();
        Sound.pick();
        updateSetupSummary();
        showScreen("setup");
      });
    });
    $("#rulesBtn").addEventListener("click", function () { Sound.pick(); openRules(); });

    var home = $("#homeBtn");
    home.addEventListener("click", function () { showScreen("home"); });
    home.addEventListener("keydown", function (e) { if (e.key === "Enter") showScreen("home"); });

    $$('[data-goto="home"]').forEach(function (b) {
      b.addEventListener("click", function () { Sound.pick(); showScreen("home"); });
    });

    var soundBtn = $("#soundBtn");
    soundBtn.addEventListener("click", function () {
      Sound.on = !Sound.on;
      soundBtn.textContent = Sound.on ? "🔊" : "🔇";
      soundBtn.classList.toggle("is-muted", !Sound.on);
      if (Sound.on) { Sound.ensure(); Sound.pick(); }
    });
  }

  function init() {
    bindHome();
    bindSetup();
    bindCoder();
    bindPlay();
    bindEnd();
    bindModal();
    updateSetupSummary();
    showScreen("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
