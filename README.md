# Vybbit

Et Kahoot-lignende Spotify-spill i hybridmodus. En spiller er host og autentiserer med Spotify Premium, mens gjestene kun trenger å lime inn en offentlig playlist-lenke. En tilfeldig sang spilles, og alle gjetter hvem sangen tilhører.

## Funksjoner

- Host oppretter rom og kobler til Spotify (krever Premium for full avspilling)
- Opptil 6 spillere kan bli med via romkode
- Gjester trenger ikke Spotify-konto — kun en offentlig playlist-URL
- Host importerer spor fra gjestenes playlister
- Konfigurerbart antall runder (1–20) og gjettetid (5–60 sekunder)
- Poeng for riktig gjettet sporseier, vinner vises på slutten
- Pause/fortsett under aktive runder
- Sanntidsoppdateringer via WebSocket

## Teknologi

- **Backend**: FastAPI + Uvicorn (Python 3.12+)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Auth**: Spotify OAuth 2.0 (PKCE)
- **Sanntid**: WebSocket
- **Lagring**: In-memory (romtilstand), localStorage/sessionStorage (klient)

## Oppsett

### 1. Spotify Developer App

1. Gå til [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Opprett en ny app.
3. Under **Redirect URIs**, legg til URLen der appen kjører (f.eks. `http://127.0.0.1:8000/`).

### 2. Miljøvariabler

Opprett en `.env`-fil i prosjektmappen:

```env
SPOTIFY_CLIENT_ID=din_client_id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8000/
```

### 3. Installer avhengigheter

```bash
pip install -r requirements.txt
```

### 4. Start serveren

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Åpne `http://127.0.0.1:8000/` i nettleseren.

## Kjøre som systemtjeneste (Linux/systemd)

Opprett `/etc/systemd/system/vybbit.service`:

```ini
[Unit]
Description=Vybbit Uvicorn App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/apps/Vybbit
ExecStart=/home/ubuntu/apps/Vybbit/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
EnvironmentFile=/home/ubuntu/apps/Vybbit/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable vybbit
sudo systemctl start vybbit
```

## Spillflyt

1. **Host** oppretter rom og oppgir navn.
2. **Host** kobler til Spotify og velger en playlist.
3. **Gjester** joiner med romkode og limer inn en offentlig Spotify-playlist-URL.
4. **Host** importerer gjestenes playlister (`Oppdater spillelister`).
5. **Host** konfigurerer runder og gjettetid, deretter starter spillet.
6. Hver runde: en tilfeldig sang spilles — gjett hvem den tilhører før tiden løper ut.
7. Etter siste runde vises resultater. Host kan nullstille til lobby eller avslutte rommet.

## Merknader

- Full avspilling via Spotify Web Playback SDK krever Spotify Premium hos hosten. Gjester uten Premium hører 30-sekunders forhåndsvisninger hvis tilgjengelig.
- Kun offentlige playlister støttes for gjester.
- Romtilstand lagres i minnet — omstart av serveren sletter alle aktive rom.
- Maks 6 spillere per rom, maks 300 spor per spiller.
