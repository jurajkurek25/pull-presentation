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

Zatvorenie karty funguje preto, že stránka bola otvorená odkazom v novej karte a pri prepínaní
slajdov nemení adresu. Ak by ju prehliadač predsa nezavrel (napr. adresa bola napísaná ručne),
zobrazí sa výzva zavrieť ju cez Ctrl+W.

## Ako sa počítajú odpovede

- Každý klik respondenta sa uloží hneď a do ~0,25 s sa prejaví na plátne.
- Kým respondent neodovzdá, môže odpoveď meniť – graf sa posúva.
- Po stlačení **Odovzdať** sú odpovede pevné (tmavá farba v grafe).
- „Vypĺňa“ = respondenti, ktorí majú aspoň jednu odpoveď, ale ešte neodovzdali.
- Respondent je rozpoznaný podľa náhodného identifikátora v prehliadači (localStorage).
- Otázky sa nedajú meniť, keď už dotazník má odpovede (najprv **Vymazať odpovede**).

## Spustenie lokálne

```bash
npm install
npm run create-user -- ja@example.com "Moje meno" mojeheslo123
npm start            # http://localhost:3000/admin
npm test
```

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
`PUBLIC_URL` (adresa pre QR kód; bez nej sa použije adresa z požiadavky).

## Technológie

Node.js + Express, SQLite (better-sqlite3), živé aktualizácie cez Server-Sent Events,
grafy Chart.js, QR kódy generované na serveri. Frontend je čisté HTML/JS bez buildu.
