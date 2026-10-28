# Živé dotazníky do prezentácie

Respondenti naskenujú QR kód a vypĺňajú dotazník na mobile. Na plátne sa koláčové grafy hýbu naživo
už počas vypĺňania (svetlá farba = ešte vypĺňajú, plná = odovzdané). Keď všetci odovzdajú, stav sa
prepne na **Všetci odovzdali** a výsledky sú konečné.

| Adresa | Čo tam je |
|---|---|
| `/<slovo>` | Stránka do prezentácie: QR kód + živé grafy, ovládaná prezentérom |
| `/<slovo>/vyplnit` | Dotazník pre respondentov (sem vedie QR kód) |
| `/admin` | Administrácia: dotazníky, otázky, stav, používatelia |

## Použitie s Canvou

1. V `/admin` vytvor dotazník, pridaj otázky a prepni stav na **Otvorený**.
2. Skopíruj **Odkaz do prezentácie** (`https://forms.jurajkurek.com/<slovo>`) a v Canve ho vlož ako odkaz na slajd.
3. Počas prezentácie klikni na odkaz. Otvorí sa nová karta s QR kódom, Canva zostane v pôvodnej karte.
4. Prezentérom prechádzaš QR → otázka 1 → otázka 2 → …
5. Späť do Canvy: tlačidlo **Späť** na prvom slajde, **Ďalej** na poslednom slajde, alebo **Esc** /
   tlačidlo čiernej obrazovky (`B` / `.`). Karta sa zavrie a si späť v prezentácii.
   (Canva po návrate už nie je na celú obrazovku – stlač F5 / tlačidlo spustenia na prezentéri.)

### Ovládanie prezentérom (A4tech 2.4G)

Prezentér sa v počítači správa ako klávesnica. Stránka reaguje na:

| Akcia | Klávesy |
|---|---|
| Ďalej | PageDown, →, ↓, medzerník, Enter |
| Späť | PageUp, ←, ↑, Backspace |
| Zavrieť kartu a vrátiť sa do Canvy | Esc, `B`, `.` (+ Späť na prvom / Ďalej na poslednom slajde) |
| Celá obrazovka zap./vyp. | F5 (stránku neobnoví) |

**Test prezentéra:** na stránke prezentácie stlač na klávesnici `K`. Zobrazí sa okno, ktoré ukazuje,
akú klávesu ktoré tlačidlo posiela (nič sa pritom nevykoná). Ak tvoj prezentér posiela niečo iné,
uprav pole `KEYS` na začiatku `public/present.js`.

Prehliadač dovolí stránke zavrieť jej kartu iba vtedy, keď ju otvoril odkaz **v novej karte**
(karta nemá inú históriu). Ak sa stránka otvorila v tej istej karte ako Canva, alebo bola adresa
vložená do už použitej karty, zavrieť ju nejde – vtedy sa stránka vráti na predchádzajúcu stránku
v karte (napr. späť do Canvy). Výzva „zavri cez Ctrl+W“ sa ukáže, len keď niet kam ísť späť.

### Otvorenie stránky šípkou na prezentéri (bez myši)

Stránka sa otvorí sama, keď prezentácia príde na slajd, ktorý obsahuje odkaz na
`forms.jurajkurek.com/...` (odkaz nechaj v slajde ako doteraz).

**PowerPoint (Windows)** – makro `presenter/powerpoint/FormsLink.bas`:

1. Ulož prezentáciu ako **Prezentácia PowerPoint s podporou makier (.pptm)**.
2. Stlač `Alt+F11`, v menu **File → Import File…** vyber `FormsLink.bas`, zavri editor a ulož.
3. Pri otvorení súboru klikni na **Povoliť obsah** (makrá).
4. Spusti prezentáciu. Na slajde s odkazom sa stránka otvorí v samostatnom okne Chromu; keď sa na konci
   zavrie, zavrie sa celé okno a vpredu je znova PowerPoint. Pri návrate šípkou späť sa znova neotvorí.

Ak sa nič neotvorí: PowerPoint niekedy nenačíta makrá, kým sa nepoužijú. Pomôže pred prezentáciou raz
otvoriť `Alt+F11`, alebo vložiť na prvý slajd malý ovládací prvok ActiveX (karta **Vývojár → Ovládacie
prvky → Označenie**).

**Canva (Chrome)** – rozšírenie `presenter/canva-extension`:

1. V Chrome otvor `chrome://extensions`, zapni **Režim pre vývojárov**.
2. Klikni **Načítať rozbalené** a vyber priečinok `presenter/canva-extension`.
3. Na slajd pridaj **textové pole s adresou**, napr. `forms.jurajkurek.com/typ` (môže byť aj malé).
   Canva adresy odkazov v prezentácii do stránky nevkladá, preto rozšírenie hľadá adresu ako text.
4. V Canve spusti **Prezentovať** (na celú obrazovku). Keď sa zobrazí slajd s adresou, stránka sa otvorí
   v samostatnom okne cez celú obrazovku (nová karta by Canve zrušila celú obrazovku a tým aj prezentáciu).
   Keď sa stránka na konci zavrie, zavrie sa jej okno a Canva pokračuje v prezentácii. Na tom istom slajde
   sa znova neotvorí, v editore (mimo prezentácie) sa neotvára vôbec.

Po aktualizácii rozšírenia (`git pull`) klikni v `chrome://extensions` pri rozšírení na **↻** a obnov
kartu s Canvou.

## Režim „Kvíz“ (ako Kahoot)

Hráči odpovedajú na čas, za správnu a rýchlu odpoveď dostanú body a po každej otázke sa ukáže poradie.

1. V editore prepni **Režim** na **Kvíz**. Každá otázka je typu „Jedna možnosť“ s 2–4 možnosťami;
   vyber **Správnu odpoveď** a **Čas na odpoveď** (predvolene 20 s). Stav prepni na **Otvorený**.
2. Hráči naskenujú QR kód, zadajú prezývku a na plátne sa objavia ich mená (čakáreň).
3. Šípkou prezentéra posúvaš hru: **otázka** (na mobiloch farebné tlačidlá so symbolmi, na plátne odpočet)
   → **vyhodnotenie** (farebné stĺpce, správna odpoveď ✓; nastane samo po uplynutí času alebo keď odpovedia
   všetci, šípkou ho môžeš vyvolať aj skôr) → **poradie** (top 5) → ďalšia otázka … → **víťazi** (stupne).
   Na mobile hráč po každej otázke vidí „Správne! +850“ / „Nesprávne“, svoje body a umiestnenie.
4. Šípka späť v čakárni a šípka ďalej na obrazovke víťazov zatvoria kartu (návrat do prezentácie).

Body: správna odpoveď 1000 bodov, ak prišla okamžite, a 500 na konci limitu; nesprávna 0. Odpoveď sa nedá
zmeniť. **Kvíz posúvať môže iba prihlásený admin** – v prehliadači s prezentáciou musíš byť prihlásený
v `/admin`. Hru začneš odznova tlačidlom **Vymazať odpovede**.

## Ako sa počítajú odpovede

- Každý klik respondenta sa uloží hneď a do ~0,25 s sa prejaví na plátne.
- Kým respondent neodovzdá, môže odpoveď meniť – graf sa posúva.
- Po stlačení **Odovzdať** sú odpovede pevné (tmavá farba v grafe).
- „Vypĺňa“ = respondenti, ktorí majú aspoň jednu odpoveď, ale ešte neodovzdali.
- Respondent je rozpoznaný podľa náhodného identifikátora v prehliadači (localStorage).
- Otázky sa nedajú meniť, keď už dotazník má odpovede (najprv **Vymazať odpovede**).

## Režim „Vyhodnocovací test“

Napr. 15 otázok, či si introvert alebo extrovert. Na plátne je jeden koláč, ktorý ukazuje, koľko percent
respondentov vyšlo ako introvert a koľko ako extrovert.

1. V editore dotazníka prepni **Režim** na **Vyhodnocovací test**.
2. Vyplň **Možné výsledky** (2–8, každý na nový riadok), napr. `Introvert` a `Extrovert`.
3. Pri každej otázke sa zobrazí tabuľka **Body za odpoveď**: pre každú odpoveď zadáš body pre každý
   výsledok (celé čísla, aj záporné). Pri škále 1–5 zadáš body pre každú hodnotu. Voľný text sa neboduje.
4. Respondentovi sa body sčítajú a dostane výsledok s najviac bodmi. Pri rovnosti sa zaráta do šedého
   výseku **Nerozhodne** (ten sa zobrazí, len keď nie je prázdny).
5. Po odovzdaní respondent na mobile uvidí „Tvoj výsledok: …“ (pri rovnosti „Si na pomedzí: … / …“).

V prezentácii je QR slajd a slajd s koláčom. Jeho nadpis nastavíš v poli **Nadpis slajdu s výsledkami**
(prázdne = „Výsledky“). Ak zaškrtneš **zobraziť aj grafy
jednotlivých otázok**, za koláčom nasledujú aj slajdy otázok. Aj tento koláč sa hýbe počas
vypĺňania (svetlá = rozpracovaní, plná = odovzdaní).

Body, výsledky aj režim môžeš meniť aj keď už sú odpovede – všetko sa prepočíta. Body sa
respondentom neposielajú, takže v prehliadači nevidia, ktorá odpoveď vedie ku ktorému výsledku.

## Režim „Test konzistencie“

Cvičenie s farbami písmen v dvoch kolách (A, B, D, E, H, M, R, S, T; 8 farieb). Má vlastné stránky,
QR kód pre mobil je rovnaký ako pri dotazníku (`/<slovo>/vyplnit`). Do prezentácie idú dva odkazy:
`/<slovo>` (kolo 1) a `/<slovo>/kolo2` (kolo 2).

1. V `/admin` vytvor dotazník, prepni **Režim** na **Test konzistencie**, ulož a stav prepni na **Otvorený**.
2. Na slajd za sekciou 2 daj odkaz `forms.jurajkurek.com/<slovo>`, na slajd za sekciou 5
   `forms.jurajkurek.com/<slovo>/kolo2` (v Canve ako text, v PowerPointe ako hypertextový odkaz).
3. **Kolo 1:** stránka ukáže QR kód a počet hotových. Na mobile sa písmená zobrazujú po jednom, ťuknutím
   na farbu sa uloží a ide sa ďalej. Po 9. písmene sa kolo zavrie a farby sa už neukážu (ani na mobile).
   Mobil potom ukáže „Sledujte prezentáciu“. **Ďalej** na prezentéri zavrie stránku.
4. **Kolo 2:** keď prezentácia príde na slajd s odkazom `/kolo2` a otvorí stránku, kolo 2 sa spustí. Mobily,
   ktoré majú kolo 1 hotové, sa prepnú samé (alebo znova naskenujú QR v tom istom prehliadači), písmená sú
   v náhodnom poradí. Kolo 1 sa tým zavrie.
5. **Ďalej** → histogram: koľko ľudí má 0 až 9 zhôd, s čiarkovanou hranicou „aspoň 7 z 9“ (pod grafom je počet ľudí nad ňou; zmena v `THRESHOLD` v `public/colors-present.js`). Každý na mobile vidí svoje skóre a porovnanie oboch kôl.

Stránka `/kolo2` spustí kolo 2 iba vtedy, keď je v tom istom prehliadači niekto **prihlásený do `/admin`**
(inak sa ukáže upozornenie), aby ho nemohol spustiť nikto zo študentov. Kolo sa dá prepnúť aj ručne
v editore (**Kolo 1 / Kolo 2**), tam sú aj oba odkazy na skopírovanie.
**Vymazať odpovede** vráti test na kolo 1 – tak ho pred hodinou otestuješ a vynuluješ.

Kto kolo 1 nedokončil, môže ho dokončiť až do začiatku kola 2; v kole 2 sa už nezapojí.

Rozšírenie pre Canvu rozpoznáva adresu `/<slovo>/kolo2` od verzie 1.5 – po `git pull` ho v
`chrome://extensions` obnov (**↻**).

## Spustenie lokálne

```bash
npm install
npm run create-user -- ja@example.com "Moje meno" mojeheslo123
npm start            # http://localhost:3000/admin
npm test
```

## Nasadenie priamo na serveri (CloudPanel, ako root)

Predpoklad: v CloudPanel je stránka `forms.jurajkurek.com` typu **Node.js** (Node 20 alebo 22)
s **App Port 9876**. Na serveri ako root:

```bash
cd /root
git clone -b claude/keen-archimedes-85qyy9 https://github.com/jurajkurek25/pull-presentation.git
cd pull-presentation
bash deploy/server-deploy.sh --create-admin   # prvé nasadenie, spýta sa na admin účet
```

Aktualizácia:

```bash
cd /root/pull-presentation && git pull && bash deploy/server-deploy.sh
```

Aplikácia sa nainštaluje do `/home/jurajkurek-forms/htdocs/forms.jurajkurek.com` a beží pod
používateľom stránky (nie pod rootom) cez `pm2`. Databáza je v `/home/jurajkurek-forms/forms-data/app.db`.
Nastavenia sa dajú zmeniť premennými, napr. `APP_PORT=9000 bash deploy/server-deploy.sh`
(`SITE_USER`, `APP_DIR`, `DATA_DIR`, `APP_PORT`, `PUBLIC_URL`).

## Nasadenie z Windows na CloudPanel (PowerShell)

Predpoklad: v CloudPanel je stránka `forms.jurajkurek.com` typu **Node.js** (Node 20 alebo 22)
s **App Port 9876** a máš SSH prístup ako používateľ stránky (`jurajkurek-forms`).

V priečinku s týmto repozitárom spusti:

```powershell
# prvé nasadenie: nahrá aplikáciu, spustí ju a vytvorí admin účet (opýta sa na e-mail, meno, heslo)
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Server <IP-servera> -CreateAdmin

# každá ďalšia aktualizácia (databáza zostáva)
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Server <IP-servera>
```

Skript zabalí aplikáciu, nahrá ju cez `scp` do `/home/jurajkurek-forms/htdocs/forms.jurajkurek.com`,
na serveri spustí `npm ci`, nainštaluje `pm2` (do domovského priečinka, bez roota), spustí aplikáciu,
nastaví jej štart po reštarte servera a overí, že odpovedá. Databáza je mimo webového priečinka
v `/home/jurajkurek-forms/forms-data/app.db` – tú zálohuj.

Voliteľné parametre: `-User`, `-SshPort` (predvolene 22), `-AppPort` (9876), `-AppDir`, `-DataDir`,
`-PublicUrl`. Úpravy nginx v CloudPanel netreba – aplikácia si vypne buffering živých aktualizácií sama
(hlavička `X-Accel-Buffering: no`).

## Nasadenie na VPS (Docker)

```bash
git clone <repo> && cd pull-presentation
# v docker-compose.yml nastav PUBLIC_URL na svoju doménu (z nej sa generuje QR kód)
docker compose up -d --build
docker compose exec app node scripts/create-user.js ja@example.com "Moje meno" mojeheslo123
```

Databáza (SQLite) je v `./data/app.db` – zálohuj tento priečinok. Ďalších členov tímu pridáš
v `/admin/users`.

Nginx pred aplikáciou (HTTPS cez certbot). Dôležité je `proxy_buffering off`, inak sa živé
aktualizácie zaseknú:

```nginx
server {
    server_name forms.jurajkurek.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

```bash
sudo certbot --nginx -d forms.jurajkurek.com
```

Premenné prostredia: `PORT` (predvolene 3000), `DB_FILE` (predvolene `data/app.db`),
`PUBLIC_URL` (adresa pre QR kód; bez nej sa použije adresa z požiadavky),
`WIFI_SSID` (názov hotspotu bez hesla, ktorého QR kód „Pripoj sa na Wi-Fi“ je na úvodnom slajde;
predvolene `jurajkurek.com`, prázdna hodnota `WIFI_SSID=` ho skryje).

## Technológie

Node.js + Express, SQLite (better-sqlite3), živé aktualizácie cez Server-Sent Events,
grafy Chart.js, QR kódy generované na serveri. Frontend je čisté HTML/JS bez buildu.
