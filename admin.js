const storageKey = "guessify-admin-spotify";
const CURRENT_YEAR = new Date().getFullYear();

const CATEGORIES = {
  top10: {
    label: "🏆 Top 10",
    desc: "Sangene du har hørt absolutt mest — all time. Hentes fra Spotify long_term top tracks.",
    timeRange: "long_term",
    filter: null,
  },
  nostalgia: {
    label: "📼 Nostalgia",
    desc: `Gamle favoritter fra minst 20 år tilbake (utgitt i ${CURRENT_YEAR - 20} eller tidligere). Hentes fra dine lagrede sanger (liked songs) og filtrert på utgivelsesår — gir mye bedre dekning enn top tracks.`,
    source: "saved",
    filter: (t) => t.releaseYear && parseInt(t.releaseYear, 10) <= CURRENT_YEAR - 20,
  },
  guilty_pleasure: {
    label: "🙈 Guilty Pleasure",
    desc: "Sanger du har hørt mye de siste 6 månedene — men kanskje ikke skryter av. Hentes fra Spotify medium_term top tracks.",
    timeRange: "medium_term",
    filter: null,
  },
  new_discovery: {
    label: "✨ Nytt bekjentskap",
    desc: "Nylig oppdagede sanger du har hørt de siste 4 ukene. Hentes fra Spotify short_term top tracks.",
    timeRange: "short_term",
    filter: null,
  },
};

const state = {
  token: null,
  profile: null,
  selectedCategory: "top10",
};

const els = {
  connectBtn: document.querySelector("#connect-btn"),
  connectSection: document.querySelector("#connect-section"),
  connectedBanner: document.querySelector("#connected-banner"),
  profileName: document.querySelector("#profile-name"),
  disconnectBtn: document.querySelector("#disconnect-btn"),
  testSection: document.querySelector("#test-section"),
  fetchBtn: document.querySelector("#fetch-btn"),
  statusBar: document.querySelector("#status-bar"),
  resultsHeader: document.querySelector("#results-header"),
  countBadge: document.querySelector("#count-badge"),
  trackGrid: document.querySelector("#track-grid"),
  categoryDesc: document.querySelector("#category-desc"),
  tabBtns: document.querySelectorAll(".tab-btn"),
};

async function boot() {
  const config = await fetch("/api/config").then((r) => r.json());
  state.config = config;

  restoreSession();
  await handleCallback();

  if (state.token) {
    await loadProfile();
  }

  bindEvents();
  render();
}

function bindEvents() {
  els.connectBtn?.addEventListener("click", onConnect);
  els.disconnectBtn?.addEventListener("click", onDisconnect);
  els.fetchBtn?.addEventListener("click", onFetch);
  els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedCategory = btn.dataset.category;
      els.tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      updateCategoryDesc();
      els.trackGrid.innerHTML = "";
      els.resultsHeader.classList.add("hidden");
      els.statusBar.textContent = "";
    });
  });
  updateCategoryDesc();
}

function updateCategoryDesc() {
  const cat = CATEGORIES[state.selectedCategory];
  if (els.categoryDesc) els.categoryDesc.textContent = cat?.desc || "";
}

async function onConnect() {
  if (!state.config?.spotifyClientId) {
    alert("Mangler SPOTIFY_CLIENT_ID i servermiljøet.");
    return;
  }
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  sessionStorage.setItem("admin-verifier", verifier);
  const redirectUri = state.config.spotifyRedirectUri || `${location.origin}/`;

  // We use /admin as redirect — but Spotify only allows configured URIs.
  // So we redirect back to root and detect admin mode via sessionStorage.
  sessionStorage.setItem("admin-auth", "1");

  const params = new URLSearchParams({
    client_id: state.config.spotifyClientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: "user-top-read user-read-recently-played user-read-private user-read-email user-library-read",
    state: JSON.stringify({ admin: true }),
  });
  location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  if (!code) return;

  let parsedState = {};
  try { parsedState = JSON.parse(rawState || "{}"); } catch {}
  if (!parsedState.admin) return;

  const verifier = sessionStorage.getItem("admin-verifier");
  if (!verifier) return;

  sessionStorage.removeItem("admin-verifier");
  sessionStorage.removeItem("admin-auth");

  const redirectUri = state.config.spotifyRedirectUri || `${location.origin}/`;
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
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
  const tokenData = await tokenRes.json();
  state.token = tokenData.access_token;
  sessionStorage.setItem(storageKey, JSON.stringify({ token: state.token }));

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  history.replaceState({}, document.title, "/admin");
}

async function loadProfile() {
  try {
    const profile = await spotifyGet("https://api.spotify.com/v1/me");
    state.profile = profile;
  } catch {
    state.token = null;
    sessionStorage.removeItem(storageKey);
  }
}

function onDisconnect() {
  state.token = null;
  state.profile = null;
  sessionStorage.removeItem(storageKey);
  els.trackGrid.innerHTML = "";
  els.resultsHeader.classList.add("hidden");
  els.statusBar.textContent = "";
  render();
}

async function onFetch() {
  if (!state.token) { alert("Koble til Spotify først."); return; }
  const cat = CATEGORIES[state.selectedCategory];
  els.statusBar.textContent = `Henter ${cat.label}...`;
  els.fetchBtn.disabled = true;
  els.trackGrid.innerHTML = "";
  els.resultsHeader.classList.add("hidden");

  try {
    let tracks;
    if (cat.source === "saved") {
      els.statusBar.textContent = `Henter lagrede sanger (kan ta litt tid)...`;
      tracks = await fetchSavedTracks(500);
    } else {
      tracks = await fetchTopTracks(cat.timeRange);
    }
    const filtered = cat.filter ? tracks.filter(cat.filter) : tracks;
    els.statusBar.textContent = cat.filter && filtered.length < tracks.length
      ? `Hentet ${tracks.length} spor totalt — ${filtered.length} etter filtrering.`
      : `Hentet ${filtered.length} spor.`;
    renderTracks(filtered);
  } catch (err) {
    els.statusBar.textContent = `Feil: ${err.message}`;
  } finally {
    els.fetchBtn.disabled = false;
  }
}

async function fetchTopTracks(timeRange, maxTotal = 200) {
  const pageSize = 50;
  const allItems = [];
  for (let offset = 0; offset < maxTotal; offset += pageSize) {
    const data = await spotifyGet(
      `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${pageSize}&offset=${offset}`
    );
    const items = data.items || [];
    allItems.push(...items);
    if (items.length < pageSize) break; // ingen flere sider
  }
  return allItems.map((item) => ({
    id: item.id,
    name: item.name,
    artists: (item.artists || []).map((a) => a.name).join(", "),
    albumImage: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || null,
    releaseYear: item.album?.release_date?.substring(0, 4) || null,
    uri: item.uri,
    previewUrl: item.preview_url || null,
  }));
}

async function fetchSavedTracks(maxTotal = 500) {
  const pageSize = 50;
  const allItems = [];
  for (let offset = 0; offset < maxTotal; offset += pageSize) {
    els.statusBar.textContent = `Henter lagrede sanger… (${allItems.length} hentet så langt)`;
    const data = await spotifyGet(
      `https://api.spotify.com/v1/me/tracks?limit=${pageSize}&offset=${offset}&market=from_token`
    );
    const items = data.items || [];
    allItems.push(...items);
    if (items.length < pageSize) break;
  }
  return allItems
    .filter((item) => item.track?.id && item.track?.uri)
    .map((item) => ({
      id: item.track.id,
      name: item.track.name,
      artists: (item.track.artists || []).map((a) => a.name).join(", "),
      albumImage: item.track.album?.images?.[1]?.url || item.track.album?.images?.[0]?.url || null,
      releaseYear: item.track.album?.release_date?.substring(0, 4) || null,
      uri: item.track.uri,
      previewUrl: item.track.preview_url || null,
    }));
}

function renderTracks(tracks) {
  els.countBadge.textContent = `${tracks.length} spor`;
  els.resultsHeader.classList.remove("hidden");
  els.trackGrid.innerHTML = "";

  if (!tracks.length) {
    els.trackGrid.innerHTML = `<p class="muted" style="font-family:sans-serif;grid-column:1/-1">Ingen spor funnet for denne kategorien.</p>`;
    return;
  }

  for (const track of tracks) {
    const card = document.createElement("div");
    card.className = "track-card";
    const imgHtml = track.albumImage
      ? `<img class="track-thumb" src="${escHtml(track.albumImage)}" alt="" loading="lazy" />`
      : `<div class="track-thumb-placeholder">🎵</div>`;
    card.innerHTML = `
      ${imgHtml}
      <div class="track-info">
        <p class="track-name" title="${escHtml(track.name)}">${escHtml(track.name)}</p>
        <p class="track-artist" title="${escHtml(track.artists)}">${escHtml(track.artists)}</p>
        ${track.releaseYear ? `<p class="track-year">${escHtml(track.releaseYear)}</p>` : ""}
      </div>
    `;
    // Click to play preview
    if (track.previewUrl) {
      card.style.cursor = "pointer";
      card.title = "Klikk for å spille preview";
      card.addEventListener("click", () => playPreview(track.previewUrl, card));
    }
    els.trackGrid.appendChild(card);
  }
}

let activeAudio = null;
let activeCard = null;

function playPreview(url, card) {
  if (activeAudio) {
    activeAudio.pause();
    activeCard?.style.removeProperty("outline");
    if (activeCard === card) { activeAudio = null; activeCard = null; return; }
  }
  activeAudio = new Audio(url);
  activeAudio.play();
  activeCard = card;
  card.style.outline = "2px solid var(--exposed-accent)";
  activeAudio.addEventListener("ended", () => {
    card.style.removeProperty("outline");
    activeAudio = null;
    activeCard = null;
  });
}

function render() {
  const connected = Boolean(state.token && state.profile);
  els.connectSection.classList.toggle("hidden", connected);
  els.connectedBanner.classList.toggle("hidden", !connected);
  els.testSection.classList.toggle("hidden", !connected);
  if (connected && els.profileName) {
    els.profileName.textContent = state.profile?.display_name || state.profile?.id || "Spotify-bruker";
  }
}

function restoreSession() {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.token = saved.token || null;
  } catch {
    sessionStorage.removeItem(storageKey);
  }
}

async function spotifyGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) {
    let msg = "Spotify-kall feilet.";
    try { const d = await res.json(); msg = d.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((v) => chars[v % chars.length]).join("");
}

function escHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

boot().catch((err) => { console.error(err); alert(err.message || "Noe gikk galt."); });
