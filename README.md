# KHIF Info

Simpel statisk infoskærm til GitHub Pages med 10 sider og en statisk admin-del, som committer direkte til GitHub.

## URL'er

- Site: `https://msj33.github.io/khif-info/`
- Admin: `https://msj33.github.io/khif-info/admin/`
- Content: `content/pages.json`

## Første opsætning

1. Opret et GitHub fine-grained personal access token.
2. Begræns tokenet til repoet `msj33/khif-info`.
3. Giv kun permission: `Contents: Read and write`.
4. Åbn `tools/encrypt-token.html` lokalt i browseren.
5. Indtast admin-brugernavn, admin-password og GitHub-token.
6. Kopier output til `admin/secret.js`.
7. Commit og push.

## Redaktørflow

1. Gå til `/admin/`.
2. Log ind med det fælles redaktør-login.
3. Rediger de 10 slides.
4. Tryk Gem.
5. Admin-siden opdaterer `content/pages.json` via GitHub API og laver en commit.

## Lokal test

```bash
python3 -m http.server 8080
```

Åbn `http://localhost:8080`.

Bemærk: Admin kan kun gemme, hvis `admin/secret.js` er genereret med et gyldigt token.
