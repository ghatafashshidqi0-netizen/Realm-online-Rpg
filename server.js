const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const players = new Map();
const enemies = new Map();
const WORLD = 58;

function makeEnemy(i) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 12 + Math.random() * 38;
  return {
    id: "slime-" + i,
    type: "slime",
    x: Math.max(-WORLD, Math.min(WORLD, Math.cos(angle) * radius)),
    z: Math.max(-WORLD, Math.min(WORLD, -8 - Math.abs(Math.sin(angle) * radius))),
    hp: i % 8 === 0 ? 100 : 45,
    maxHp: i % 8 === 0 ? 100 : 45,
    rank: i % 8 === 0 ? 2 : 1,
    alive: true,
    respawnAt: 0
  };
}
for (let i = 0; i < 28; i++) enemies.set("slime-" + i, makeEnemy(i));

function publicPlayer(p) {
  return { id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot };
}
function publicEnemy(e) {
  return { id: e.id, type: e.type, x: e.x, z: e.z, hp: e.hp, maxHp: e.maxHp, rank: e.rank };
}

io.on("connection", socket => {
  socket.on("join", data => {
    const name = String(data?.name || "Adventurer").replace(/[<>]/g, "").slice(0, 16);
    const p = { id: socket.id, name, x: 0, z: 9, rot: 0, lastMove: 0 };
    players.set(socket.id, p);
    socket.emit("init", {
      players: [...players.values()].filter(q => q.id !== socket.id).map(publicPlayer),
      enemies: [...enemies.values()].filter(e => e.alive).map(publicEnemy)
    });
    socket.broadcast.emit("playerJoined", publicPlayer(p));
    io.emit("count", players.size);
  });

  socket.on("move", data => {
    const p = players.get(socket.id);
    if (!p || !data) return;
    const now = Date.now();
    if (now - p.lastMove < 35) return;
    p.lastMove = now;
    p.x = Math.max(-WORLD, Math.min(WORLD, Number(data.x) || 0));
    p.z = Math.max(-WORLD, Math.min(WORLD, Number(data.z) || 0));
    p.rot = Number(data.rot) || 0;
    socket.broadcast.emit("playerMoved", publicPlayer(p));
  });

  socket.on("chat", raw => {
    const p = players.get(socket.id);
    if (!p) return;
    const message = String(raw || "").replace(/[<>]/g, "").trim().slice(0, 100);
    if (!message) return;
    io.emit("chat", { name: p.name, message });
  });

  socket.on("enemyHit", data => {
    const p = players.get(socket.id);
    const e = enemies.get(String(data?.id));
    if (!p || !e || !e.alive) return;
    // Server checks attack distance and clamps damage.
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d > 5) return;
    const damage = Math.max(1, Math.min(80, Number(data.damage) || 1));
    e.hp = Math.max(0, e.hp - damage);
    if (e.hp <= 0) {
      e.alive = false;
      e.respawnAt = Date.now() + 9000;
    }
    io.emit("enemyState", publicEnemy(e));
  });

  socket.on("enemyKilled", data => {
    // Cosmetic client notification only; enemy state is handled by enemyHit.
    const e = enemies.get(String(data?.id));
    if (e) io.emit("enemyState", publicEnemy(e));
  });

  socket.on("skill", data => {
    const p = players.get(socket.id);
    if (!p || !data) return;
    const x = Number(data.x) || 0, z = Number(data.z) || 0;
    for (const e of enemies.values()) {
      if (!e.alive || Math.hypot(e.x - x, e.z - z) > 7) continue;
      e.hp = Math.max(0, e.hp - 35);
      if (e.hp <= 0) { e.alive = false; e.respawnAt = Date.now() + 9000; }
      io.emit("enemyState", publicEnemy(e));
    }
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    socket.broadcast.emit("playerLeft", socket.id);
    io.emit("count", players.size);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const e of enemies.values()) {
    if (!e.alive && e.respawnAt <= now) {
      const replacement = makeEnemy(Number(e.id.split("-")[1]) || 0);
      Object.assign(e, replacement, { id: e.id, alive: true, respawnAt: 0 });
      io.emit("enemyRespawn", publicEnemy(e));
    }
  }
}, 1000);

app.get("/health", (req, res) => res.json({ ok: true, players: players.size, enemies: enemies.size }));
server.listen(PORT, "0.0.0.0", () => console.log(`REALM ONLINE running on port ${PORT}`));
