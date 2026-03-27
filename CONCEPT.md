# HearMeOut — Mini White Paper

## Konsept
Guessify er et sosialt musikk-gjettelspill for grupper. I stedet for å teste musikkunnskap, tester det hvor godt du kjenner menneskene rundt deg. Spotify er backbone — appen er bygget for de som allerede lever i Spotify-økosystemet.

**Kjernemekaniikk:** En sang spilles. Du gjetter hvem i rommet den tilhører.

---

## To spillmodi

### Chill
*Del en playlist, bare lek*
- Kun host trenger Spotify Premium
- Spillere deler en valgfri playlist
- Enkelt og tilgjengelig — lav terskel
- Passer som introduksjon til spillet

### Exposed
*Vi henter dine faktiske lyttedata... du vet hva du har hørt*
- Alle spillere logger inn med Spotify Premium
- Sangene hentes fra ekte, personlig lyttehistorikk
- Rundekategorier som gjør det personlig og uforutsigbart:
  - **Top 10** — sangene du har hørt mest
  - **Nostalgia** — gamle favoritter fra 5+ år tilbake
  - **Guilty Pleasure** — mye hørt, aldri delt
  - **Nytt bekjentskap** — nylig oppdaget

---

## Hvorfor det funker
De fleste musikk-quizapper tester hvem som kan mest om musikk. Guessify tester hvem som kjenner *hverandre* best. Det finnes ingen fasit på internett — du må faktisk kjenne menneskene i rommet.

Konseptet bygger på en følelse folk allerede kjenner fra Spotify Wrapped: å bli avslørt av sin egen lyttehistorikk. Guessify tar den følelsen og gjør den sosial, interaktiv og litt pinlig — i beste mening.

---

## Målgruppe
Vennegjenger på hyttetur, vorspiel eller lignende. Folk som allerede bruker Spotify daglig og har Premium. Appen trenger ikke treffe alle — den trenger å treffe riktig.

---

## MVP-scope
- Exposed-modus med minst to rundekategorier (Top 10 + Guilty Pleasure)
- Maks 8 spillere per rom
- Spotify OAuth for alle spillere
- Sanntid via WebSockets (allerede bygget)
- Enkel score per runde, leaderboard på slutten
