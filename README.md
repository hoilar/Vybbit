# Guessify

En enkel MVP for et Kahoot-lignende Spotify-spill i hybridmodus:

- Host lager rom og kobler til Spotify Premium.
- Opptil 6 spillere kan bli med med romkode.
- Gjestene limer inn en offentlig Spotify-playlist i stedet for å logge inn.
- Host henter egne lister og importerer spor fra gjestenes offentlige playlists.
- Host starter spillet, en tilfeldig sang velges fra en av deltakernes spor.
- Spillerne gjetter hvem sangen tilhører.

## Kjøring

1. Opprett en Spotify-app i Spotify Developer Dashboard.
2. Legg redirect URI til `http://127.0.0.1:8000/`.
3. Opprett `.env` med:

```env
SPOTIFY_CLIENT_ID=din_client_id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8000/
```

4. Installer avhengigheter:

```bash
pip install -r requirements.txt
```

5. Start serveren:

```bash
uvicorn app.main:app --reload
```

6. Åpne `http://127.0.0.1:8000/`.

## Flyt

1. Host lager rom.
2. Host trykker `Koble til Spotify`.
3. Gjestene joiner med romkode og limer inn en offentlig playlist-lenke.
4. Host trykker `Oppdater spillelister` hvis auto-import ikke allerede har hentet dem.
5. Når alle spillere står som klare, kan host starte spillet.

## Merknader

- Full avspilling bruker Spotify Web Playback SDK og krever Premium hos hosten.
- Private playlists fra gjester støttes ikke i hybridmodellen.
- Romtilstand lagres i minnet. Restart av serveren sletter rommene.
