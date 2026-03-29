const state = {
  config: null,
  roomCode: null,
  playerId: null,
  room: null,
  spotifyToken: null,
  spotifyRefreshToken: null,
  spotifyTokenExpiresAt: null,
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
  gameMode: "chill",
  selectedCategory: "top10",
  exposedSynced: false,
  winnerPopupShown: false,
  gameMinimized: false,
  lastShownRoundToken: null,
};

const els = {
  modePanel: document.querySelector("#mode-panel"),
  modeChill: document.querySelector("#mode-chill-btn"),
  modeExposed: document.querySelector("#mode-exposed-btn"),
  setupPanel: document.querySelector("#setup-panel"),
  backToModeBtn: document.querySelector("#back-to-mode-btn"),
  selectedModeLabel: document.querySelector("#selected-mode-label"),
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
  gameModeBadge: document.querySelector("#game-mode-badge"),
  playersList: document.querySelector("#players-list"),
  playerCount: document.querySelector("#player-count"),
  // Chill host
  hostControlsCard: document.querySelector("#host-controls-card"),
  hostSyncStatus: document.querySelector("#host-sync-status"),
  syncPlaylistsBtn: document.querySelector("#sync-playlists-btn"),
  hostPlaylistSelect: document.querySelector("#host-playlist-select"),
  roundCount: document.querySelector("#round-count"),
  guessDuration: document.querySelector("#guess-duration"),
  startGameBtn: document.querySelector("#start-game-btn"),
  nextRoundBtn: document.querySelector("#next-round-btn"),
  // Exposed host
  hostExposedCard: document.querySelector("#host-exposed-card"),
  hostExposedStatus: document.querySelector("#host-exposed-status"),
  categorySelect: document.querySelector("#category-select"),
  setCategoryBtn: document.querySelector("#set-category-btn"),
  exposedRoundCount: document.querySelector("#exposed-round-count"),
  exposedGuessDuration: document.querySelector("#exposed-guess-duration"),
  exposedStartGameBtn: document.querySelector("#exposed-start-game-btn"),
  exposedNextRoundBtn: document.querySelector("#exposed-next-round-btn"),
  // Chill guest
  guestPlaylistCard: document.querySelector("#guest-playlist-card"),
  guestPlaylistUrl: document.querySelector("#guest-playlist-url"),
  savePlaylistBtn: document.querySelector("#save-playlist-btn"),
  guestPlaylistStatus: document.querySelector("#guest-playlist-status"),
  // Exposed guest
  guestExposedCard: document.querySelector("#guest-exposed-card"),
  guestExposedDesc: document.querySelector("#guest-exposed-desc"),
  guestConnectSpotifyBtn: document.querySelector("#guest-connect-spotify-btn"),
  guestExposedStatus: document.querySelector("#guest-exposed-status"),
  // Game
  resetGameBtn: document.querySelector("#reset-game-btn"),
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
  // Overlay extras
  gameMinimizeBtn: document.querySelector("#game-minimize-btn"),
  scoreboardList: document.querySelector("#scoreboard-list"),
  // Winner popup
  winnerPopup: document.querySelector("#winner-popup"),
  winnerTitle: document.querySelector("#winner-title"),
  winnerName: document.querySelector("#winner-name"),
  winnerScore: document.querySelector("#winner-score"),
  winnerPodium: document.querySelector("#winner-podium"),
  winnerConfetti: document.querySelector("#winner-confetti"),
  winnerNewGameBtn: document.querySelector("#winner-new-game-btn"),
  winnerCloseBtn: document.querySelector("#winner-close-btn"),
};

const storageKey = "guessify-session";
const spotifySessionKey = "guessify-spotify";

const spotifyScopesBase = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "playlist-read-private",
  "playlist-read-collaborative",
];

const spotifyScopesExposed = [
  ...spotifyScopesBase,
  "user-top-read",
  "user-read-recently-played",
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
    if (state.spotifyToken && isHost() && state.gameMode === "chill") {
      await syncRoomPlaylists().catch((error) => {
        if (els.hostSyncStatus) els.hostSyncStatus.textContent = error.message || "Kunne ikke oppdatere spillelister.";
      });
    }
  }
  render();
}

function bindEvents() {
  // Mode selection
  els.modeChill?.addEventListener("click", () => selectMode("chill"));
  els.modeExposed?.addEventListener("click", () => selectMode("exposed"));
  els.modeChill?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectMode("chill"); });
  els.modeExposed?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectMode("exposed"); });
  els.backToModeBtn?.addEventListener("click", () => {
    els.setupPanel.classList.add("hidden");
    els.modePanel.classList.remove("hidden");
  });

  // Setup
  els.createRoomBtn?.addEventListener("click", onCreateRoom);
  els.joinRoomBtn?.addEventListener("click", onJoinRoom);

  // Room
  els.copyRoomCodeBtn?.addEventListener("click", () => navigator.clipboard.writeText(state.roomCode ?? ""));
  els.connectSpotifyBtn?.addEventListener("click", connectSpotify);
  els.leaveRoomBtn?.addEventListener("click", onLeaveRoom);
  els.endRoomBtn?.addEventListener("click", onEndRoom);

  // Chill host
  els.syncPlaylistsBtn?.addEventListener("click", syncRoomPlaylists);
  els.hostPlaylistSelect?.addEventListener("change", onHostPlaylistChange);
  els.startGameBtn?.addEventListener("click", onStartGame);
  els.nextRoundBtn?.addEventListener("click", onNextRound);

  // Exposed host
  els.setCategoryBtn?.addEventListener("click", onSetCategory);
  els.exposedStartGameBtn?.addEventListener("click", onStartGameExposed);
  els.exposedNextRoundBtn?.addEventListener("click", onNextRound);

  // Chill guest
  els.savePlaylistBtn?.addEventListener("click", onSaveGuestPlaylist);

  // Exposed guest
  els.guestConnectSpotifyBtn?.addEventListener("click", connectSpotifyGuest);

  // Game
  els.resetGameBtn?.addEventListener("click", onResetGame);
  els.pauseGameBtn?.addEventListener("click", onTogglePause);
  els.playTrackBtn?.addEventListener("click", onPlayTrack);
  els.playPreviewBtn?.addEventListener("click", onPlayPreview);

  // Game overlay minimize
  els.gameMinimizeBtn?.addEventListener("click", () => {
    state.gameMinimized = true;
    els.gamePanel.classList.add("hidden");
  });

  // Winner popup
  els.winnerCloseBtn?.addEventListener("click", closeWinnerPopup);
  els.winnerNewGameBtn?.addEventListener("click", () => {
    closeWinnerPopup();
    onResetGame();
  });
}

function selectMode(mode) {
  state.gameMode = mode;
  localStorage.setItem("guessify-mode", mode);
  els.modePanel.classList.add("hidden");
  els.setupPanel.classList.remove("hidden");
  updateModeBadge();
}

function updateModeBadge() {
  if (!els.selectedModeLabel) return;
  if (state.gameMode === "exposed") {
    els.selectedModeLabel.textContent = "🔥 Exposed";
    els.selectedModeLabel.className = "mode-badge exposed";
  } else {
    els.selectedModeLabel.textContent = "🎵 Chill";
    els.selectedModeLabel.className = "mode-badge chill";
  }
}

async function onCreateRoom() {
  const hostName = els.hostName.value.trim();
  if (hostName.length < 2) {
    alert("Skriv inn navn på minst 2 tegn.");
    return;
  }
  try {
    const data = await fetchJson("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ host_name: hostName, game_mode: state.gameMode }),
    });
    state.roomCode = data.roomCode;
    state.playerId = data.playerId;
    state.room = data.room;
    persistSession();
    connectWebSocket();
  } catch (error) {
    alert(error.message || "Kunne ikke opprette rom.");
    return;
  }
  render();
}

async function onJoinRoom() {
  const name = els.playerName.value.trim();
  const roomCode = els.roomCodeInput.value.trim().toUpperCase();
  if (name.length < 2 || roomCode.length !== 5) {
    alert("Skriv inn navn og gyldig romkode.");
    return;
  }
  try {
    const data = await fetchJson(`/api/rooms/${roomCode}/join`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    state.roomCode = data.roomCode;
    state.playerId = data.playerId;
    state.room = data.room;
    // Detect mode from room
    state.gameMode = data.room.gameMode || "chill";
    persistSession();
    connectWebSocket();
  } catch (error) {
    alert(error.message || "Kunne ikke bli med i rommet.");
    return;
  }
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
    body: JSON.stringify({ playlist_id: playlistId, playlist_url: value }),
  });
  els.guestPlaylistStatus.textContent = "Playlist lagret. Venter på at host importerer sporene.";
}

async function onSetCategory() {
  const category = els.categorySelect?.value || "top10";
  state.selectedCategory = category;
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/category`, {
    method: "POST",
    body: JSON.stringify({ category }),
  });
  if (els.hostExposedStatus) els.hostExposedStatus.textContent = `Kategori satt: ${categoryLabel(category)}`;
}

async function onHostPlaylistChange() {
  state.selectedHostPlaylistId = els.hostPlaylistSelect.value || null;
  if (!state.selectedHostPlaylistId || !state.spotifyToken || !isHost()) return;
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

async function onStartGameExposed() {
  if (!state.spotifyToken) {
    alert("Du må koble til Spotify Premium først.");
    return;
  }
  const guessDuration = Number(els.exposedGuessDuration?.value || 15);
  if (guessDuration !== state.room?.guessDurationSeconds) {
    await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/settings`, {
      method: "POST",
      body: JSON.stringify({ guess_duration_seconds: guessDuration }),
    });
  }
  // Ensure category is set
  await onSetCategory();
  // Sync host's own Exposed tracks
  await syncExposedHostLibrary();
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/start`, {
    method: "POST",
    body: JSON.stringify({ rounds: Number(els.exposedRoundCount?.value || 5) }),
  });
}

async function onResetGame() {
  if (!confirm("Vil du starte et nytt spill? Poeng og runder nullstilles.")) return;
  closeWinnerPopup();
  state.winnerPopupShown = false;
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
  if (!confirm("Vil du forlate rommet?")) return;
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/leave`, {
    method: "POST",
  }).catch(() => {});
  clearRoomState();
  render();
}

async function onEndRoom() {
  if (!confirm("Vil du avslutte spillet for alle og stenge rommet?")) return;
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/end`, {
    method: "POST",
  }).catch(() => {});
  clearRoomState();
  render();
}

async function saveGuessDuration() {
  if (!isHost() || state.room?.started) return;
  const guessDurationSeconds = Number(els.guessDuration.value || 15);
  if (guessDurationSeconds === state.room?.guessDurationSeconds) return;
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/settings`, {
    method: "POST",
    body: JSON.stringify({ guess_duration_seconds: guessDurationSeconds }),
  });
}

async function submitGuess(guessPlayerId) {
  if (state.submittingGuess) return;
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
    if (state.room?.gameMode) state.gameMode = state.room.gameMode;
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
  if (!state.roomCode || !state.playerId) return;
  state.suppressReconnect = false;
  clearTimeout(state.websocketReconnectTimer);
  state.websocket?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.websocket = new WebSocket(`${protocol}//${location.host}/ws/${state.roomCode}/${state.playerId}`);
  state.websocket.addEventListener("open", () => clearTimeout(state.websocketReconnectTimer));
  state.websocket.addEventListener("message", async (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "room_closed") {
      clearRoomState();
      render();
      alert("Rommet ble avsluttet av host.");
      return;
    }
    if (message.type !== "room_state") return;
    const previousRoundToken = getRoundToken(state.room);
    state.room = message.room;
    if (state.room?.gameMode) state.gameMode = state.room.gameMode;
    handleRoundStateChange(previousRoundToken, getRoundToken(state.room));
    if (isHost()) {
      const cache = { savedAt: new Date().toISOString(), roomCode: state.room.code, players: state.room.players };
      localStorage.setItem(`guessify-host-cache:${state.room.code}`, JSON.stringify(cache));
      if (state.spotifyToken && state.gameMode === "chill" && shouldAutoSyncRoom(state.room)) {
        syncRoomPlaylists().catch((error) => {
          if (els.hostSyncStatus) els.hostSyncStatus.textContent = error.message || "Kunne ikke oppdatere spillelister.";
        });
      }
    }
    render();
  });
  state.websocket.addEventListener("close", scheduleWebSocketReconnect);
  state.websocket.addEventListener("error", scheduleWebSocketReconnect);
}

function scheduleWebSocketReconnect() {
  if (state.suppressReconnect || !state.roomCode || !state.playerId) return;
  clearTimeout(state.websocketReconnectTimer);
  state.websocketReconnectTimer = window.setTimeout(async () => {
    try { await refreshRoom(); } catch {}
    if (state.suppressReconnect || !state.roomCode || !state.playerId) return;
    connectWebSocket();
  }, 1000);
}

function startPhaseTicker() {
  clearInterval(state.phaseTickTimer);
  state.phaseTickTimer = window.setInterval(() => updatePhaseTimer(), 250);
}

function updatePhaseTimer() {
  const round = state.room?.currentRound;
  if (!round || !els.phaseTimer) return;
  if (round.paused) {
    els.phaseTimer.textContent = `⏸ ${Math.max(Math.ceil(round.pausedRemainingSeconds || 0), 0)}s`;
    els.phaseTimer.classList.remove("timer-urgent");
    return;
  }
  if (!round.phaseEndsAt) { els.phaseTimer.textContent = ""; els.phaseTimer.classList.remove("timer-urgent"); return; }
  const remaining = Math.max(Math.ceil(round.phaseEndsAt - Date.now() / 1000), 0);
  if (round.phase === "guessing") {
    els.phaseTimer.textContent = `${remaining}s`;
    els.phaseTimer.classList.toggle("timer-urgent", remaining <= 5);
    return;
  }
  if (round.phase === "reveal") {
    els.phaseTimer.textContent = `Neste om ${remaining}s`;
    els.phaseTimer.classList.remove("timer-urgent");
    return;
  }
  els.phaseTimer.textContent = "";
  els.phaseTimer.classList.remove("timer-urgent");
}

// SPOTIFY CONNECT (host / chill mode)
async function connectSpotify() {
  if (!isHost()) {
    alert("Bare host trenger Spotify-innlogging i Chill-modus.");
    return;
  }
  if (!state.config?.spotifyClientId) {
    alert("Mangler SPOTIFY_CLIENT_ID i servermiljøet.");
    return;
  }
  const scopes = state.gameMode === "exposed" ? spotifyScopesExposed : spotifyScopesBase;
  await startSpotifyAuth(scopes, { roomCode: state.roomCode, playerId: state.playerId, role: "host" });
}

// SPOTIFY CONNECT (guest / exposed mode)
async function connectSpotifyGuest() {
  if (!state.config?.spotifyClientId) {
    alert("Mangler SPOTIFY_CLIENT_ID i servermiljøet.");
    return;
  }
  await startSpotifyAuth(spotifyScopesExposed, { roomCode: state.roomCode, playerId: state.playerId, role: "guest" });
}

async function startSpotifyAuth(scopes, stateData) {
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  sessionStorage.setItem("guessify-code-verifier", verifier);
  sessionStorage.setItem("guessify-auth-role", stateData.role || "host");
  const redirectUri = state.config.spotifyRedirectUri || `${location.origin}/`;
  const params = new URLSearchParams({
    client_id: state.config.spotifyClientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: scopes.join(" "),
    state: JSON.stringify(stateData),
  });
  location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleSpotifyCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const spotifyState = url.searchParams.get("state");
  if (!code) return;

  // If this is an admin auth callback, forward to /admin and stop
  try {
    const parsed = JSON.parse(spotifyState || "{}");
    if (parsed.admin) {
      const adminUrl = new URL("/admin", location.origin);
      adminUrl.searchParams.set("code", code);
      adminUrl.searchParams.set("state", spotifyState);
      location.href = adminUrl.toString();
      return;
    }
  } catch {}

  const verifier = sessionStorage.getItem("guessify-code-verifier");
  if (!verifier) return;
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
  if (!tokenResponse.ok || !tokenData.access_token) {
    const detail = tokenData.error_description || tokenData.error || "Kunne ikke hente Spotify-token.";
    console.error("Spotify token exchange failed:", detail);
    alert(`Spotify-innlogging feilet: ${detail}`);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    history.replaceState({}, document.title, url.pathname);
    return;
  }
  state.spotifyToken = tokenData.access_token;
  state.spotifyRefreshToken = tokenData.refresh_token || null;
  state.spotifyTokenExpiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 - 60000 : null;
  sessionStorage.setItem(spotifySessionKey, JSON.stringify({
    token: state.spotifyToken,
    refreshToken: state.spotifyRefreshToken,
    expiresAt: state.spotifyTokenExpiresAt,
  }));
  const role = sessionStorage.getItem("guessify-auth-role") || "host";
  sessionStorage.removeItem("guessify-auth-role");
  if (spotifyState) {
    const parsedState = JSON.parse(spotifyState);
    state.roomCode = parsedState.roomCode;
    state.playerId = parsedState.playerId;
    persistSession();
  }
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  history.replaceState({}, document.title, url.pathname);
  await refreshRoom();
  try {
    if (state.gameMode === "exposed") {
      if (isHost()) {
        await syncExposedHostLibrary();
      } else {
        await syncExposedGuestLibrary();
      }
    } else {
      // chill / host
      await syncHostLibrary();
      await syncRoomPlaylists();
    }
  } catch (error) {
    const msg = error.message || "Kunne ikke synkronisere med Spotify.";
    console.error("Post-auth sync failed:", error);
    if (state.gameMode === "exposed") {
      const statusEl = isHost() ? els.hostExposedStatus : els.guestExposedStatus;
      if (statusEl) statusEl.textContent = msg;
    } else {
      if (els.hostSyncStatus) els.hostSyncStatus.textContent = msg;
    }
  }
}

// CHILL: host syncs their own playlist
async function syncHostLibrary() {
  if (!state.spotifyToken || !isHost()) return;
  const [profile, playlists] = await Promise.all([
    fetchSpotify("https://api.spotify.com/v1/me"),
    fetchAllSpotifyPlaylists(),
  ]);
  state.spotifyProfile = profile;
  state.hostPlaylists = playlists.map((p) => ({ id: p.id, name: p.name, trackCount: p.tracks?.total || 0 }));
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
    if (els.hostSyncStatus) els.hostSyncStatus.textContent = "Velg en host-playlist for å bruke dine egne spor.";
    return;
  }
  const selectedPlaylist = state.hostPlaylists.find((p) => p.id === state.selectedHostPlaylistId);
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
  if (els.hostSyncStatus) els.hostSyncStatus.textContent = selectedPlaylist ? `Host-playlist: ${selectedPlaylist.name}.` : "Host-playlist oppdatert.";
}

// EXPOSED: host syncs their personal top tracks
async function syncExposedHostLibrary() {
  if (!state.spotifyToken) return;
  const category = state.selectedCategory || els.categorySelect?.value || "top10";
  const profile = await fetchSpotify("https://api.spotify.com/v1/me");
  state.spotifyProfile = profile;
  const tracks = await fetchExposedTracks(category);
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/exposed-spotify`, {
    method: "POST",
    body: JSON.stringify({
      spotify_id: profile.id,
      display_name: profile.display_name || profile.id,
      tracks,
      category,
    }),
  });
  // Also sync via host-spotify so playback works
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/host-spotify`, {
    method: "POST",
    body: JSON.stringify({
      spotify_id: profile.id,
      display_name: profile.display_name || profile.id,
      playlists: [],
      tracks,
    }),
  });
  if (els.hostExposedStatus) els.hostExposedStatus.textContent = `Koblet til som ${profile.display_name || profile.id} (${tracks.length} spor lastet inn).`;
}

// EXPOSED: guest syncs their personal top tracks
async function syncExposedGuestLibrary() {
  if (!state.spotifyToken) return;
  const category = state.room?.roundCategory || "top10";
  const profile = await fetchSpotify("https://api.spotify.com/v1/me");
  state.spotifyProfile = profile;
  state.exposedSynced = false;
  if (els.guestExposedStatus) els.guestExposedStatus.textContent = "Henter dine spor...";
  const tracks = await fetchExposedTracks(category);
  await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/exposed-spotify`, {
    method: "POST",
    body: JSON.stringify({
      spotify_id: profile.id,
      display_name: profile.display_name || profile.id,
      tracks,
      category,
    }),
  });
  state.exposedSynced = true;
  if (els.guestExposedStatus) els.guestExposedStatus.textContent = `Klar! ${profile.display_name || profile.id} — ${tracks.length} spor lastet inn.`;
}

// Fetch tracks based on Exposed category
async function fetchExposedTracks(category) {
  const currentYear = new Date().getFullYear();
  if (category === "top10") {
    return fetchTopTracks("long_term", 50);
  } else if (category === "nostalgia") {
    const tracks = await fetchTopTracks("long_term", 50);
    return tracks.filter((t) => {
      const year = parseInt(t.releaseYear || "9999", 10);
      return year <= currentYear - 5;
    });
  } else if (category === "guilty_pleasure") {
    return fetchTopTracks("medium_term", 50);
  } else if (category === "new_discovery") {
    return fetchTopTracks("short_term", 50);
  }
  return fetchTopTracks("long_term", 50);
}

async function fetchTopTracks(timeRange, limit = 50) {
  const data = await fetchSpotify(`https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`);
  const tracks = [];
  for (const item of data.items || []) {
    if (!item.id || !item.uri) continue;
    tracks.push({
      id: item.id,
      name: item.name,
      uri: item.uri,
      previewUrl: item.preview_url || null,
      artists: (item.artists || []).map((a) => a.name),
      albumImage: item.album?.images?.[0]?.url || null,
      releaseYear: item.album?.release_date?.substring(0, 4) || null,
      playlistName: null,
    });
  }
  return tracks;
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
  if (!isHost() || !state.spotifyToken || state.syncInFlight || !state.room) return;
  state.syncInFlight = true;
  try {
    if (els.hostSyncStatus) els.hostSyncStatus.textContent = "Synkroniserer spillelister...";
    await syncHostLibrary();
    for (const player of state.room.players) {
      if (player.isHost || !player.guestPlaylistId || player.guestPlaylistSynced) continue;
      try {
        const playlistMeta = await fetchSpotify(`https://api.spotify.com/v1/playlists/${player.guestPlaylistId}?fields=name`);
        const tracks = await fetchPlaylistTracks(player.guestPlaylistId, playlistMeta.name);
        if (!tracks.length) {
          if (els.hostSyncStatus) els.hostSyncStatus.textContent = `${player.name}: Ingen spor funnet i spillelisten.`;
          continue;
        }
        await fetchJson(`/api/rooms/${state.roomCode}/players/${state.playerId}/import/${player.playerId}`, {
          method: "POST",
          body: JSON.stringify({ playlist_id: player.guestPlaylistId, playlist_name: playlistMeta.name || "Spotify Playlist", tracks }),
        });
      } catch (playerError) {
        const msg = playerError.message || "Ukjent feil";
        if (els.hostSyncStatus) els.hostSyncStatus.textContent = `${player.name}: Kunne ikke hente spilleliste — ${msg}`;
        // Continue with remaining players instead of aborting entire sync
      }
    }
    if (els.hostSyncStatus) els.hostSyncStatus.textContent = "Spillelister oppdatert.";
  } catch (error) {
    const message = error.message || "Kunne ikke oppdatere spillelister.";
    if (message.toLowerCase().includes("token") || message.toLowerCase().includes("expired")) {
      if (els.hostSyncStatus) els.hostSyncStatus.textContent = "Spotify-innloggingen er utgått. Koble til Spotify på nytt.";
    } else {
      if (els.hostSyncStatus) els.hostSyncStatus.textContent = message;
    }
    throw error;
  } finally {
    state.syncInFlight = false;
  }
}

async function fetchPlaylistTracks(playlistId, fallbackName = null) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,uri,preview_url,artists(name),album(images))),next`;
  while (url) {
    const payload = await fetchSpotify(url);
    for (const item of payload.items || []) {
      if (!item.track?.id || !item.track?.uri) continue;
      tracks.push({
        id: item.track.id,
        name: item.track.name,
        uri: item.track.uri,
        previewUrl: item.track.preview_url,
        artists: (item.track.artists || []).map((a) => a.name),
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
  if (!round?.uri) return false;
  if (!state.spotifyToken || !isHost()) {
    if (els.playbackStatus) els.playbackStatus.textContent = "Bare host med Spotify Premium kan spille av full låt.";
    return false;
  }
  try {
    await ensureSpotifyWebPlayer();
    if (typeof state.spotifyPlayer.activateElement === "function") {
      await state.spotifyPlayer.activateElement();
    }
    await spotifyApiFetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [state.spotifyDeviceId], play: false }),
    });
    await spotifyApiFetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.spotifyDeviceId}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [round.uri] }),
    });
    if (els.playbackStatus) els.playbackStatus.textContent = "Spiller av via Spotify Premium.";
    return true;
  } catch (error) {
    if (els.playbackStatus) els.playbackStatus.textContent = error.message || "Spotify-avspilling feilet.";
    return false;
  }
}

async function onPlayPreview() {
  const round = state.room?.currentRound;
  if (!round?.previewUrl) { alert("Denne sangen har ingen preview-url."); return; }
  state.previewAudio?.pause();
  state.previewAudio = new Audio(round.previewUrl);
  await state.previewAudio.play();
  if (els.playbackStatus) els.playbackStatus.textContent = "Spiller 30-sekunders preview.";
}

function handleRoundStateChange(previousRoundToken, nextRoundToken) {
  if (!nextRoundToken || previousRoundToken === nextRoundToken) return;
  state.previewAudio?.pause();
  state.previewAudio = null;
  state.activeRoundToken = nextRoundToken;
  const round = state.room?.currentRound;
  if (round?.phase === "guessing") announceRound(round);
  if (!round || round.revealed) return;
  playRoundAudioForCurrentUser().catch(() => {
    if (els.playbackStatus) els.playbackStatus.textContent = "Ny runde er startet. Trykk Spill preview hvis lyden ikke startet automatisk.";
  });
}

async function playRoundAudioForCurrentUser() {
  if (isHost() && state.spotifyToken) {
    const started = await onPlayTrack();
    if (started) return;
  }
  await playRoundPreviewForEveryone();
}

async function playRoundPreviewForEveryone() {
  const round = state.room?.currentRound;
  if (!round?.previewUrl) return;
  state.previewAudio?.pause();
  state.previewAudio = new Audio(round.previewUrl);
  await state.previewAudio.play();
  if (els.playbackStatus) els.playbackStatus.textContent = "Ny runde startet. Spiller preview for alle.";
}

function announceRound(round) {
  if (!round) return;
  state.roundAnnouncement = `Runde ${round.index + 1} av ${round.total} starter nå`;
  clearTimeout(state.roundAnnouncementTimer);
  state.roundAnnouncementTimer = window.setTimeout(() => { state.roundAnnouncement = ""; render(); }, 3500);
}

async function initSpotifyPlayer() {
  if (!window.Spotify) {
    await loadScript("https://sdk.scdn.co/spotify-player.js");
    await new Promise((resolve) => {
      if (window.Spotify) { resolve(); return; }
      window.onSpotifyWebPlaybackSDKReady = resolve;
    });
  }
  state.spotifyPlayer = new Spotify.Player({
    name: "Guessify Host Player",
    getOAuthToken: (callback) => callback(state.spotifyToken),
    volume: 0.8,
  });
  await new Promise((resolve, reject) => {
    state.spotifyPlayer.addListener("ready", ({ device_id }) => { state.spotifyDeviceId = device_id; resolve(); });
    state.spotifyPlayer.addListener("initialization_error", ({ message }) => reject(new Error(message)));
    state.spotifyPlayer.addListener("authentication_error", ({ message }) => reject(new Error(message)));
    state.spotifyPlayer.addListener("account_error", ({ message }) => reject(new Error(message)));
    state.spotifyPlayer.addListener("playback_error", ({ message }) => { if (els.playbackStatus) els.playbackStatus.textContent = message; });
    state.spotifyPlayer.connect().then((connected) => {
      if (!connected) reject(new Error("Spotify SDK fikk ikke koblet til spilleren."));
    });
  });
}

async function ensureSpotifyWebPlayer() {
  if (state.spotifyPlayerReady) { await state.spotifyPlayerReady; return; }
  state.spotifyPlayerReady = initSpotifyPlayer();
  try {
    await state.spotifyPlayerReady;
  } catch (error) {
    state.spotifyPlayerReady = null;
    throw error;
  }
}

// ============ RENDER ============

function render() {
  const room = state.room;
  const inRoom = Boolean(room);

  // Panel visibility
  els.modePanel.classList.toggle("hidden", inRoom || Boolean(els.setupPanel && !els.setupPanel.classList.contains("hidden")));
  els.setupPanel?.classList.toggle("hidden", inRoom || Boolean(els.modePanel && !els.modePanel.classList.contains("hidden")));
  els.roomPanel.classList.toggle("hidden", !inRoom);
  // Game overlay: auto-show when a new round starts, allow manual minimize
  const currentToken = getRoundToken(room);
  if (room?.currentRound) {
    // New round → reset minimize and show overlay
    if (currentToken !== state.lastShownRoundToken) {
      state.gameMinimized = false;
      state.lastShownRoundToken = currentToken;
    }
    els.gamePanel.classList.toggle("hidden", state.gameMinimized);
  } else {
    els.gamePanel.classList.add("hidden");
    state.lastShownRoundToken = null;
  }

  if (!inRoom) {
    // Show correct panel (mode or setup)
    const savedMode = localStorage.getItem("guessify-mode");
    if (savedMode) {
      state.gameMode = savedMode;
      els.modePanel.classList.add("hidden");
      els.setupPanel?.classList.remove("hidden");
      updateModeBadge();
    } else {
      els.modePanel.classList.remove("hidden");
      els.setupPanel?.classList.add("hidden");
    }
    return;
  }

  const gameMode = room.gameMode || state.gameMode || "chill";
  state.gameMode = gameMode;

  // Room header
  els.roomCodeDisplay.textContent = room.code;
  els.playerCount.textContent = `${room.players.length} / 8`;

  // Status strip
  els.spotifyStatus.textContent = state.spotifyToken
    ? `Koblet til som ${state.spotifyProfile?.display_name || "Spotify-bruker"}`
    : "Ikke koblet til Spotify";

  const hostCache = localStorage.getItem(`guessify-host-cache:${room.code}`);
  els.hostCacheStatus.textContent = hostCache ? "Cache oppdatert" : "Cache tom";

  els.roomHint.textContent = isHost()
    ? (gameMode === "exposed" ? "Alle spillere må koble til Spotify Premium." : "Gjestene limer inn offentlig playlist-lenke.")
    : (gameMode === "exposed" ? "Koble til Spotify Premium for å hente dine personlige spor." : "Lim inn en offentlig Spotify-playlist.");

  if (els.gameModeBadge) {
    els.gameModeBadge.classList.remove("hidden", "chill", "exposed");
    els.gameModeBadge.classList.add(gameMode);
    els.gameModeBadge.textContent = gameMode === "exposed" ? "🔥 Exposed" : "🎵 Chill";
  }

  // Spotify button: host always, guests in exposed mode
  const showSpotifyBtn = isHost() || gameMode === "exposed";
  els.connectSpotifyBtn.classList.toggle("hidden", !showSpotifyBtn || !isHost());

  els.endRoomBtn.classList.toggle("hidden", !isHost());
  els.leaveRoomBtn.classList.toggle("hidden", isHost() || !room.winnerId);

  // Host controls
  els.hostControlsCard.classList.toggle("hidden", !isHost() || gameMode === "exposed");
  els.hostExposedCard?.classList.toggle("hidden", !isHost() || gameMode !== "exposed");

  // Guest cards
  els.guestPlaylistCard.classList.toggle("hidden", isHost() || gameMode === "exposed");
  els.guestExposedCard?.classList.toggle("hidden", isHost() || gameMode !== "exposed");

  renderPlayers(room);
  renderGuestCard(room);
  renderGuestExposedCard(room);
  renderGame(room);
}

function renderPlayers(room) {
  els.playersList.innerHTML = "";
  const gameMode = room.gameMode || "chill";
  for (const player of room.players) {
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "player-ready-dot" + (player.ready ? " ready" : "");
    const info = document.createElement("div");
    info.innerHTML = `<strong>${escapeHtml(player.name)}</strong><div class="muted" style="font-size:0.85rem">${escapeHtml(playerStatus(player, gameMode))}</div>`;
    const score = document.createElement("span");
    score.className = "pill";
    score.textContent = `${player.score} poeng`;
    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(score);
    els.playersList.appendChild(item);
  }

  const canStart = isHost() && room.players.length >= 2 && room.players.every((p) => p.ready) && !room.started;
  if (els.guessDuration) {
    els.guessDuration.value = String(room.guessDurationSeconds || 15);
    els.guessDuration.disabled = !isHost() || room.started;
  }
  if (els.exposedGuessDuration) {
    els.exposedGuessDuration.value = String(room.guessDurationSeconds || 15);
    els.exposedGuessDuration.disabled = !isHost() || room.started;
  }
  if (els.startGameBtn) els.startGameBtn.disabled = !canStart;
  if (els.exposedStartGameBtn) els.exposedStartGameBtn.disabled = !canStart;

  const canResetGame = isHost() && Boolean(room.started || room.currentRound || room.winnerId);
  els.resetGameBtn.classList.toggle("hidden", !canResetGame);
  if (els.syncPlaylistsBtn) els.syncPlaylistsBtn.disabled = !isHost() || !state.spotifyToken;
  if (els.categorySelect && room.roundCategory) els.categorySelect.value = room.roundCategory;
  renderHostPlaylistSelect();

  // Update Exposed host status
  if (isHost() && room.gameMode === "exposed" && els.hostExposedStatus) {
    const me = room.players.find((p) => p.playerId === state.playerId);
    if (me?.spotifyConnected && me?.trackCount > 0) {
      els.hostExposedStatus.textContent = `Koblet til som ${me.spotifyDisplayName || "Spotify"} (${me.trackCount} spor).`;
    } else if (state.spotifyToken) {
      els.hostExposedStatus.textContent = "Koble til Spotify for å hente dine spor.";
    } else {
      els.hostExposedStatus.textContent = "Koble til Spotify Premium for å starte.";
    }
    if (room.roundCategory && els.categorySelect) els.categorySelect.value = room.roundCategory;
  }
}

function renderGuestCard(room) {
  if (isHost() || room.gameMode === "exposed") return;
  const me = room.players.find((p) => p.playerId === state.playerId);
  if (els.guestPlaylistUrl) els.guestPlaylistUrl.value = me?.guestPlaylistUrl || "";
  if (!els.guestPlaylistStatus) return;
  if (!me?.guestPlaylistId) { els.guestPlaylistStatus.textContent = "Ingen playlist lagret ennå."; return; }
  if (me.guestPlaylistSynced) { els.guestPlaylistStatus.textContent = `Klar: ${me.guestPlaylistName || "Playlist importert"} (${me.trackCount} spor).`; return; }
  els.guestPlaylistStatus.textContent = "Playlist lagret. Venter på at host importerer sporene.";
}

function renderGuestExposedCard(room) {
  if (isHost() || room.gameMode !== "exposed") return;
  const me = room.players.find((p) => p.playerId === state.playerId);
  if (!els.guestExposedStatus) return;

  if (room.roundCategory && els.guestExposedDesc) {
    els.guestExposedDesc.textContent = `Kategori: ${categoryLabel(room.roundCategory)}. Koble til Spotify Premium for å hente dine personlige spor.`;
  }

  if (me?.spotifyConnected && me?.trackCount > 0) {
    els.guestExposedStatus.textContent = `Klar! ${me.spotifyDisplayName || me.name} — ${me.trackCount} spor lastet inn.`;
    if (els.guestConnectSpotifyBtn) els.guestConnectSpotifyBtn.textContent = "Oppdater Spotify-data";
  } else if (state.spotifyToken && !me?.spotifyConnected) {
    els.guestExposedStatus.textContent = "Henter spor...";
  } else if (!state.spotifyToken) {
    els.guestExposedStatus.textContent = "Ikke koblet til.";
    if (els.guestConnectSpotifyBtn) els.guestConnectSpotifyBtn.textContent = "Koble til Spotify Premium";
  }
}

function renderGame(room) {
  const round = room.currentRound;
  const gameMode = room.gameMode || "chill";

  // Show correct next-round button
  els.nextRoundBtn.classList.toggle("hidden", !isHost() || !round || gameMode === "exposed");
  els.exposedNextRoundBtn?.classList.toggle("hidden", !isHost() || !round || gameMode !== "exposed");
  els.resetGameBtn.classList.toggle("hidden", !isHost() || !Boolean(room.started || room.currentRound || room.winnerId));
  els.pauseGameBtn.classList.toggle("hidden", !isHost() || !round || !room.started);

  if (!round) {
    if (els.roundAnnouncement) { els.roundAnnouncement.textContent = ""; els.roundAnnouncement.classList.add("hidden"); }
    if (els.phaseTimer) els.phaseTimer.textContent = "";
    return;
  }
  if (els.roundAnnouncement) {
    els.roundAnnouncement.textContent = state.roundAnnouncement;
    els.roundAnnouncement.classList.toggle("hidden", !state.roundAnnouncement);
  }
  els.pauseGameBtn.textContent = round.paused ? "Fortsett" : "Pause";

  const nextBtnEl = gameMode === "exposed" ? els.exposedNextRoundBtn : els.nextRoundBtn;
  if (nextBtnEl) nextBtnEl.textContent = round.phase === "guessing" ? "Avslør nå" : "Neste nå";

  els.roundProgress.textContent = `${round.index + 1} / ${round.total}`;
  els.albumCover.src = round.albumImage ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' fill='%230a0a14'/%3E%3Ccircle cx='256' cy='256' r='110' fill='%23b44aff' opacity='0.1'/%3E%3Ccircle cx='256' cy='256' r='50' fill='%2300e5ff' opacity='0.08'/%3E%3C/svg%3E";

  els.playbackStatus.textContent = round.revealed
    ? "Runden er avslørt. Se hvem som eide sangen."
    : `Venter på gjetninger: ${round.guessCount} / ${round.expectedGuessers}`;
  if (round.phase === "guessing" && round.paused) els.playbackStatus.textContent = "Runden er pauset.";

  if (!room.started && room.winnerId) {
    const winner = room.players.find((p) => p.playerId === room.winnerId);
    els.playbackStatus.textContent = winner ? `Spillet er ferdig! Vinner: ${winner.name} 🎉` : "Spillet er ferdig.";
  }

  els.revealBox.classList.toggle("hidden", !round.revealed);
  if (round.revealed) {
    const categoryHtml = round.category
      ? `<br/><span class="reveal-category">${categoryLabel(round.category)}</span>`
      : "";
    els.revealBox.innerHTML = `
      <strong>${escapeHtml(round.trackName || "")}</strong><br />
      ${escapeHtml((round.artists || []).join(", "))}<br />
      Tilhører: <strong>${escapeHtml(round.ownerName || "")}</strong>${categoryHtml}
    `;
  }
  updatePhaseTimer();
  renderGuessOptions(room);
  renderScoreboard(room);

  // Show winner popup when game ends
  if (!room.started && room.winnerId && !state.winnerPopupShown) {
    state.winnerPopupShown = true;
    showWinnerPopup(room);
  }
  if (room.started) {
    state.winnerPopupShown = false;
  }
}

function renderGuessOptions(room) {
  const round = room.currentRound;
  if (!round) return;
  const currentGuess = room.guesses?.[state.playerId] || null;
  const hasSubmittedGuess = Boolean(currentGuess);
  els.guessOptions.innerHTML = "";
  for (const player of room.players) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "guess-option";
    if (currentGuess === player.playerId) button.classList.add("selected");
    button.innerHTML = `<span>${escapeHtml(player.name)}</span><span class="pill">${player.score} poeng</span>`;
    button.addEventListener("click", async () => {
      if (round.phase !== "guessing" || round.paused || hasSubmittedGuess) return;
      try { await submitGuess(player.playerId); }
      catch (error) { alert(error.message || "Kunne ikke sende inn gjetningen."); }
    });
    button.disabled = round.phase !== "guessing" || round.paused || hasSubmittedGuess || state.submittingGuess;
    els.guessOptions.appendChild(button);
  }
}

function renderScoreboard(room) {
  if (!els.scoreboardList) return;
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score || 0;
  els.scoreboardList.innerHTML = "";
  sorted.forEach((player, i) => {
    const entry = document.createElement("div");
    entry.className = "scoreboard-entry" + (i === 0 && topScore > 0 ? " leading" : "");
    entry.innerHTML = `
      <span class="scoreboard-rank">${i + 1}</span>
      <span class="scoreboard-name">${escapeHtml(player.name)}</span>
      <span class="scoreboard-score">${player.score}p</span>
    `;
    els.scoreboardList.appendChild(entry);
  });
}

function showWinnerPopup(room) {
  if (!els.winnerPopup) return;
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score || 0;
  const winners = sorted.filter(p => p.score === topScore);
  const isTie = winners.length > 1;

  if (isTie) {
    els.winnerTitle.textContent = "Uavgjort!";
    els.winnerName.textContent = winners.map(w => w.name).join(" & ");
  } else {
    els.winnerTitle.textContent = "Vinner!";
    els.winnerName.textContent = sorted[0]?.name || "";
  }
  els.winnerScore.textContent = `${topScore} poeng`;

  // Build podium
  els.winnerPodium.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉"];
  sorted.forEach((player, i) => {
    const entry = document.createElement("div");
    entry.className = "podium-entry";
    entry.innerHTML = `
      <span class="podium-rank">${medals[i] || (i + 1)}</span>
      <span class="podium-name">${escapeHtml(player.name)}</span>
      <span class="podium-score">${player.score}p</span>
    `;
    els.winnerPodium.appendChild(entry);
  });

  // Spawn confetti
  spawnConfetti();

  els.winnerPopup.classList.remove("hidden");
  els.winnerNewGameBtn.classList.toggle("hidden", !isHost());
}

function closeWinnerPopup() {
  els.winnerPopup?.classList.add("hidden");
  if (els.winnerConfetti) els.winnerConfetti.innerHTML = "";
}

function spawnConfetti() {
  if (!els.winnerConfetti) return;
  els.winnerConfetti.innerHTML = "";
  const colors = ["#ff2d78", "#00e5ff", "#b44aff", "#39ff14", "#ffd700", "#ff6b35"];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 2) + "s";
    piece.style.animationDelay = Math.random() * 1.5 + "s";
    piece.style.width = (5 + Math.random() * 8) + "px";
    piece.style.height = (5 + Math.random() * 8) + "px";
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    els.winnerConfetti.appendChild(piece);
  }
}

function playerStatus(player, gameMode = "chill") {
  if (player.isHost) {
    if (gameMode === "exposed") {
      if (player.spotifyConnected && player.trackCount > 0) return `Host klar med ${player.trackCount} spor`;
      return "Host må koble til Spotify";
    }
    if (player.spotifyConnected && player.trackCount > 0) return `Host klar med ${player.trackCount} spor`;
    return "Host må koble til Spotify";
  }
  if (gameMode === "exposed") {
    if (player.spotifyConnected && player.trackCount > 0) return `Klar med ${player.trackCount} spor`;
    return "Venter på Spotify-kobling";
  }
  if (player.guestPlaylistSynced && player.trackCount > 0) return `${player.guestPlaylistName || "Playlist"} importert`;
  if (player.guestPlaylistId) return "Playlist lagret, venter på host";
  return "Venter på offentlig playlist";
}

function categoryLabel(category) {
  const labels = {
    top10: "🏆 Top 10",
    nostalgia: "📼 Nostalgia",
    guilty_pleasure: "🙈 Guilty Pleasure",
    new_discovery: "✨ Nytt bekjentskap",
  };
  return labels[category] || category;
}

function renderHostPlaylistSelect() {
  if (!els.hostPlaylistSelect) return;
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
  const host = room.players.find((p) => p.playerId === state.playerId);
  if (!host?.trackCount) return true;
  return room.players.some((p) => !p.isHost && p.guestPlaylistId && !p.guestPlaylistSynced);
}

function getRoundToken(room) {
  const round = room?.currentRound;
  if (!round) return null;
  return `${round.index}:${round.uri}:${round.revealed}`;
}

function isHost() {
  return state.room?.hostId === state.playerId;
}

function persistSession() {
  localStorage.setItem(storageKey, JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId, gameMode: state.gameMode }));
}

function clearRoomState() {
  state.suppressReconnect = true;
  if (state.roomCode) localStorage.removeItem(`guessify-host-cache:${state.roomCode}`);
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
  state.exposedSynced = false;
  localStorage.removeItem(storageKey);
}

function restoreSession() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.roomCode = saved.roomCode;
    state.playerId = saved.playerId;
    if (saved.gameMode) state.gameMode = saved.gameMode;
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function restoreSpotifySession() {
  const raw = sessionStorage.getItem(spotifySessionKey);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.spotifyToken = saved.token || null;
    state.spotifyRefreshToken = saved.refreshToken || null;
    state.spotifyTokenExpiresAt = saved.expiresAt || null;
  } catch {
    sessionStorage.removeItem(spotifySessionKey);
  }
}

function extractPlaylistId(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "playlist" && parts[1]) return parts[1];
  } catch {}
  const match = value.match(/playlist[:/](?<id>[A-Za-z0-9]+)/);
  return match?.groups?.id || null;
}

function dedupeTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Ukjent feil" }));
    throw new Error(error.detail || "Kallet feilet");
  }
  return response.json();
}

async function refreshSpotifyToken() {
  if (!state.spotifyRefreshToken || !state.config?.spotifyClientId) return false;
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: state.config.spotifyClientId,
        grant_type: "refresh_token",
        refresh_token: state.spotifyRefreshToken,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) return false;
    state.spotifyToken = data.access_token;
    if (data.refresh_token) state.spotifyRefreshToken = data.refresh_token;
    state.spotifyTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
    sessionStorage.setItem(spotifySessionKey, JSON.stringify({
      token: state.spotifyToken,
      refreshToken: state.spotifyRefreshToken,
      expiresAt: state.spotifyTokenExpiresAt,
    }));
    return true;
  } catch {
    return false;
  }
}

async function ensureValidToken() {
  if (state.spotifyTokenExpiresAt && Date.now() >= state.spotifyTokenExpiresAt) {
    await refreshSpotifyToken();
  }
}

async function fetchSpotify(url) {
  await ensureValidToken();
  let response = await fetch(url, { headers: { Authorization: `Bearer ${state.spotifyToken}` } });
  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    response = await fetch(url, { headers: { Authorization: `Bearer ${state.spotifyToken}` } });
  }
  // Handle expired token (try refresh once)
  if (response.status === 401 && state.spotifyRefreshToken) {
    const refreshed = await refreshSpotifyToken();
    if (refreshed) {
      response = await fetch(url, { headers: { Authorization: `Bearer ${state.spotifyToken}` } });
    }
  }
  if (!response.ok) {
    let detail = "Spotify-kall feilet.";
    try { const data = await response.json(); detail = data.error?.message || detail; } catch {}
    throw new Error(detail);
  }
  return response.json();
}

async function spotifyApiFetch(url, options = {}) {
  await ensureValidToken();
  let response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${state.spotifyToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${state.spotifyToken}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  }
  if (response.status === 401 && state.spotifyRefreshToken) {
    const refreshed = await refreshSpotifyToken();
    if (refreshed) {
      response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${state.spotifyToken}`, "Content-Type": "application/json", ...(options.headers || {}) } });
    }
  }
  if (!response.ok) {
    let detail = "Spotify-kall feilet.";
    try { const data = await response.json(); detail = data.error?.message || detail; } catch {}
    throw new Error(detail);
  }
  return response;
}

async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length))).map((v) => chars[v % chars.length]).join("");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

boot().catch((error) => {
  console.error(error);
  alert(error.message || "Noe gikk galt.");
});
