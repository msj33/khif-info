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

Denne mappe er særligt vigtig, når Raspberry Pi’en kører med DietPi. Den indeholder de små programmer og indstillinger, som får det hele til at fungere sammen med skærmen.

## 4) Backup af Raspberry Pi / DietPi

Denne del beskriver, hvordan man laver en backup af DietPi microSD-kortet direkte fra en MacBook.

Backupen gemmes som et image på ca. 8 GB, selvom det originale microSD-kort f.eks. er 64 GB.

Det betyder, at backupen kan bruges til restore på større microSD-kort, f.eks. 16 GB, 32 GB eller 64 GB.

### Sådan laver du backup

1. Sæt DietPi microSD-kortet i MacBook.

2. Åbn Terminal og find microSD-kortet:

    diskutil list

    Find det eksterne fysiske kort, f.eks.:

    /dev/disk4 (external, physical)

    **Kontrollér altid, at du har fundet det rigtige disknummer.**

3. Afmontér microSD-kortet:

    diskutil unmountDisk /dev/disk4

    Erstat `disk4` med det korrekte disknummer.

4. Opret en backup-mappe:

    mkdir -p ~/dietpi-backup

5. Lav backup-image:

    sudo dd if=/dev/rdisk4 of="$HOME/dietpi-backup/DietPi-8GB.img" bs=512 count=15992832

    `rdisk4` er macOS' raw device og giver normalt hurtigere kopiering.

    `count=15992832` betyder, at der kun kopieres de første ~8 GB af microSD-kortet.

6. Kontroller at image-filen er oprettet:

    ls -lh ~/dietpi-backup/DietPi-8GB.img

    Image-filen ligger herefter her:

    ~/dietpi-backup/DietPi-8GB.img

### Vigtigt

- Kør altid `diskutil list` først og kontrollér disknummeret.
- Erstat `disk4` og `rdisk4` med det faktiske disknummer for microSD-kortet.
- **Brug aldrig `disk0`**, da det normalt er Mac'ens interne disk.
- Backup kan restores til større microSD-kort, f.eks. 16 GB, 32 GB eller 64 GB.

---

Med denne opsætning kan én person lave nyt indhold, og en anden kan passe på selve infoskærmen, uden at det bliver for kompliceret.
