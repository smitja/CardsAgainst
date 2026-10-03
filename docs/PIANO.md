# Piano di progetto

## Decisioni dopo la Fase 1

- **Nome**: _Cards Against Cirelli_. Nota: riprende lo schema del nome originale, che il brief escludeva. Va bene per un gioco privato fra amici; se diventasse pubblico conviene rivederlo. Grafica, logo e testi restano originali.
- **Direzione visiva**: A, Ciclostile, con la scommessa dei due inchiostri.
- **Deploy**: niente Vercel, Cloudflare o Supabase. Il risultato è un **pacchetto portabile** da consegnare a GPT Work, che ha hosting, database relazionale e storage integrati.
- **QR in lobby**: chi crea la stanza mostra il telefono agli altri. QR grande con il codice di quattro lettere sotto, come ridondanza; tap sul QR per vederlo a schermo pieno; pulsante "Invita" sempre raggiungibile durante la partita per chi arriva tardi.

### Alternativa allo stack del brief (motivazione in tre righe)

1. Il pacchetto deve girare su una piattaforma che non controllo: un solo processo Node che serve i file statici e i WebSocket, con un Dockerfile, è il formato più portabile.
2. Le piattaforme "tipo Vercel" pubblicano Next.js come funzioni serverless, che non tengono aperti i WebSocket: rischio di rottura silenziosa in produzione.
3. Dopo il caricamento il gioco vive tutto nel client: l'SSR di Next non serve, e una SPA Vite produce un bundle più piccolo per le reti scarse.

Quindi: **client Vite + React** (TypeScript strict, Tailwind v4, Motion), **server Node** (HTTP + WebSocket con `ws`, stanze in memoria con istantanee su database), **SQL portabile** (SQLite in locale, Postgres in produzione tramite `DATABASE_URL`, migrazioni in SQL puro). Motore e protocollo non cambiano: se GPT Work preferisce un suo sistema realtime, deve solo implementare il protocollo documentato. Il pacchetto include `HANDOFF.md` per chi lo installa (variabili d'ambiente, schema del database, vincolo di una sola istanza o instradamento per codice stanza).

### Mazzo predefinito (dopo la Fase 3)
- Il mazzo attivo di default in ogni stanza è **Cards Against Cirelli**: 85 domande (76 da una carta, 7 da due, 2 da tre) e 296 risposte, tutte dai PDF del gruppo e senza doppioni, importate con `scripts/pdf-cards.py`.
- Il mazzo base originale resta attivabile in lobby; l'host può anche aggiungere mazzi custom con il codice (editor nella Fase 5).
- A metà frase le risposte che iniziano con articolo, preposizione o verbo all'infinito passano in minuscolo; nomi propri e sigle restano.

## Contesto

Repo `smitja/cardsagainst` vuoto (nessun commit). Obiettivo: party game in presenza, un telefono a testa, meccanica alla Cards Against Humanity con identità originale. Criterio di successo: sei amici aprono un link e giocano il primo round in meno di 60 secondi, senza account e senza spiegazioni.

Skill lette: `design-taste-frontend` e `react-bits` complete. **`ui-ux-pro-max` è installata ma incompleta**: c'è solo SKILL.md, mancano `scripts/search.py`, `references/quick-reference.md` e `pro-rules.md`. Niente ricerca nel database: uso le sue categorie a priorità (accessibilità, touch, performance, layout, tipografia, motion…) come griglia per la revisione UX della Fase 7, dichiarandolo come fallback.

Design read: _app di gioco mobile per gruppi di amici adulti, linguaggio irriverente e fisico, con carte come oggetti stampati; Tailwind v4 + Motion + token CSS, niente design system di libreria._ Dial: VARIANCE 7, MOTION 7, DENSITY 4.

---

## Tre nomi proposti (scelto poi: Cards Against Cirelli)

1. **Tappabuchi** (consigliato): chi riempie i buchi, e i buchi sono gli "___". Dice la meccanica in una parola, suona italiano e un po' sfacciato.
2. **Malalingua**: dice il tono, meno la meccanica.
3. **Bianco Sporco**: gioca sulle carte bianche e sull'umorismo sporco.

(Prima del lancio pubblico serve una verifica di marchio e dominio.)

---

## Tre direzioni visive

### A. Ciclostile (consigliata)

Stampa Risograph, fanzine punk, volantini ciclostilati dei collettivi.

- **Riferimenti**: fanzine punk anni '80, stampe Risograph a due colori (Hato Press, Colorama), grafica giocosa di Bruno Munari, manifesti serigrafati.
- **Palette** (due inchiostri su carta): carta grigia `#DEDEDA`, cartoncino delle carte bianche `#F6F6F3`, inchiostro `#161616`, rosa fluo `#FF3EA5`. Dove i due inchiostri si sovrappongono, l'incrocio nasce da `mix-blend-mode: multiply`. Tema scuro: carta nera `#1B1B1A` e testo `#EDEDE8`; le carte restano cartoncino chiaro perché sono oggetti fisici.
- **Tipografia**: _Anybody_ (variabile, assi larghezza 50-150 e peso) per titoli e testo delle carte. L'asse larghezza ha una funzione precisa: le frasi lunghe si stringono invece di tagliarsi. _Fragment Mono_ per codice stanza, timer e punteggi.
- **Movimento**: le ombre sono a retino (punti), non sfocate. Ogni carta ha lo strato rosa leggermente fuori registro (offset casuale per carta, 1-3px). Quando la selezioni, la giochi o vince, lo strato **scatta a registro** con un piccolo colpo di molla, come una stampa che si allinea. Molle pesanti (la carta ha massa), rotazioni leggere fra ±2,5° ricavate dall'id della carta, pile con scarto visibile.
- **Contro**: il rosa su carta grigia non regge testo AA, quindi il rosa non porta mai testo su carta: solo campiture, numeri grandi e forme. Il testo su rosa è sempre nero (5,6:1).

### B. Bar Sport

L'effimera del bar italiano: schedina, scontrino, timbro, tavolino in formica.

- **Riferimenti**: schedina Totocalcio, scontrini fiscali, timbri postali, manifesti Olivetti di Pintori, tavolini in formica anni '70, insegne "Bar Sport".
- **Palette**: formica verde acqua `#9CC7BA`, carta scontrino `#F7F6F1`, carbone `#222220`, rosso timbro `#C8102E`.
- **Tipografia**: _Alfa Slab One_ (insegna) + _IBM Plex Mono_ (scontrino).
- **Movimento**: lo scontrino esce dalla stampante a scatti (12 fps) con strappo seghettato, il timbro "VINCE" arriva con un colpo e un leggero scuotimento, le carte scivolano sulla formica con attrito alto, la classifica si compila come una schedina con le X.
- **Contro**: fortissima e molto italiana, ma la metafora scontrino/schedina si affolla presto su schermi piccoli e lega poco con carte nere e bianche.

### C. Tabellone

Il tabellone a palette delle stazioni e la segnaletica ferroviaria.

- **Riferimenti**: tabelloni partenze split-flap delle stazioni italiane, manuale della segnaletica della metro di New York di Vignelli, orologio delle ferrovie svizzere (lancetta che si ferma e riparte).
- **Palette**: tabellone `#121212`, palette `#F0EFEA`, giallo segnale `#FFC20E`.
- **Tipografia**: _Big Shoulders Display_ (condensato) + _Martian Mono_.
- **Movimento**: la rivelazione sfoglia le lettere palette per palette con il clac meccanico, il timer è una lancetta che si ferma e riparte, le carte sono targhe smaltate pesanti.
- **Contro**: la rivelazione è teatrale, ma le carte smettono di essere carta. Le frasi italiane lunghe nella griglia split-flap reggono male il testo al 200%, e con il reduced motion l'identità sparisce.

### Scelta: A, Ciclostile

- È l'unica in cui la carta è davvero carta: peso, retino, inchiostro e pile vengono dal materiale, non dalla decorazione.
- Il tono punk e fotocopiato è quello del gioco.
- Passa il test sfocato: anche sfocato, "rosa = tocca a te / cosa hai scelto".
- Con il reduced motion resta riconoscibile, perché l'identità sta nella stampa e non nell'animazione.
- Funziona chiara e scura senza forzature.

### La scommessa

**Due inchiostri, mai un terzo.** Tutto il gioco è stampato in nero e rosa fluo su carta, per sempre. Non c'è un verde per il successo, né un rosso per gli errori, né un colore per giocatore. Gli stati si esprimono con inchiostro, retino (tratteggio = errore o disattivato), tipografia e icone. Il registro che scatta è la firma di movimento. È una scelta irreversibile: ogni schermata futura deve rispettarla.

### react-bits, solo dove il movimento serve

- **Noise**: grana di stampa come overlay fisso con `pointer-events-none`, statico con reduced motion.
- **Counter**: cifre che ruotano quando prendi un punto (feedback).
- **Stack**: base per la pila di risposte che il giudice sfoglia, adattata ai token.

Varianti TS-TW basate su Motion (niente GSAP nello stesso albero). Nessun background decorativo. Icone: **Phosphor**, una sola famiglia, tratto uniforme (giudice = martelletto, non una corona emoji).

---

## Architettura

### Stack

- Monorepo **pnpm workspaces**, TypeScript strict ovunque.
- Web: **Vite + React** (SPA, vedi decisioni sopra), **Tailwind v4** con token CSS, **Motion** (`motion/react`), Zustand per lo store del client, primitive Radix non stilizzate solo per dialog e switch.
- Realtime: **server Node con `ws`**. Una stanza è un oggetto in memoria con il suo stato del motore; ogni transizione salva un'istantanea su database, così un riavvio non perde le partite. Timer e tolleranze con un orologio per stanza che invia `tick` al motore. Client con riconnessione automatica e coda degli intenti.
- **Database relazionale** per mazzi custom e istantanee delle stanze, dietro un'interfaccia `Store` con implementazione SQLite (locale e test) e Postgres (produzione).
- Test: **Vitest** + **fast-check** sul motore, `@cloudflare/vitest-pool-workers` sul server, **Playwright** + `@axe-core/playwright` per l'end-to-end.

### Struttura

```
packages/engine     macchina a stati pura (zero dipendenze), test
packages/protocol   schemi zod degli intenti client→server e dei messaggi server→client, versionati
packages/decks      schema mazzo v1, parser CSV/JSON/testo, mazzo demo italiano
apps/server        Node: HTTP statico + WebSocket + API mazzi + Store SQL
apps/web           Vite + React: home, stanza, TV, mazzi
e2e/                Playwright
```

### Motore (`packages/engine`)

- API: `reduce(state, action) → { state, effects }` e `viewFor(state, seat)` / `viewForScreen(state)`.
- Puro: niente `Date.now` né `Math.random`. Il tempo arriva nelle azioni, il RNG con seme sta nello stato, quindi le partite sono riproducibili.
- Fasi: `lobby → distribuzione → scelta → rivelazione → giudizio → risultato → (distribuzione | fine)`.
- Azioni: `join, leave, disconnect, reconnect, kick, setConfig, start, play, retract, swapHand, revealNext, pick, vote, nextRound, timeout, transferHost`.
- **pick**: numero di "___" (da 1 a 3); con zero spazi pick = 1 e la risposta va in coda.
- **Fine partita**: si raggiunge l'obiettivo (default 7) o il limite di round. A pari merito in testa, vittoria condivisa.
- **Giudice disconnesso** oltre la tolleranza: le carte giocate tornano nelle mani, la carta nera va negli scarti, il ruolo di giudice passa al successivo.
- **Chi entra a partita in corso** resta in stato `in attesa` e riceve le carte al round dopo.
- **Espulsione**: le carte dell'espulso vanno negli scarti e il suo token viene revocato.
- **Mazzo esaurito**: si rimescolano gli scarti. Se non si riesce più a distribuire, la partita finisce con grazia.
- **Sotto i tre giocatori attivi**: partita in pausa con il messaggio "Aspettiamo qualcuno".
- **Regole opzionali**:
  - Fantasma: gioca carte casuali, può vincere, non giudica mai.
  - Scambio della mano: costa 1 punto, solo durante la scelta e prima di aver giocato.
  - Jolly: carte bianche vuote mescolate nel mazzo (quota scelta dall'host), testo libero con limite di lunghezza.
  - Voto collettivo: niente giudice, non puoi votare te stesso, a pari voti punto a tutti i più votati.
  - Timer per round: in scelta, chi non ha giocato salta il round (servono almeno due risposte, altrimenti il round è annullato). In giudizio, alla scadenza il round passa senza punto.
- **Test**: un test per ogni transizione e ogni regola, più proprietà fast-check:
  - le carte si conservano (mazzo + mani + tavolo + scarti = costante, nessun duplicato);
  - la vista di un giocatore non contiene mai il testo delle mani altrui;
  - la rotazione del giudice è equa;
  - stesso seme, stessa partita.

### Server stanze (`apps/server`)

- **Codice stanza**: 4 lettere scelte fra 20 consonanti: niente lettere ambigue e nessuna parola di senso compiuto, quindi niente lista nera; il server tiene una mappa codice → stanza.
- **Ingresso e riconnessione**: entrando ricevi `seatId` + un segreto casuale, salvati in localStorage per stanza. Alla riconnessione col token riprendi lo stesso posto e la stessa mano. Sul server il segreto è conservato come hash.
- **Sincronizzazione**: il server manda un'istantanea proiettata con un `rev` crescente a ogni cambio (stato piccolo, sotto 10 KB). È robusta su reti scarse: il client scarta le revisioni vecchie e gli intenti portano un `clientSeq` per l'idempotenza.
- **Tolleranze con alarm**: host assente 15 s → host migration al giocatore connesso da più tempo; giudice assente 20 s → round al successivo. Un calo di rete breve non penalizza nessuno.
- Lo stato si salva su database a ogni transizione e si ricarica all'avvio, così sopravvive ai riavvii.
- Validazione zod di ogni intento, rate limit per connessione, nickname e jolly normalizzati e mostrati sempre come testo.
- **Ruolo `screen`** per la vista TV: nessuna mano.
- **Timer**: il server manda la scadenza assoluta più l'offset d'orologio misurato col ping, e il client fa il conto alla rovescia in locale.

### Client (`apps/web`)

- **Rotte**: `/` (crea o entra), `/r/[code]` (nickname → lobby → partita), `/tv/[code]`, `/mazzi`, `/mazzi/[id]` (editor), `/m/[share]` (anteprima mazzo condiviso).
- **Percorso dei 60 secondi**:
  1. L'host tocca "Crea stanza", scrive il nickname ed è già in lobby con codice gigante, QR e Web Share.
  2. Gli altri inquadrano il QR, trovano il nickname precompilato se l'hanno già usato, toccano "Entra".
  3. Default già pronti (mazzo demo, obiettivo 7, niente timer): "Inizia" si attiva a 3 giocatori.
  4. Nessun tutorial. Nella metà bassa c'è sempre una riga che dice cosa fare ("Scegli 1 carta e spingila in su", "Sei il giudice: aspetta le risposte"), più un fantasma di gesto la prima volta.
- **La mano**:
  - Riga orizzontale con scroll-snap nativo (momento e accessibilità gratis). L'effetto ventaglio viene da rotazione e quota calcolate dalla distanza dal centro con motion value, senza useState.
  - Tap per selezionare: la carta si alza e il registro scatta.
  - Si gioca con uno swipe in su (soglia 90 px o velocità) o una pressione lunga di 450 ms con anello di avanzamento, più un pulsante "Gioca" nella zona del pollice per screen reader e difficoltà motorie.
  - Poi una barra "Annulla" di 3 s: l'intento parte solo dopo. Il server accetta comunque `retract` finché la fase è aperta.
- **Più carte**: numeri 1, 2, 3 grandi in rosa stampati sulle carte, più l'anteprima della frase composta sulla carta nera (inserti evidenziati) prima di confermare.
- **Rivelazione come scena**:
  - Il giudice ha la pila coperta e a ogni tap la carta in cima si gira e va negli spazi della carta nera.
  - Tutti i telefoni e la TV seguono lo stesso `revealIndex`.
  - Lettura ad alta voce opzionale con `speechSynthesis` in it-IT (sul telefono del giudice o sulla TV).
  - Al giudizio il giudice sfoglia le risposte e sceglie. La vincitrice prende il timbro e il registro va a posto.
- **Stato sempre leggibile**: una striscia in alto mostra le iniziali dei giocatori con spunta per chi ha giocato, martelletto sul giudice e anello del timer. Ogni schermata ha un'azione o un'attesa esplicita.
- **Rete scarsa**:
  - pill di connessione e coda degli intenti in partysocket;
  - font sottoinsiemati e precaricati con next/font;
  - budget JS sotto 200 KB gzip per `/r/[code]`.
- **Fisico**:
  - Wake Lock durante la partita, riacquisito al ritorno in primo piano;
  - vibrazione dove esiste (`navigator.vibrate` rilevato, silenzio su iOS);
  - suoni brevi (sotto 10 KB) disattivabili;
  - PWA con manifest e service worker (Serwist) per shell e font.
- **Accessibilità**:
  - contrasti AA verificati token per token;
  - `prefers-reduced-motion`: niente rotazioni e voli, dissolvenze di 120 ms, registro già allineato;
  - carte con altezza minima e non fissa, testo in unità container e asse larghezza che si stringe; con testo al 200% la mano passa da ventaglio a lista verticale tramite container query;
  - mano come listbox con `aria-selected`, annunci di fase in una regione `aria-live`, focus spostato a ogni cambio di fase;
  - safe area con `env(safe-area-inset-*)`, `100dvh`, tastiera gestita con `visualViewport` e input scrollati in vista, `overflow-x: clip` sulla radice.

### Mazzi (`packages/decks` + database)

- **Schema v1** (zod): `{ schemaVersion: 1, id, name, language, description?, black: [{ text, pick }], white: [{ text }] }`.
  - Ogni sequenza di 3 o più "_" diventa "___".
  - `pick` si ricava dal testo; all'import, un valore incoerente viene corretto con un avviso.
  - I duplicati si eliminano in base al testo normalizzato quando si combinano più mazzi.
- **Import ed export**: CSV (colonne `tipo,testo`, con papaparse), JSON (nostro schema o `{black:[], white:[]}`), testo incollato con una carta per riga e sezioni `# nere` / `# bianche`.
- **Editor**:
  - mobile-first, anteprima della carta reale mentre scrivi, conteggio degli spazi in tempo reale;
  - bozza locale in IndexedDB, "Pubblica" sul server per ottenere il codice di condivisione;
  - senza account: la modifica è autorizzata da un `editToken` in localStorage (sul server se ne salva l'hash), lettura pubblica per codice.
- **Lobby**:
  - l'host combina il mazzo demo, i suoi mazzi e quelli aggiunti per codice, e vede i conteggi;
  - blocco se le bianche sono meno di giocatori × 11 (una mano a testa più una di scorta; il fantasma conta come giocatore);
  - avviso se sono meno di giocatori × 20 o se le nere sono meno di 15.
- **Mazzo demo**: 30 nere e 100 bianche originali in italiano, tono irriverente, scritte da me senza riprendere testi esistenti. Arriva in Fase 3, perché serve per giocare.

---

## Design system (prima delle schermate, inizio Fase 4)

- **Colore**: token semantici `--paper`, `--card`, `--ink`, `--ink-2`, `--fluo`, `--hatch` in chiaro e scuro. Nessun hex nei componenti.
- **Tipografia**: scala 12 (meta mono) / 14 / 16 (corpo) / 20 (testo carta minimo) / 24 / 32 / 44 / 64 (codice stanza), testo carta in `clamp` su `cqi`.
- **Spaziature**: base 4 → 4, 8, 12, 16, 24, 32, 48, 64. Target touch ≥ 44 pt, azioni primarie nel 50% basso.
- **Forme**: le carte hanno angoli fustellati da 8 px, tutto il resto 2 px. Regola unica, documentata.
- **Ombre**: solo a retino, tinte d'inchiostro, mai sfocate.
- **Motion**:
  - durate: tap 90 ms, rapida 160, spostamento 260, cambio fase 480, scena 900;
  - curva `inchiostro` `cubic-bezier(.16,1,.3,1)`;
  - molle `carta` {stiffness 420, damping 32, mass 1.2}, `lancio` {260, 22}, `timbro` {900, 18}.
- **z-index**: scala in un file di costanti.
- **Lingua**: niente lineette lunghe nel copy visibile.

---

## Fasi

1. **Piano e direzioni** (questa). Con il tuo ok: commit di `docs/PIANO.md` e `docs/DIREZIONI.md`, più tre tavole specimen HTML (schermata mano + schermata rivelazione per direzione) pubblicate come artifact privato da guardare sul telefono. **Poi mi fermo e scegli.**
2. **Motore puro con test**: engine, protocol, schema decks, Vitest + fast-check, copertura engine ≥ 95%.
3. **Server stanze e client minimale** giocabile dall'inizio alla fine (stile grezzo), mazzo demo, test di integrazione del DO.
4. **Design system, poi UI e motion definitivi** nella direzione scelta: mano, rivelazione, react-bits.
5. **Mazzi custom**: editor, import/export, salvataggio su database, combinazione in lobby.
6. **Rifinitura e pacchetto**: Dockerfile, `HANDOFF.md` per GPT Work, PWA, Wake Lock, resilienza completa (migrazione host, tolleranze), vista TV, voce, suoni, accessibilità.
7. **Verifica** (sezione sotto) e CLAUDE.md.

Ogni fase si chiude con un report (fatto / manca / decisioni) e un commit dedicato, pushato su un branch di lavoro (`claude/party-game`). Nessuna PR senza tua richiesta.

## Verifica

- `pnpm -F @cirelli/engine test`: test unitari e proprietà del motore. `pnpm -F @cirelli/server test`: integrazione delle stanze via WebSocket (riconnessione, kick, migrazione, timer).
- **Playwright**: 4 contesti simultanei su iPhone SE (375×667) e Pixel 7 (412×915) contro il server Node di produzione (build reale), partita completa con obiettivo 2. Più un progetto con `reducedMotion: 'reduce'` e un caso di riconnessione a metà round.
- `@axe-core/playwright` sulle schermate principali, controllo del testo al 200% (nessun `scrollWidth > clientWidth`).
- **Revisione UX** con le categorie di ui-ux-pro-max, in modalità fallback: elenco dei problemi e correzioni.
- **Test sfocato**: screenshot sfocati con sharp delle schermate di gioco, che guardo e commento. **Test motion off**: screenshot e percorso completo con reduced motion.
- **CLAUDE.md** con architettura, comandi e convenzioni (due inchiostri, token, purezza del motore).

## Questioni aperte

- Capacità reali di GPT Work: servono un processo Node sempre acceso con WebSocket e un Postgres. Se non tiene aperti i WebSocket, il protocollo è documentato per un adattatore diverso.
