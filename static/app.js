const state = {
  config: null,
  roomCode: null,
  playerId: null,
  room: null,
  spotifyToken: null,
  spotifyProfile: null,
  hostPlaylists: [],
  selectedHostPlaylistId: null,
  websocket: null,
  spotifyDeviceId: null,
  spotifyPlayer: null,
  spotifyPlayerReady: null,
  previewAudio: null,
  syncInFlight: false,
  submittingGuess: false,
  activeRoundToken: null,
  roundAnnouncement: "",
  roundAnnouncementTimer: null,
  websocketReconnectTimer: null,
  phaseTickTimer: null,
  suppressReconnect: false,
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
  leaveRoomBtn: document.querySelector("#leave-room-btn"),
  endRoomBtn: document.querySelector("#end-room-btn"),
  spotifyStatus: document.querySelector("#spotify-status"),
  hostCacheStatus: document.querySelector("#host-cache-status"),
  roomHint: document.querySelector("#room-hint"),
  playersList: document.querySelector("#players-list"),
  playerCount: document.querySelector("#player-count"),
  hostControlsCard: document.querySelector("#host-controls-card"),
  hostSyncStatus: document.querySelector("#host-sync-status"),
  syncPlaylistsBtn: document.querySelector("#sync-playlists-btn"),
  hostPlaylistSelect: document.querySelector("#host-playlist-select"),
  guestPlaylistCard: document.querySelector("#guest-playlist-card"),
  guestPlaylistUrl: document.querySelector("#guest-playlist-url"),
  savePlaylistBtn: document.querySelector("#save-playlist-btn"),
  guestPlaylistStatus: document.querySelector("#guest-playlist-status"),
  roundCount: document.querySelector("#round-count"),
  guessDuration: document.querySelector("#guess-duration"),
  startGameBtn: document.querySelector("#start-game-btn"),
  resetGameBtn: document.querySelector("#reset-game-btn"),
  nextRoundBtn: document.querySelector("#next-round-btn"),
  roundProgress: document.querySelector("#round-progress"),
  roundAnnouncement: document.querySelector("#round-announcement"),
  phaseTimer: document.querySelector("#phase-timer"),
  albumCover: document.querySelector("#album-cover"),
  playbackStatus: document.querySelector("#playback-status"),
  playTrackBtn: document.querySelector("#play-track-btn"),
  playPreviewBtn: document.querySelector("#play-preview-btn"),
  pauseGameBtn: document.querySelector("#pause-game-btn"),
  revealBox: document.querySelector("#reveal-box"),
  guessOptions: document.querySelector("#guess-options"),
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
  startPhaseTicker();
  if (state.roomCode && state.playerId) {
    await refreshRoom();
    connectWebSocket();
    if (state.spotifyToken && isHost()) {
      await syncRoomPlaylists().catch((error) => {
        els.hostSyncStatus.textContent = error.message || "Kunne ikke oppdatere spillelister.";
      });
    }
  }
  render();
}

function bindEvents() {
  els.createRoomBtn?.addEventListener("click", onCreateRoom);
  els.joinRoomBtn?.addEventListener("click", onJoinRoom);
  els.copyRoomCodeBtn?.addEventListener("click", () => navigator.clipboard.writeText(state.roomCode ?? ""));
  els.connectSpotifyBtn?.addEventListener("click", connectSpotify);
  els.leaveRoomBtn?.addEventListener("click", onLeaveRoom);
  els.endRoomBtn?.addEventListener("click", onEndRoom);
  els.syncPlaylistsBtn?.addEventListener("click", syncRoomPlaylists);
  els.hostPlaylistSelect?.addEventListener("change", onHostPlaylistChange);
  els.savePlaylistBtn?.addEventListener("click", onSaveGuestPlaylist);
  els.startGameBtn?.addEventListener("click", onStartGame);
  els.resetGameBtn?.addEventListener("click", onResetGame);
  els.nextRoundBtn?.addEventListener("click", onNextRound);
  els.pauseGameBtn?.addEventListener("click", onTogglePause);
  els.playTrackBtn?.addEventListener("click", onPlayTrack);
  els.playPreviewBtn?.addEventListener("click", onPlayPreview);
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

async function onHostPlaylistChange() {
  state.selectedHostPlaylistId = els.hostPlaylistSelect.value || null;
  if (!state.selectedHostPlaylistId || !state.spotifyToken || !isHost()) {
    return;
  }
  await syncHostLibrary();
  await refreshRoom();
}

async function onStartGame() {
  await saveGuessDuration();
  if (isHost() && state.spotifyToken) {
    if (!state.selectedHostPlaylistId) {
      alert("Velg din egen Spotify-playlist først.");
      return;
    }
    await syncRoomPlaylists();
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/start`, {
    method: "POST",
    body: JSON.stringify({ rounds: Number(els.roundCount.value || 5) }),
  });
}

async function onResetGame() {
  if (!confirm("Vil du starte et nytt spill? Poeng og runder nullstilles.")) {
    return;
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/reset`, {
    method: "POST",
  });
}

async function onNextRound() {
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/next`, {
    method: "POST",
  });
}

async function onTogglePause() {
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/pause`, {
    method: "POST",
  });
}

async function onLeaveRoom() {
  if (!confirm("Vil du forlate rommet?")) {
    return;
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/leave`, {
    method: "POST",
  }).catch(() => {});
  clearRoomState();
  render();
}

async function onEndRoom() {
  if (!confirm("Vil du avslutte spillet for alle og stenge rommet?")) {
    return;
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/end`, {
    method: "POST",
  }).catch(() => {});
  clearRoomState();
  render();
}

async function saveGuessDuration() {
  if (!isHost() || state.room?.started) {
    return;
  }
  const guessDurationSeconds = Number(els.guessDuration.value || 15);
  if (guessDurationSeconds === state.room?.guessDurationSeconds) {
    return;
  }
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/settings`, {
    method: "POST",
    body: JSON.stringify({ guess_duration_seconds: guessDurationSeconds }),
  });
}

async function submitGuess(guessPlayerId) {
  if (state.submittingGuess) {
    return;
  }
  state.submittingGuess = true;
  try {
    await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/guess`, {
      method: "POST",
      body: JSON.stringify({ guess_player_id: guessPlayerId }),
    });
  } finally {
    state.submittingGuess = false;
  }
}

async function refreshRoom() {
  try {
    state.room = await fetchJson(`/api/rooms/${state.roomCode}`);
    render();
  } catch (error) {
    if (error.message?.includes("Fant ikke rommet")) {
      clearRoomState();
      render();
      return;
    }
    throw error;
  }
}

function connectWebSocket() {
  if (!state.roomCode || !state.playerId) {
    return;
  }
  state.suppressReconnect = false;
  clearTimeout(state.websocketReconnectTimer);
  state.websocket?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.websocket = new WebSocket(`${protocol}//${location.host}/ws/${state.roomCode}/${state.playerId}`);
  state.websocket.addEventListener("open", () => {
    clearTimeout(state.websocketReconnectTimer);
  });
  state.websocket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "room_closed") {
      clearRoomState();
      render();
      alert("Rommet ble avsluttet av host.");
      return;
    }
    if (message.type !== "room_state") {
      return;
    }
    const previousRoundToken = getRoundToken(state.room);
    state.room = message.room;
    handleRoundStateChange(previousRoundToken, getRoundToken(state.room));
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
  state.websocket.addEventListener("close", scheduleWebSocketReconnect);
  state.websocket.addEventListener("error", scheduleWebSocketReconnect);
}

function scheduleWebSocketReconnect() {
  if (state.suppressReconnect || !state.roomCode || !state.playerId) {
    return;
  }
  clearTimeout(state.websocketReconnectTimer);
  state.websocketReconnectTimer = window.setTimeout(async () => {
    try {
      await refreshRoom();
    } catch {}
    if (state.suppressReconnect || !state.roomCode || !state.playerId) {
      return;
    }
    connectWebSocket();
  }, 1000);
}

function startPhaseTicker() {
  clearInterval(state.phaseTickTimer);
  state.phaseTickTimer = window.setInterval(() => {
    updatePhaseTimer();
  }, 250);
}

function updatePhaseTimer() {
  const round = state.room?.currentRound;
  if (!round || !els.phaseTimer) {
    return;
  }
  if (round.paused) {
    const remaining = Math.max(Math.ceil(round.pausedRemainingSeconds || 0), 0);
    els.phaseTimer.textContent = `Pauset med ${remaining}s igjen`;
    return;
  }
  if (!round.phaseEndsAt) {
    els.phaseTimer.textContent = "";
    return;
  }
  const remaining = Math.max(Math.ceil(round.phaseEndsAt - Date.now() / 1000), 0);
  if (round.phase === "guessing") {
    els.phaseTimer.textContent = `Tid igjen: ${remaining}s`;
    return;
  }
  if (round.phase === "reveal") {
    els.phaseTimer.textContent = `Neste sang om ${remaining}s`;
    return;
  }
  els.phaseTimer.textContent = "";
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
  const [profile, playlists] = await Promise.all([
    fetchSpotify("https://api.spotify.com/v1/me"),
    fetchAllSpotifyPlaylists(),
  ]);
  state.spotifyProfile = profile;
  state.hostPlaylists = playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.tracks?.total || 0,
  }));
  if (!state.selectedHostPlaylistId && state.hostPlaylists.length) {
    state.selectedHostPlaylistId = state.hostPlaylists[0].id;
  }
  renderHostPlaylistSelect();
  if (!state.selectedHostPlaylistId) {
    await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/host-spotify`, {
      method: "POST",
      body: JSON.stringify({
        spotify_id: profile.id,
        display_name: profile.display_name || profile.id,
        playlists: state.hostPlaylists,
        tracks: [],
      }),
    });
    els.hostSyncStatus.textContent = "Velg en host-playlist for aa bruke dine egne spor.";
    return;
  }
  const selectedPlaylist = state.hostPlaylists.find((playlist) => playlist.id === state.selectedHostPlaylistId);
  const tracks = await fetchPlaylistTracks(state.selectedHostPlaylistId, selectedPlaylist?.name || null);
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/host-spotify`, {
    method: "POST",
    body: JSON.stringify({
      spotify_id: profile.id,
      display_name: profile.display_name || profile.id,
      playlists: state.hostPlaylists,
      tracks,
    }),
  });
  els.hostSyncStatus.textContent = selectedPlaylist
    ? `Host-playlist valgt: ${selectedPlaylist.name}.`
    : "Host-playlist oppdatert.";
}

async function fetchAllSpotifyPlaylists() {
  const playlists = [];
  let url = "https://api.spotify.com/v1/me/playlists?limit=50";
  while (url) {
    const page = await fetchSpotify(url);
    playlists.push(...(page.items || []));
    url = page.next;
  }
  return playlists;
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
  } catch (error) {
    const message = error.message || "Kunne ikke oppdatere spillelister.";
    if (message.toLowerCase().includes("token") || message.toLowerCase().includes("expired")) {
      els.hostSyncStatus.textContent = "Spotify-innloggingen er utgaatt. Koble til Spotify pa nytt.";
    } else {
      els.hostSyncStatus.textContent = message;
    }
    throw error;
  } finally {
    state.syncInFlight = false;
  }
}

async function fetchPlaylistTracks(playlistId, fallbackName = null) {
  const tracks = [];
  let url =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,uri,preview_url,artists(name),album(images))),next`;
  while (url) {
    const payload = await fetchSpotify(url);
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
    url = payload.next;
  }
  return dedupeTracks(tracks);
}

async function onPlayTrack() {
  const round = state.room?.currentRound;
  if (!round?.uri) {
    return false;
  }
  if (!state.spotifyToken || !isHost()) {
    els.playbackStatus.textContent = "Bare host med Spotify Premium kan spille av full låt.";
    return false;
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
    return true;
  } catch (error) {
    els.playbackStatus.textContent = error.message || "Spotify-avspilling feilet.";
    return false;
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

function handleRoundStateChange(previousRoundToken, nextRoundToken) {
  if (!nextRoundToken || previousRoundToken === nextRoundToken) {
    return;
  }
  state.previewAudio?.pause();
  state.previewAudio = null;
  state.activeRoundToken = nextRoundToken;
  const round = state.room?.currentRound;
  if (round?.phase === "guessing") {
    announceRound(round);
  }
  if (!round || round.revealed) {
    return;
  }
  playRoundAudioForCurrentUser().catch(() => {
    if (els.playbackStatus) {
      els.playbackStatus.textContent = "Ny runde er startet. Trykk Spill preview hvis lyden ikke startet automatisk.";
    }
  });
}

async function playRoundAudioForCurrentUser() {
  if (isHost() && state.spotifyToken) {
    const started = await onPlayTrack();
    if (started) {
      return;
    }
  }
  await playRoundPreviewForEveryone();
}

async function playRoundPreviewForEveryone() {
  const round = state.room?.currentRound;
  if (!round?.previewUrl) {
    return;
  }
  state.previewAudio?.pause();
  state.previewAudio = new Audio(round.previewUrl);
  await state.previewAudio.play();
  els.playbackStatus.textContent = "Ny runde startet. Spiller preview for alle.";
}

function announceRound(round) {
  if (!round) {
    return;
  }
  state.roundAnnouncement = `Runde ${round.index + 1} av ${round.total} starter nå`;
  clearTimeout(state.roundAnnouncementTimer);
  state.roundAnnouncementTimer = window.setTimeout(() => {
    state.roundAnnouncement = "";
    render();
  }, 3500);
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
  els.endRoomBtn.classList.toggle("hidden", !isHost());
  els.leaveRoomBtn.classList.toggle("hidden", isHost() || !room.winnerId);
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
  if (els.guessDuration) {
    els.guessDuration.value = String(room.guessDurationSeconds || 15);
    els.guessDuration.disabled = !isHost() || room.started;
  }
  els.startGameBtn.disabled = !canStart;
  const canResetGame = isHost() && Boolean(room.started || room.currentRound || room.winnerId);
  els.resetGameBtn.classList.toggle("hidden", !canResetGame);
  els.syncPlaylistsBtn.disabled = !isHost() || !state.spotifyToken;
  renderHostPlaylistSelect();
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
  els.nextRoundBtn.classList.toggle("hidden", !isHost() || !round);
  els.resetGameBtn.classList.toggle("hidden", !isHost() || !Boolean(room.started || room.currentRound || room.winnerId));
  els.pauseGameBtn.classList.toggle("hidden", !isHost() || !round || !room.started);
  if (!round) {
    els.roundAnnouncement.textContent = "";
    els.roundAnnouncement.classList.add("hidden");
    els.phaseTimer.textContent = "";
    return;
  }
  els.roundAnnouncement.textContent = state.roundAnnouncement;
  els.roundAnnouncement.classList.toggle("hidden", !state.roundAnnouncement);
  els.pauseGameBtn.textContent = round.paused ? "Fortsett" : "Pause";
  els.nextRoundBtn.textContent = round.phase === "guessing" ? "Avslør nå" : "Neste nå";
  els.roundProgress.textContent = `${round.index + 1} / ${round.total}`;
  els.albumCover.src =
    round.albumImage ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' fill='%23f2d8b3'/%3E%3Ccircle cx='256' cy='256' r='110' fill='%23132a13' opacity='0.15'/%3E%3C/svg%3E";
  els.playbackStatus.textContent = round.revealed
    ? "Runden er avslørt. Se hvem som eide sangen."
    : `Venter på gjetninger: ${round.guessCount} / ${round.expectedGuessers}`;
  if (round.phase === "guessing" && round.paused) {
    els.playbackStatus.textContent = "Runden er pauset.";
  }
  if (!room.started && room.winnerId) {
    const winner = room.players.find((player) => player.playerId === room.winnerId);
    els.playbackStatus.textContent = winner
      ? `Spillet er ferdig. Vinner: ${winner.name}.`
      : "Spillet er ferdig.";
  }
  els.revealBox.classList.toggle("hidden", !round.revealed);
  if (round.revealed) {
    els.revealBox.innerHTML = `
      <strong>${escapeHtml(round.trackName || "")}</strong><br />
      ${escapeHtml((round.artists || []).join(", "))}<br />
      Tilhører: <strong>${escapeHtml(round.ownerName || "")}</strong>
    `;
  }
  updatePhaseTimer();
  renderGuessOptions(room);
}

function renderGuessOptions(room) {
  const round = room.currentRound;
  if (!round) {
    return;
  }
  const currentGuess = room.guesses?.[state.playerId] || null;
  const hasSubmittedGuess = Boolean(currentGuess);
  els.guessOptions.innerHTML = "";
  for (const player of room.players) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "guess-option";
    if (currentGuess === player.playerId) {
      button.classList.add("selected");
    }
    button.innerHTML = `<span>${escapeHtml(player.name)}</span><span class="pill">${player.score} poeng</span>`;
    button.addEventListener("click", async () => {
      if (round.phase !== "guessing" || round.paused || hasSubmittedGuess) {
        return;
      }
      try {
        await submitGuess(player.playerId);
      } catch (error) {
        alert(error.message || "Kunne ikke sende inn gjetningen.");
      }
    });
    button.disabled = round.phase !== "guessing" || round.paused || hasSubmittedGuess || state.submittingGuess;
    els.guessOptions.appendChild(button);
  }
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

function renderHostPlaylistSelect() {
  if (!els.hostPlaylistSelect) {
    return;
  }
  const previousValue = state.selectedHostPlaylistId || "";
  els.hostPlaylistSelect.innerHTML = '<option value="">Velg en Spotify-playlist</option>';
  for (const playlist of state.hostPlaylists) {
    const option = document.createElement("option");
    option.value = playlist.id;
    option.textContent = formatPlaylistOptionLabel(playlist.name, playlist.trackCount);
    option.title = `${playlist.name} (${playlist.trackCount} spor)`;
    els.hostPlaylistSelect.appendChild(option);
  }
  els.hostPlaylistSelect.value = previousValue;
  els.hostPlaylistSelect.disabled = !isHost() || !state.spotifyToken || Boolean(state.room?.started);
}

function formatPlaylistOptionLabel(name, trackCount) {
  const suffix = ` (${trackCount} spor)`;
  const maxNameLength = 28;
  const trimmedName = name.length > maxNameLength ? `${name.slice(0, maxNameLength - 1).trimEnd()}…` : name;
  return `${trimmedName}${suffix}`;
}

function shouldAutoSyncRoom(room) {
  const host = room.players.find((player) => player.playerId === state.playerId);
  if (!host?.trackCount) {
    return true;
  }
  return room.players.some((player) => !player.isHost && player.guestPlaylistId && !player.guestPlaylistSynced);
}

function getRoundToken(room) {
  const round = room?.currentRound;
  if (!round) {
    return null;
  }
  return `${round.index}:${round.uri}:${round.revealed}`;
}

function isHost() {
  return state.room?.hostId === state.playerId;
}

function persistSession() {
  localStorage.setItem(storageKey, JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId }));
}

function clearRoomState() {
  state.suppressReconnect = true;
  if (state.roomCode) {
    localStorage.removeItem(`guessify-host-cache:${state.roomCode}`);
  }
  state.previewAudio?.pause();
  state.previewAudio = null;
  clearTimeout(state.websocketReconnectTimer);
  state.websocket?.close();
  state.websocket = null;
  state.room = null;
  state.roomCode = null;
  state.playerId = null;
  state.activeRoundToken = null;
  state.roundAnnouncement = "";
  localStorage.removeItem(storageKey);
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
