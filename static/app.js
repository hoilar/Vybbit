const state = {
  config: null,
  roomCode: null,
  playerId: null,
  room: null,
  spotifyToken: null,
  spotifyProfile: null,
  selectedGuess: null,
  websocket: null,
  spotifyDeviceId: null,
  spotifyPlayer: null,
  spotifyPlayerReady: null,
  previewAudio: null,
  syncInFlight: false,
};

const els = {
  setupPanel: document.querySelector("#setup-panel"),
  roomPanel: document.querySelector("#room-panel"),
  gamePanel: document.querySelector("#game-panel"),
  createRoomBtn: document.querySelector("#create-room-btn"),
  joinRoomBtn: document.querySelector("#join-room-btn"),
  hostName: document.querySelector("#host-name"),
  playerName: document.querySelector("#player-name"),
  roomCodeInput: document.querySelector("#room-code"),
  roomCodeDisplay: document.querySelector("#room-code-display"),
  copyRoomCodeBtn: document.querySelector("#copy-room-code-btn"),
  connectSpotifyBtn: document.querySelector("#connect-spotify-btn"),
  spotifyStatus: document.querySelector("#spotify-status"),
  hostCacheStatus: document.querySelector("#host-cache-status"),
  roomHint: document.querySelector("#room-hint"),
  playersList: document.querySelector("#players-list"),
  playerCount: document.querySelector("#player-count"),
  hostControlsCard: document.querySelector("#host-controls-card"),
  hostSyncStatus: document.querySelector("#host-sync-status"),
  syncPlaylistsBtn: document.querySelector("#sync-playlists-btn"),
  guestPlaylistCard: document.querySelector("#guest-playlist-card"),
  guestPlaylistUrl: document.querySelector("#guest-playlist-url"),
  savePlaylistBtn: document.querySelector("#save-playlist-btn"),
  guestPlaylistStatus: document.querySelector("#guest-playlist-status"),
  roundCount: document.querySelector("#round-count"),
  startGameBtn: document.querySelector("#start-game-btn"),
  nextRoundBtn: document.querySelector("#next-round-btn"),
  roundProgress: document.querySelector("#round-progress"),
  albumCover: document.querySelector("#album-cover"),
  playbackStatus: document.querySelector("#playback-status"),
  playTrackBtn: document.querySelector("#play-track-btn"),
  playPreviewBtn: document.querySelector("#play-preview-btn"),
  revealBox: document.querySelector("#reveal-box"),
  guessOptions: document.querySelector("#guess-options"),
  submitGuessBtn: document.querySelector("#submit-guess-btn"),
};

const storageKey = "guessify-session";
const spotifySessionKey = "guessify-spotify";
const spotifyScopes = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "playlist-read-private",
  "playlist-read-collaborative",
];

async function boot() {
  state.config = await fetchJson("/api/config");
  restoreSession();
  restoreSpotifySession();
  await handleSpotifyCallback();
  bindEvents();
  if (state.roomCode && state.playerId) {
    await refreshRoom();
    connectWebSocket();
  }
  render();
}

function bindEvents() {
  els.createRoomBtn.addEventListener("click", onCreateRoom);
  els.joinRoomBtn.addEventListener("click", onJoinRoom);
  els.copyRoomCodeBtn.addEventListener("click", () => navigator.clipboard.writeText(state.roomCode ?? ""));
  els.connectSpotifyBtn.addEventListener("click", connectSpotify);
  els.syncPlaylistsBtn.addEventListener("click", syncRoomPlaylists);
  els.savePlaylistBtn.addEventListener("click", onSaveGuestPlaylist);
  els.startGameBtn.addEventListener("click", onStartGame);
  els.nextRoundBtn.addEventListener("click", onNextRound);
  els.submitGuessBtn.addEventListener("click", onSubmitGuess);
  els.playTrackBtn.addEventListener("click", onPlayTrack);
  els.playPreviewBtn.addEventListener("click", onPlayPreview);
}

async function onCreateRoom() {
  const hostName = els.hostName.value.trim();
  if (hostName.length < 2) {
    alert("Skriv inn navn på minst 2 tegn.");
    return;
  }
  const data = await fetchJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ host_name: hostName }),
  });
  state.roomCode = data.roomCode;
  state.playerId = data.playerId;
  state.room = data.room;
  persistSession();
  connectWebSocket();
  render();
}

async function onJoinRoom() {
  const name = els.playerName.value.trim();
  const roomCode = els.roomCodeInput.value.trim().toUpperCase();
  if (name.length < 2 || roomCode.length !== 5) {
    alert("Skriv inn navn og gyldig romkode.");
    return;
  }
  const data = await fetchJson(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  state.roomCode = data.roomCode;
  state.playerId = data.playerId;
  state.room = data.room;
  persistSession();
  connectWebSocket();
  render();
}

async function onSaveGuestPlaylist() {
  const value = els.guestPlaylistUrl.value.trim();
  const playlistId = extractPlaylistId(value);
  if (!playlistId) {
    alert("Lim inn en gyldig Spotify-playlist-lenke.");
    return;
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/playlist-link`, {
    method: "POST",
    body: JSON.stringify({
      playlist_id: playlistId,
      playlist_url: value,
    }),
  });
  els.guestPlaylistStatus.textContent = "Playlist lagret. Venter på at host importerer sporene.";
}

async function onStartGame() {
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/start`, {
    method: "POST",
    body: JSON.stringify({ rounds: Number(els.roundCount.value || 5) }),
  });
}

async function onNextRound() {
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/next`, {
    method: "POST",
  });
}

async function onSubmitGuess() {
  if (!state.selectedGuess) {
    alert("Velg en spiller først.");
    return;
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/guess`, {
    method: "POST",
    body: JSON.stringify({ guess_player_id: state.selectedGuess }),
  });
}

async function refreshRoom() {
  state.room = await fetchJson(`/api/rooms/${state.roomCode}`);
  render();
}

function connectWebSocket() {
  if (!state.roomCode || !state.playerId) {
    return;
  }
  state.websocket?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.websocket = new WebSocket(`${protocol}//${location.host}/ws/${state.roomCode}/${state.playerId}`);
  state.websocket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== "room_state") {
      return;
    }
    state.room = message.room;
      if (isHost()) {
        const cache = {
          savedAt: new Date().toISOString(),
          roomCode: state.room.code,
          players: state.room.players,
        };
        localStorage.setItem(`guessify-host-cache:${state.room.code}`, JSON.stringify(cache));
        if (state.spotifyToken && shouldAutoSyncRoom(state.room)) {
          syncRoomPlaylists().catch((error) => {
            els.hostSyncStatus.textContent = error.message || "Kunne ikke oppdatere spillelister.";
          });
        }
      }
    render();
  });
}

async function connectSpotify() {
  if (!isHost()) {
    alert("Bare host trenger Spotify-innlogging i hybridmodus.");
    return;
  }
  if (!state.config?.spotifyClientId) {
    alert("Mangler SPOTIFY_CLIENT_ID i servermiljoet.");
    return;
  }
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  sessionStorage.setItem("guessify-code-verifier", verifier);
  const redirectUri = state.config.spotifyRedirectUri || `${location.origin}/`;
  const params = new URLSearchParams({
    client_id: state.config.spotifyClientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: spotifyScopes.join(" "),
    state: JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId }),
  });
  location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleSpotifyCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const spotifyState = url.searchParams.get("state");
  if (!code) {
    return;
  }
  const verifier = sessionStorage.getItem("guessify-code-verifier");
  if (!verifier) {
    return;
  }
  const redirectUri = state.config.spotifyRedirectUri || `${location.origin}/`;
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: state.config.spotifyClientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokenData = await tokenResponse.json();
  state.spotifyToken = tokenData.access_token;
  sessionStorage.setItem(spotifySessionKey, JSON.stringify({ token: state.spotifyToken }));
  if (spotifyState) {
    const parsedState = JSON.parse(spotifyState);
    state.roomCode = parsedState.roomCode;
    state.playerId = parsedState.playerId;
    persistSession();
  }
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  history.replaceState({}, document.title, url.pathname);
  await syncHostLibrary();
  await refreshRoom();
  await syncRoomPlaylists();
}

async function syncHostLibrary() {
  if (!state.spotifyToken || !isHost()) {
    return;
  }
  const [profile, playlistsPage] = await Promise.all([
    fetchSpotify("https://api.spotify.com/v1/me"),
    fetchSpotify("https://api.spotify.com/v1/me/playlists?limit=10"),
  ]);
  state.spotifyProfile = profile;
  const playlists = playlistsPage.items || [];
  const tracks = [];
  for (const playlist of playlists) {
    const playlistTracks = await fetchPlaylistTracks(playlist.id, playlist.name);
    tracks.push(...playlistTracks);
  }
  const uniqueTracks = dedupeTracks(tracks);
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/host-spotify`, {
    method: "POST",
    body: JSON.stringify({
      spotify_id: profile.id,
      display_name: profile.display_name || profile.id,
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        trackCount: playlist.tracks?.total || 0,
      })),
      tracks: uniqueTracks,
    }),
  });
}

async function syncRoomPlaylists() {
  if (!isHost() || !state.spotifyToken || state.syncInFlight || !state.room) {
    return;
  }
  state.syncInFlight = true;
  try {
    els.hostSyncStatus.textContent = "Synkroniserer spillelister...";
    await syncHostLibrary();
    for (const player of state.room.players) {
      if (player.isHost || !player.guestPlaylistId || player.guestPlaylistSynced) {
        continue;
      }
      const playlistMeta = await fetchSpotify(`https://api.spotify.com/v1/playlists/${player.guestPlaylistId}?fields=name`);
      const tracks = await fetchPlaylistTracks(player.guestPlaylistId, playlistMeta.name);
      if (!tracks.length) {
        continue;
      }
      await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/import/${player.playerId}`, {
        method: "POST",
        body: JSON.stringify({
          playlist_id: player.guestPlaylistId,
          playlist_name: playlistMeta.name || "Spotify Playlist",
          tracks,
        }),
      });
    }
    els.hostSyncStatus.textContent = "Spillelister oppdatert.";
  } finally {
    state.syncInFlight = false;
  }
}

async function fetchPlaylistTracks(playlistId, fallbackName = null) {
  const payload = await fetchSpotify(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=items(track(id,name,uri,preview_url,artists(name),album(images))),next`,
  );
  const tracks = [];
  for (const item of payload.items || []) {
    if (!item.track?.id || !item.track?.uri) {
      continue;
    }
    tracks.push({
      id: item.track.id,
      name: item.track.name,
      uri: item.track.uri,
      previewUrl: item.track.preview_url,
      artists: (item.track.artists || []).map((artist) => artist.name),
      albumImage: item.track.album?.images?.[0]?.url || null,
      playlistName: fallbackName,
    });
  }
  return dedupeTracks(tracks);
}

async function onPlayTrack() {
  const round = state.room?.currentRound;
  if (!round?.uri) {
    return;
  }
  if (!state.spotifyToken || !isHost()) {
    els.playbackStatus.textContent = "Bare host med Spotify Premium kan spille av full låt.";
    return;
  }
  try {
    await ensureSpotifyWebPlayer();
    if (typeof state.spotifyPlayer.activateElement === "function") {
      await state.spotifyPlayer.activateElement();
    }
    await spotifyApiFetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      body: JSON.stringify({
        device_ids: [state.spotifyDeviceId],
        play: false,
      }),
    });
    await spotifyApiFetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.spotifyDeviceId}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [round.uri] }),
    });
    els.playbackStatus.textContent = "Spiller av via Spotify Premium.";
  } catch (error) {
    els.playbackStatus.textContent = error.message || "Spotify-avspilling feilet.";
  }
}

async function onPlayPreview() {
  const round = state.room?.currentRound;
  if (!round?.previewUrl) {
    alert("Denne sangen har ingen preview-url.");
    return;
  }
  state.previewAudio?.pause();
  state.previewAudio = new Audio(round.previewUrl);
  await state.previewAudio.play();
  els.playbackStatus.textContent = "Spiller 30-sekunders preview.";
}

async function ensureSpotifyWebPlayer() {
  if (state.spotifyPlayerReady) {
    await state.spotifyPlayerReady;
    return;
  }
  state.spotifyPlayerReady = new Promise(async (resolve, reject) => {
    if (!window.Spotify) {
      await loadScript("https://sdk.scdn.co/spotify-player.js");
      await new Promise((sdkResolve) => {
        if (window.Spotify) {
          sdkResolve();
          return;
        }
        window.onSpotifyWebPlaybackSDKReady = sdkResolve;
      });
    }
    state.spotifyPlayer = new Spotify.Player({
      name: "Guessify Host Player",
      getOAuthToken: (callback) => callback(state.spotifyToken),
      volume: 0.8,
    });
    state.spotifyPlayer.addListener("ready", ({ device_id }) => {
      state.spotifyDeviceId = device_id;
      resolve();
    });
    state.spotifyPlayer.addListener("initialization_error", ({ message }) => reject(new Error(message)));
    state.spotifyPlayer.addListener("authentication_error", ({ message }) => reject(new Error(message)));
    state.spotifyPlayer.addListener("account_error", ({ message }) => reject(new Error(message)));
    state.spotifyPlayer.addListener("playback_error", ({ message }) => {
      els.playbackStatus.textContent = message;
    });
    const connected = await state.spotifyPlayer.connect();
    if (!connected) {
      reject(new Error("Spotify SDK fikk ikke koblet til spilleren."));
    }
  });
  await state.spotifyPlayerReady;
}

function render() {
  const room = state.room;
  els.setupPanel.classList.toggle("hidden", Boolean(room));
  els.roomPanel.classList.toggle("hidden", !room);
  els.gamePanel.classList.toggle("hidden", !room?.currentRound);
  if (!room) {
    return;
  }
  els.roomCodeDisplay.textContent = room.code;
  els.playerCount.textContent = `${room.players.length} / 6`;
  els.spotifyStatus.textContent = state.spotifyToken && isHost()
    ? `Host koblet til som ${state.spotifyProfile?.display_name || "Spotify-bruker"}`
    : "Host ikke koblet til Spotify";
  const hostCache = localStorage.getItem(`guessify-host-cache:${room.code}`);
  els.hostCacheStatus.textContent = hostCache ? "Host-cache oppdatert lokalt" : "Host-cache tom";
  els.roomHint.textContent = isHost()
    ? "Gjestene limer inn offentlig playlist-lenke. Host importerer sporene."
    : "Lim inn en offentlig Spotify-playlist og vent på at host importerer den.";
  els.connectSpotifyBtn.classList.toggle("hidden", !isHost());
  els.hostControlsCard.classList.toggle("hidden", !isHost());
  els.guestPlaylistCard.classList.toggle("hidden", isHost());
  renderPlayers(room);
  renderGuestCard(room);
  renderGame(room);
}

function renderPlayers(room) {
  els.playersList.innerHTML = "";
  for (const player of room.players) {
    const item = document.createElement("li");
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <div>${escapeHtml(playerStatus(player))}</div>
      </div>
      <div class="pill">${player.score} poeng</div>
    `;
    els.playersList.appendChild(item);
  }
  const canStart =
    isHost() &&
    room.players.length >= 1 &&
    room.players.every((player) => player.ready) &&
    !room.started;
  els.startGameBtn.disabled = !canStart;
  els.syncPlaylistsBtn.disabled = !isHost() || !state.spotifyToken;
}

function renderGuestCard(room) {
  if (isHost()) {
    return;
  }
  const me = room.players.find((player) => player.playerId === state.playerId);
  els.guestPlaylistUrl.value = me?.guestPlaylistUrl || "";
  if (!me?.guestPlaylistId) {
    els.guestPlaylistStatus.textContent = "Ingen playlist lagret ennå.";
    return;
  }
  if (me.guestPlaylistSynced) {
    els.guestPlaylistStatus.textContent = `Klar: ${me.guestPlaylistName || "Playlist importert"} (${me.trackCount} spor).`;
    return;
  }
  els.guestPlaylistStatus.textContent = "Playlist lagret. Venter på at host importerer sporene.";
}

function renderGame(room) {
  const round = room.currentRound;
  els.nextRoundBtn.classList.toggle("hidden", !isHost() || !round?.revealed);
  if (!round) {
    return;
  }
  els.roundProgress.textContent = `${round.index + 1} / ${round.total}`;
  els.albumCover.src =
    round.albumImage ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' fill='%23f2d8b3'/%3E%3Ccircle cx='256' cy='256' r='110' fill='%23132a13' opacity='0.15'/%3E%3C/svg%3E";
  els.playbackStatus.textContent = round.revealed
    ? "Runden er avslørt. Se hvem som eide sangen."
    : `Venter på gjetninger: ${round.guessCount} / ${round.expectedGuessers}`;
  els.revealBox.classList.toggle("hidden", !round.revealed);
  if (round.revealed) {
    els.revealBox.innerHTML = `
      <strong>${escapeHtml(round.trackName || "")}</strong><br />
      ${escapeHtml((round.artists || []).join(", "))}<br />
      Tilhører: <strong>${escapeHtml(round.ownerName || "")}</strong>
    `;
  }
  renderGuessOptions(room);
}

function renderGuessOptions(room) {
  const round = room.currentRound;
  if (!round) {
    return;
  }
  const excludedOwnerId = round.revealed ? round.ownerPlayerId : null;
  els.guessOptions.innerHTML = "";
  state.selectedGuess = null;
  const allowSelfGuess = room.players.length === 1;
  for (const player of room.players) {
    if (player.playerId === state.playerId && !allowSelfGuess) {
      continue;
    }
    if (excludedOwnerId && player.playerId === excludedOwnerId) {
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "guess-option";
    button.innerHTML = `<span>${escapeHtml(player.name)}</span><span class="pill">${player.score} poeng</span>`;
    button.addEventListener("click", () => {
      state.selectedGuess = player.playerId;
      document.querySelectorAll(".guess-option").forEach((node) => node.classList.remove("selected"));
      button.classList.add("selected");
    });
    button.disabled = round.revealed;
    els.guessOptions.appendChild(button);
  }
  els.submitGuessBtn.disabled = round.revealed;
}

function playerStatus(player) {
  if (player.isHost) {
    if (player.spotifyConnected && player.trackCount > 0) {
      return `Host klar med ${player.trackCount} spor`;
    }
    return "Host må koble til Spotify";
  }
  if (player.guestPlaylistSynced && player.trackCount > 0) {
    return `${player.guestPlaylistName || "Playlist"} importert`;
  }
  if (player.guestPlaylistId) {
    return "Playlist lagret, venter på host";
  }
  return "Venter på offentlig playlist";
}

function shouldAutoSyncRoom(room) {
  const host = room.players.find((player) => player.playerId === state.playerId);
  if (!host?.trackCount) {
    return true;
  }
  return room.players.some((player) => !player.isHost && player.guestPlaylistId && !player.guestPlaylistSynced);
}

function isHost() {
  return state.room?.hostId === state.playerId;
}

function persistSession() {
  localStorage.setItem(storageKey, JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId }));
}

function restoreSession() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return;
  }
  try {
    const saved = JSON.parse(raw);
    state.roomCode = saved.roomCode;
    state.playerId = saved.playerId;
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function restoreSpotifySession() {
  const raw = sessionStorage.getItem(spotifySessionKey);
  if (!raw) {
    return;
  }
  try {
    const saved = JSON.parse(raw);
    state.spotifyToken = saved.token || null;
  } catch {
    sessionStorage.removeItem(spotifySessionKey);
  }
}

function extractPlaylistId(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "playlist" && parts[1]) {
      return parts[1];
    }
  } catch {}
  const match = value.match(/playlist[:/](?<id>[A-Za-z0-9]+)/);
  return match?.groups?.id || null;
}

function dedupeTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (seen.has(track.id)) {
      return false;
    }
    seen.add(track.id);
    return true;
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Ukjent feil" }));
    throw new Error(error.detail || "Kallet feilet");
  }
  return response.json();
}

async function fetchSpotify(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${state.spotifyToken}` },
  });
  if (!response.ok) {
    let detail = "Spotify-kall feilet.";
    try {
      const data = await response.json();
      detail = data.error?.message || detail;
    } catch {}
    throw new Error(detail);
  }
  return response.json();
}

async function spotifyApiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.spotifyToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = "Spotify-kall feilet.";
    try {
      const data = await response.json();
      detail = data.error?.message || detail;
    } catch {}
    throw new Error(detail);
  }
  return response;
}

async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((value) => chars[value % chars.length])
    .join("");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

boot().catch((error) => {
  console.error(error);
  alert(error.message || "Noe gikk galt.");
});
