from __future__ import annotations

import asyncio
import json
import os
import random
import string
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
MAX_PLAYERS = 6
ROOM_CODE_LENGTH = 5


def load_env_file() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env_file()


class CreateRoomPayload(BaseModel):
    host_name: str = Field(min_length=2, max_length=32)


class JoinRoomPayload(BaseModel):
    name: str = Field(min_length=2, max_length=32)


class HostSpotifyPayload(BaseModel):
    spotify_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=64)
    playlists: list[dict[str, Any]] = Field(default_factory=list)
    tracks: list[dict[str, Any]] = Field(default_factory=list)


class PlaylistLinkPayload(BaseModel):
    playlist_id: str = Field(min_length=1, max_length=64)
    playlist_url: str = Field(min_length=1, max_length=256)


class PlaylistImportPayload(BaseModel):
    playlist_id: str = Field(min_length=1, max_length=64)
    playlist_name: str = Field(min_length=1, max_length=128)
    tracks: list[dict[str, Any]] = Field(default_factory=list)


class StartGamePayload(BaseModel):
    rounds: int = Field(default=5, ge=1, le=20)


class GuessPayload(BaseModel):
    guess_player_id: str = Field(min_length=1)


class RoomSettingsPayload(BaseModel):
    guess_duration_seconds: int = Field(ge=5, le=60)


@dataclass
class Player:
    player_id: str
    name: str
    is_host: bool = False
    spotify_id: Optional[str] = None
    spotify_name: Optional[str] = None
    playlists: list[dict[str, Any]] = field(default_factory=list)
    tracks: list[dict[str, Any]] = field(default_factory=list)
    guest_playlist_id: Optional[str] = None
    guest_playlist_url: Optional[str] = None
    guest_playlist_name: Optional[str] = None
    guest_playlist_synced: bool = False
    score: int = 0
    connected: bool = False

    def ready(self) -> bool:
        if self.is_host:
            return bool(self.spotify_id and self.tracks)
        return bool(self.guest_playlist_id and self.guest_playlist_synced and self.tracks)

    def public_state(self) -> dict[str, Any]:
        return {
            "playerId": self.player_id,
            "name": self.name,
            "isHost": self.is_host,
            "spotifyConnected": bool(self.spotify_id),
            "spotifyDisplayName": self.spotify_name,
            "playlistCount": len(self.playlists),
            "trackCount": len(self.tracks),
            "guestPlaylistId": self.guest_playlist_id,
            "guestPlaylistUrl": self.guest_playlist_url,
            "guestPlaylistName": self.guest_playlist_name,
            "guestPlaylistSynced": self.guest_playlist_synced,
            "ready": self.ready(),
            "score": self.score,
            "connected": self.connected,
        }


@dataclass
class Room:
    code: str
    host_id: str
    players: dict[str, Player] = field(default_factory=dict)
    guess_duration_seconds: int = 15
    reveal_duration_seconds: int = 11
    started: bool = False
    rounds: list[dict[str, Any]] = field(default_factory=list)
    current_round_index: int = -1
    current_guesses: dict[str, str] = field(default_factory=dict)
    reveal_round: bool = False
    winner_id: Optional[str] = None
    round_phase: str = "lobby"
    phase_ends_at: Optional[float] = None
    phase_started_at: Optional[float] = None
    paused: bool = False
    paused_remaining_seconds: Optional[float] = None
    timer_task: Optional[asyncio.Task] = field(default=None, repr=False, compare=False)

    def current_round(self) -> Optional[dict[str, Any]]:
        if 0 <= self.current_round_index < len(self.rounds):
            return self.rounds[self.current_round_index]
        return None

    def expected_guessers(self) -> list[str]:
        round_data = self.current_round()
        if not round_data:
            return []
        return [
            player_id
            for player_id, player in self.players.items()
            if player.connected
        ]


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.connections: dict[str, dict[str, set[WebSocket]]] = {}
        self.lock = asyncio.Lock()

    async def create_room(self, host_name: str, guess_duration_seconds: int) -> tuple[Room, Player]:
        async with self.lock:
            code = self._generate_room_code()
            host = Player(player_id=self._generate_player_id(), name=host_name.strip(), is_host=True)
            room = Room(
                code=code,
                host_id=host.player_id,
                players={host.player_id: host},
                guess_duration_seconds=guess_duration_seconds,
            )
            self.rooms[code] = room
            self.connections[code] = {}
            return room, host

    async def join_room(self, code: str, name: str) -> tuple[Room, Player]:
        async with self.lock:
            room = self._get_room(code)
            if len(room.players) >= MAX_PLAYERS:
                raise HTTPException(status_code=400, detail="Rommet er fullt.")
            player = Player(player_id=self._generate_player_id(), name=name.strip())
            room.players[player.player_id] = player
            return room, player

    async def sync_host_spotify(self, code: str, player_id: str, payload: HostSpotifyPayload) -> Room:
        async with self.lock:
            room = self._get_room(code)
            player = self._get_player(room, player_id)
            self._assert_host(room, player_id)
            player.spotify_id = payload.spotify_id
            player.spotify_name = payload.display_name
            player.playlists = payload.playlists[:20]
            player.tracks = payload.tracks[:300]
            return room

    async def update_room_settings(self, code: str, player_id: str, payload: RoomSettingsPayload) -> Room:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, player_id)
            if room.started:
                raise HTTPException(status_code=400, detail="Kan ikke endre gjettetid mens spillet paa gar.")
            room.guess_duration_seconds = payload.guess_duration_seconds
            return room

    async def set_guest_playlist(self, code: str, player_id: str, payload: PlaylistLinkPayload) -> Room:
        async with self.lock:
            room = self._get_room(code)
            player = self._get_player(room, player_id)
            if player.is_host:
                raise HTTPException(status_code=400, detail="Host bruker Spotify-innlogging i stedet.")
            player.guest_playlist_id = payload.playlist_id
            player.guest_playlist_url = payload.playlist_url
            player.guest_playlist_name = None
            player.guest_playlist_synced = False
            player.tracks = []
            player.playlists = []
            return room

    async def import_guest_playlist(
        self, code: str, host_id: str, target_player_id: str, payload: PlaylistImportPayload
    ) -> Room:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, host_id)
            player = self._get_player(room, target_player_id)
            if player.is_host:
                raise HTTPException(status_code=400, detail="Bruk host-sync for hostens egne lister.")
            if player.guest_playlist_id != payload.playlist_id:
                raise HTTPException(status_code=400, detail="Playlist-ID matcher ikke spillerens valgte playlist.")
            player.guest_playlist_name = payload.playlist_name
            player.guest_playlist_synced = True
            player.playlists = [{"id": payload.playlist_id, "name": payload.playlist_name, "trackCount": len(payload.tracks)}]
            player.tracks = payload.tracks[:300]
            return room

    async def start_game(self, code: str, player_id: str, rounds: int) -> Room:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, player_id)
            if room.started:
                raise HTTPException(status_code=400, detail="Spillet er allerede startet.")
            if any(not player.ready() for player in room.players.values()):
                raise HTTPException(status_code=400, detail="Alle spillere må være klare før start.")
            track_owners: dict[str, set[str]] = {}
            track_pool: list[dict[str, Any]] = []
            for player in room.players.values():
                for track in player.tracks:
                    if not track.get("uri"):
                        continue
                    track_id = track.get("id") or track.get("uri")
                    track_owners.setdefault(track_id, set()).add(player.player_id)
                    track_pool.append(
                        {
                            "trackId": track_id,
                            "name": track.get("name"),
                            "artists": track.get("artists", []),
                            "albumImage": track.get("albumImage"),
                            "uri": track.get("uri"),
                            "previewUrl": track.get("previewUrl"),
                            "playlistName": track.get("playlistName") or player.guest_playlist_name,
                            "ownerPlayerId": player.player_id,
                            "ownerName": player.name,
                        }
                    )
            round_pool = [
                track
                for track in track_pool
                if len(track_owners.get(track["trackId"], set())) == 1
            ]
            if len(round_pool) < rounds:
                raise HTTPException(
                    status_code=400,
                    detail="For få unike sanger tilgjengelig for valgt antall runder.",
                )
            room.rounds = random.sample(round_pool, k=rounds)
            room.started = True
            room.current_round_index = 0
            room.current_guesses = {}
            room.winner_id = None
            self._start_guess_phase_locked(room)
            return room

    async def submit_guess(self, code: str, player_id: str, guess_player_id: str) -> Room:
        async with self.lock:
            room = self._get_room(code)
            if not room.started:
                raise HTTPException(status_code=400, detail="Spillet er ikke startet.")
            current_round = room.current_round()
            if not current_round:
                raise HTTPException(status_code=400, detail="Ingen aktiv runde.")
            if room.round_phase != "guessing":
                raise HTTPException(status_code=400, detail="Runden er allerede avslørt.")
            if guess_player_id not in room.players:
                raise HTTPException(status_code=404, detail="Ugyldig spiller.")
            room.current_guesses[player_id] = guess_player_id
            expected = room.expected_guessers()
            if all(guesser in room.current_guesses for guesser in expected):
                self._reveal_round_locked(room)
            return room

    async def next_round(self, code: str, player_id: str) -> Room:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, player_id)
            if not room.started:
                raise HTTPException(status_code=400, detail="Spillet er ikke startet.")
            if room.round_phase == "guessing":
                self._reveal_round_locked(room)
                return room
            self._advance_round_locked(room)
            return room

    async def reset_game(self, code: str, player_id: str) -> Room:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, player_id)
            self._cancel_timer_locked(room)
            room.started = False
            room.rounds = []
            room.current_round_index = -1
            room.current_guesses = {}
            room.reveal_round = False
            room.winner_id = None
            room.round_phase = "lobby"
            room.phase_ends_at = None
            room.phase_started_at = None
            room.paused = False
            room.paused_remaining_seconds = None
            for participant in room.players.values():
                participant.score = 0
            return room

    async def toggle_pause(self, code: str, player_id: str) -> Room:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, player_id)
            if not room.started or room.round_phase not in {"guessing", "reveal"}:
                raise HTTPException(status_code=400, detail="Det er ingen aktiv runde aa pause.")
            now = time.time()
            if room.paused:
                room.paused = False
                remaining = room.paused_remaining_seconds or 0
                room.phase_started_at = now
                room.phase_ends_at = now + remaining
                self._schedule_timer_locked(room, room.round_phase, room.current_round_index, room.phase_ends_at)
            else:
                room.paused = True
                room.paused_remaining_seconds = max((room.phase_ends_at or now) - now, 0)
                room.phase_ends_at = None
                self._cancel_timer_locked(room)
            return room

    async def leave_room(self, code: str, player_id: str) -> Optional[Room]:
        async with self.lock:
            room = self._get_room(code)
            if room.host_id == player_id:
                raise HTTPException(status_code=400, detail="Host maa bruke avslutt spill.")
            player = self._get_player(room, player_id)
            self.connections.get(room.code, {}).pop(player_id, None)
            room.players.pop(player_id, None)
            if room.started and room.round_phase == "guessing":
                expected = room.expected_guessers()
                if expected and all(guesser in room.current_guesses for guesser in expected):
                    self._reveal_round_locked(room)
            return room

    async def end_room(self, code: str, player_id: str) -> list[WebSocket]:
        async with self.lock:
            room = self._get_room(code)
            self._assert_host(room, player_id)
            self._cancel_timer_locked(room)
            sockets: list[WebSocket] = []
            for player_sockets in self.connections.get(room.code, {}).values():
                sockets.extend(list(player_sockets))
            self.connections.pop(room.code, None)
            self.rooms.pop(room.code, None)
            return sockets

    async def connect(self, code: str, player_id: str, websocket: WebSocket) -> Room:
        async with self.lock:
            room = self._get_room(code)
            player = self._get_player(room, player_id)
            await websocket.accept()
            player.connected = True
            self.connections.setdefault(code, {}).setdefault(player_id, set()).add(websocket)
            return room

    async def disconnect(self, code: str, player_id: str, websocket: WebSocket) -> Optional[Room]:
        async with self.lock:
            room = self.rooms.get(code)
            if not room:
                return None
            player_connections = self.connections.setdefault(code, {}).get(player_id, set())
            player_connections.discard(websocket)
            if not player_connections:
                self.connections.get(code, {}).pop(player_id, None)
                player = room.players.get(player_id)
                if player:
                    player.connected = False
            if room.started and room.round_phase == "guessing":
                expected = room.expected_guessers()
                if expected and all(guesser in room.current_guesses for guesser in expected):
                    self._reveal_round_locked(room)
            return room

    async def broadcast_state(self, code: str) -> None:
        room = self.rooms.get(code)
        if not room:
            return
        payload = json.dumps({"type": "room_state", "room": self.serialize_room(room)})
        stale: list[tuple[str, WebSocket]] = []
        for player_id, sockets in self.connections.get(code, {}).items():
            for websocket in sockets:
                try:
                    await websocket.send_text(payload)
                except Exception:
                    stale.append((player_id, websocket))
        if stale:
            async with self.lock:
                for player_id, websocket in stale:
                    self.connections.get(code, {}).get(player_id, set()).discard(websocket)

    def serialize_room(self, room: Room) -> dict[str, Any]:
        current_round = room.current_round()
        round_payload = None
        if current_round:
            round_payload = {
                "index": room.current_round_index,
                "total": len(room.rounds),
                "trackName": current_round["name"] if room.reveal_round else None,
                "artists": current_round["artists"] if room.reveal_round else [],
                "albumImage": current_round["albumImage"] if room.reveal_round else None,
                "playlistName": current_round["playlistName"] if room.reveal_round else None,
                "ownerPlayerId": current_round["ownerPlayerId"] if room.reveal_round else None,
                "ownerName": current_round["ownerName"] if room.reveal_round else None,
                "uri": current_round["uri"],
                "previewUrl": current_round["previewUrl"],
                "revealed": room.reveal_round,
                "guessCount": len(room.current_guesses),
                "expectedGuessers": len(room.expected_guessers()),
                "phase": room.round_phase,
                "phaseEndsAt": room.phase_ends_at,
                "phaseStartedAt": room.phase_started_at,
                "paused": room.paused,
                "pausedRemainingSeconds": room.paused_remaining_seconds,
            }
        return {
            "code": room.code,
            "started": room.started,
            "guessDurationSeconds": room.guess_duration_seconds,
            "revealDurationSeconds": room.reveal_duration_seconds,
            "players": [player.public_state() for player in room.players.values()],
            "hostId": room.host_id,
            "currentRound": round_payload,
            "guesses": room.current_guesses,
            "winnerId": room.winner_id,
        }

    def get_room(self, code: str) -> Room:
        return self._get_room(code)

    def _reveal_round_locked(self, room: Room) -> None:
        current_round = room.current_round()
        if not current_round:
            return
        self._cancel_timer_locked(room)
        room.reveal_round = True
        room.round_phase = "reveal"
        room.paused = False
        room.paused_remaining_seconds = None
        room.phase_started_at = time.time()
        room.phase_ends_at = room.phase_started_at + room.reveal_duration_seconds
        owner_id = current_round["ownerPlayerId"]
        for guesser_id, guess_player_id in room.current_guesses.items():
            if guess_player_id == owner_id:
                room.players[guesser_id].score += 1
        self._schedule_timer_locked(room, "reveal", room.current_round_index, room.phase_ends_at)

    def _winner_id(self, room: Room) -> Optional[str]:
        ranked = sorted(room.players.values(), key=lambda player: player.score, reverse=True)
        if not ranked:
            return None
        return ranked[0].player_id

    def _start_guess_phase_locked(self, room: Room) -> None:
        self._cancel_timer_locked(room)
        room.reveal_round = False
        room.round_phase = "guessing"
        room.current_guesses = {}
        room.paused = False
        room.paused_remaining_seconds = None
        room.phase_started_at = time.time()
        room.phase_ends_at = room.phase_started_at + room.guess_duration_seconds
        self._schedule_timer_locked(room, "guessing", room.current_round_index, room.phase_ends_at)

    def _advance_round_locked(self, room: Room) -> None:
        self._cancel_timer_locked(room)
        if room.current_round_index >= len(room.rounds) - 1:
            room.started = False
            room.winner_id = self._winner_id(room)
            room.round_phase = "finished"
            room.phase_ends_at = None
            room.phase_started_at = None
            room.paused = False
            room.paused_remaining_seconds = None
            return
        room.current_round_index += 1
        self._start_guess_phase_locked(room)

    def _cancel_timer_locked(self, room: Room) -> None:
        if room.timer_task:
            room.timer_task.cancel()
            room.timer_task = None

    def _schedule_timer_locked(self, room: Room, phase: str, round_index: int, ends_at: float) -> None:
        self._cancel_timer_locked(room)
        room.timer_task = asyncio.create_task(self._run_phase_timer(room.code, phase, round_index, ends_at))

    async def _run_phase_timer(self, code: str, phase: str, round_index: int, ends_at: float) -> None:
        delay = max(ends_at - time.time(), 0)
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        async with self.lock:
            room = self.rooms.get(code)
            if not room:
                return
            if room.current_round_index != round_index or room.round_phase != phase or room.paused:
                return
            if room.phase_ends_at is None or abs(room.phase_ends_at - ends_at) > 0.05:
                return
            if phase == "guessing":
                self._reveal_round_locked(room)
            elif phase == "reveal":
                self._advance_round_locked(room)
        await self.broadcast_state(code)

    def _get_room(self, code: str) -> Room:
        room = self.rooms.get(code.upper())
        if not room:
            raise HTTPException(status_code=404, detail="Fant ikke rommet.")
        return room

    def _get_player(self, room: Room, player_id: str) -> Player:
        player = room.players.get(player_id)
        if not player:
            raise HTTPException(status_code=404, detail="Fant ikke spilleren.")
        return player

    def _assert_host(self, room: Room, player_id: str) -> None:
        if room.host_id != player_id:
            raise HTTPException(status_code=403, detail="Kun host kan gjøre dette.")

    def _generate_room_code(self) -> str:
        while True:
            code = "".join(random.choices(string.ascii_uppercase + string.digits, k=ROOM_CODE_LENGTH))
            if code not in self.rooms:
                return code

    def _generate_player_id(self) -> str:
        return "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


manager = RoomManager()
app = FastAPI(title="Guessify")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/api/config")
async def get_config() -> dict[str, Optional[str]]:
    return {
        "spotifyClientId": os.getenv("SPOTIFY_CLIENT_ID"),
        "spotifyRedirectUri": os.getenv("SPOTIFY_REDIRECT_URI"),
    }


@app.post("/api/rooms")
async def create_room(payload: CreateRoomPayload) -> dict[str, Any]:
    room, host = await manager.create_room(payload.host_name, 15)
    await manager.broadcast_state(room.code)
    return {"roomCode": room.code, "playerId": host.player_id, "room": manager.serialize_room(room)}


@app.post("/api/rooms/{code}/join")
async def join_room(code: str, payload: JoinRoomPayload) -> dict[str, Any]:
    room, player = await manager.join_room(code, payload.name)
    await manager.broadcast_state(room.code)
    return {"roomCode": room.code, "playerId": player.player_id, "room": manager.serialize_room(room)}


@app.get("/api/rooms/{code}")
async def get_room(code: str) -> dict[str, Any]:
    room = manager.get_room(code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/host-spotify")
async def sync_host_spotify(code: str, player_id: str, payload: HostSpotifyPayload) -> dict[str, Any]:
    room = await manager.sync_host_spotify(code, player_id, payload)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/settings")
async def update_room_settings(code: str, player_id: str, payload: RoomSettingsPayload) -> dict[str, Any]:
    room = await manager.update_room_settings(code, player_id, payload)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/playlist-link")
async def set_guest_playlist(code: str, player_id: str, payload: PlaylistLinkPayload) -> dict[str, Any]:
    room = await manager.set_guest_playlist(code, player_id, payload)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{host_id}/import/{target_player_id}")
async def import_guest_playlist(code: str, host_id: str, target_player_id: str, payload: PlaylistImportPayload) -> dict[str, Any]:
    room = await manager.import_guest_playlist(code, host_id, target_player_id, payload)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/start")
async def start_game(code: str, player_id: str, payload: StartGamePayload) -> dict[str, Any]:
    room = await manager.start_game(code, player_id, payload.rounds)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/guess")
async def submit_guess(code: str, player_id: str, payload: GuessPayload) -> dict[str, Any]:
    room = await manager.submit_guess(code, player_id, payload.guess_player_id)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/next")
async def next_round(code: str, player_id: str) -> dict[str, Any]:
    room = await manager.next_round(code, player_id)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/pause")
async def toggle_pause(code: str, player_id: str) -> dict[str, Any]:
    room = await manager.toggle_pause(code, player_id)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.post("/api/rooms/{code}/players/{player_id}/leave")
async def leave_room(code: str, player_id: str) -> dict[str, Any]:
    room = await manager.leave_room(code, player_id)
    if room:
        await manager.broadcast_state(room.code)
    return {"ok": True}


@app.post("/api/rooms/{code}/players/{player_id}/end")
async def end_room(code: str, player_id: str) -> dict[str, Any]:
    sockets = await manager.end_room(code, player_id)
    payload = json.dumps({"type": "room_closed", "reason": "host_ended"})
    for websocket in sockets:
        try:
            await websocket.send_text(payload)
            await websocket.close(code=1001)
        except Exception:
            pass
    return {"ok": True}


@app.post("/api/rooms/{code}/players/{player_id}/reset")
async def reset_game(code: str, player_id: str) -> dict[str, Any]:
    room = await manager.reset_game(code, player_id)
    await manager.broadcast_state(room.code)
    return manager.serialize_room(room)


@app.websocket("/ws/{code}/{player_id}")
async def room_ws(websocket: WebSocket, code: str, player_id: str) -> None:
    try:
        room = await manager.connect(code.upper(), player_id, websocket)
        await manager.broadcast_state(room.code)
        while True:
            await websocket.receive_text()
    except HTTPException:
        await websocket.close(code=1008)
    except WebSocketDisconnect:
        room = await manager.disconnect(code.upper(), player_id, websocket)
        if room:
            await manager.broadcast_state(room.code)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
