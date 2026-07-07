# KHIF Info

Et system til styring og visning af information på infoskærme, typisk anvendt på Raspberry Pi-enheder. Systemet bruger GitHub som backend for indhold, administration og deployment.

## URL'er

-   **Infoskærm (Klient):** `https://msj33.github.io/khif-info/`
-   **Admin-panel:** `https://msj33.github.io/khif-info/admin/`
-   **Superadmin-panel (Enhedsstyring):** `https://msj33.github.io/khif-info/superadmin/`
-   **Indholdsfil:** `content/pages.json`
-   **Versionsfil:** `version.json`

## Funktionalitet

### Infoskærm (Klient)

Hovedsiden (`index.html` med `script.js`) henter indhold fra `content/pages.json` og `version.json` for at vise dynamiske "slides" med tekst og billeder. Den opdaterer automatisk sit indhold og applikationsversion.

### Admin-panel

En webbaseret grænseflade til at oprette, redigere og administrere indholdet på infoskærmen.
-   Administrerer individuelle indholds"sider" (slides).
-   Håndterer billeduploads til `assets/uploads/`.
-   Interagerer med GitHub API for at gemme ændringer i `content/pages.json` og uploade mediefiler.
-   Overvåger deployment-status via GitHub Actions for at sikre, at indholdet er live.

### Superadmin-panel

En grænseflade til overvågning og fjernstyring af de tilsluttede Raspberry Pi-enheder.
-   Viser status for enheder (online/offline, uptime, temperatur, sidst set, etc.).
-   Tillader afsendelse af kommandoer til enheder, f.eks. "reload side" eller "genstart Raspberry Pi".

### Raspberry Pi Agent

Scripts i `raspberry-pi/` mappen bruges til at opsætte en service på en Raspberry Pi.
-   Starter en webbrowser i kiosk-mode for at vise infoskærmens URL.
-   Rapporterer enhedens status tilbage til GitHub-repository'et (som Superadmin-panelet læser).
-   Lytter efter og udfører fjernkommandoer fra Superadmin-panelet.

## Første opsætning (admin/secret.js)

For at Admin-panelet kan kommunikere med GitHub, skal der genereres en `admin/secret.js` fil:

1.  Opret et GitHub fine-grained personal access token.
2.  Begræns tokenet til repository'et `msj33/khif-info`.
3.  Tildel kun permission: `Contents: Read and write`.
4.  Åbn `tools/encrypt-token.html` lokalt i din browser.
5.  Indtast admin-brugernavn, et password (dette password krypterer tokenet) og dit GitHub-token.
6.  Kopier hele outputtet til `admin/secret.js`.
7.  Commit og push `admin/secret.js` (vær opmærksom på at den indeholder krypterede nøgler og bør behandles med omtanke).

## Redaktørflow (Admin-panel)

1.  Gå til `/admin/`.
2.  Log ind med det definerede admin-brugernavn og password.
3.  Opret, rediger og omarranger indholdssider, og upload billeder.
4.  Tryk "Gem til infoskærm".
5.  Admin-siden opdaterer `content/pages.json` (og eventuelle nye billeder) via GitHub API og laver en commit.
6.  Infoskærmen vil automatisk opdage og vise de nye ændringer.

## Superadmin Flow (Superadmin-panel)

1.  Gå til `/superadmin/`.
2.  Log ind med det samme admin-brugernavn og password.
3.  Overvåg status for de tilsluttede Raspberry Pi-enheder.
4.  Send fjernkommandoer til enhederne, f.eks. for at genindlæse siden eller genstarte browseren/enheden.

## Lokal test

```bash
python3 -m http.server 8080
```

Åbn `http://localhost:8080` i din browser.

**Bemærk:** Admin- og Superadmin-panelerne kan kun gemme/sende kommandoer, hvis `admin/secret.js` er korrekt genereret med et gyldigt og funktionelt GitHub fine-grained token.
