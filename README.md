# KHIF Tribune Infoskærm

Simpel statisk infoskærm til GitHub Pages.

## Funktioner

- 10 konfigurerbare sider
- Automatisk sideskift hvert 30. sekund
- Indhold ligger i `content/pages.json`
- Decap CMS admin UI i `/admin`
- Deploy til GitHub Pages via GitHub Actions

## Kom i gang

```bash
git clone https://github.com/msj33/khif-tribune.git
cd khif-tribune
# kopier filerne fra denne starter ind i repoet
git add .
git commit -m "Add simple infoscreen"
git push
```

Gå derefter til GitHub repoet:

1. Settings → Pages
2. Build and deployment → Source: **GitHub Actions**
3. Åbn sitet når workflowet er færdigt

## Lokal test

Da sitet bruger `fetch()` til at læse JSON, skal det køres via en lille lokal webserver:

```bash
python3 -m http.server 8080
```

Åbn: <http://localhost:8080>

## Redigering af indhold

Manuelt: rediger `content/pages.json`.

Via Decap CMS:

1. Ret `admin/config.yml` så `repo:` matcher dit repo.
2. Åbn `/admin`.
3. Bemærk: GitHub Pages har ikke en indbygget OAuth-backend til Decap CMS. Til produktion skal du tilføje en OAuth broker, eller hoste admin på fx Netlify/Cloudflare med auth.

Til lokal Decap-test kan du køre:

```bash
npx decap-server
python3 -m http.server 8080
```

Åbn: <http://localhost:8080/admin>
