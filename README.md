# KHIF Info

KHIF Info viser information på en infoskærm og gør det let for redaktører at opdatere indholdet.

## 1) Brugerne/redaktørerne

Her står der, hvordan man opdaterer indholdet på infoskærmen.

- Åbn adminpanelet i din browser: `/admin/`
- Log ind med dit adminbrugernavn og kodeord.
- Rediger tekst, skift billeder og vælg hvilke sider der skal vises.
- Gem dine ændringer.

Når du har gemt, bliver indholdet sendt videre til infoskærmen. Den opdaterer automatisk, så de nye tekster og billeder vises på skærmen.

Tips:
- Upload billeder direkte fra adminpanelet.
- Brug et kort og tydeligt budskab på hver slide.
- Du kan altid gå tilbage og rette eller udskifte indhold.

## 2) Styringen af infoskærmen

Denne del handler om den fysiske infoskærm og Raspberry Pi-enheden.

- Infoskærmen viser de sider, som er oprettet i adminpanelet.
- Hvis skærmen har brug for en opdatering, kan du genstarte den fysiske enhed.
- Superadmin-panelet `/superadmin/` viser, om Raspberry Pi’en er tændt og online.
- Der kan også sendes kommandoer til skærmen, fx genindlæsning eller genstart.

Superadmin-panelet er til dem, der passer på selve skærmen. Det er her, man ser, om enheden virker og kan gøre den klar igen, hvis noget går galt.

## 3) Raspberry Pi Agent mappen

Mappen `raspberry-pi/` indeholder det, der kører på selve Raspberry Pi-en.

- Den sørger for, at skærmen åbner den rigtige side og viser indhold.
- Den hjælper med at holde styr på, om enheden er i orden.
- Den gør det muligt at sende beskeder til skærmen fra superadminpanelet.

Denne mappe er særligt vigtig, når Raspberry Pi’en kører med DietPi. Den indeholder de små programmer og indstillinger, som fås til at fungere sammen med skærmen.

---

Med denne opsætning kan én person lave nyt indhold, og en anden kan passe på selve infoskærmen, uden at det bliver for kompliceret.