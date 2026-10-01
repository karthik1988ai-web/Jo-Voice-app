/*
 * Jo background: an animated knowledge-graph network (colored clusters, hub fans,
 * links between clusters, signals travelling along edges). Drawn on #particles.
 * window.JoGraph.setActivity(mode) makes it busier while Jo listens, thinks or speaks.
 */
(function () {
  "use strict";
  const canvas = document.getElementById("particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const COLORS = ["#ff4d6d", "#ff9f43", "#4d7cff", "#3ee6ff", "#b98cff", "#ffd166", "#6ee7a8", "#ff7eb6"];
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const COLOR_RGB = COLORS.map(rgb);
  const PULSES_PER_SEC = { idle: 1.2, listening: 4, thinking: 9, speaking: 5, error: 2 };

  let w = 0, h = 0, dpr = 1;
  let nodes = [], edges = [], clusters = [], pulses = [];
  let activity = "idle", spawnDebt = 0, last = performance.now();
  const mouse = { x: -1e4, y: -1e4 };
  const rand = (a, b) => a + Math.random() * (b - a);

  function build() {
    nodes = []; edges = []; pulses = [];
    const count = Math.max(200, Math.min(520, Math.round((w * h) / 2900)));
    const k = Math.min(w, h);
    // Cluster centres spread around the screen, a couple near the middle.
    const nClusters = 9;
    clusters = Array.from({ length: nClusters }, (_, i) => {
      const a = (i / nClusters) * Math.PI * 2 + rand(-0.3, 0.3);
      const r = i < 2 ? rand(0, 0.08) : rand(0.16, 0.34);
      return {
        bx: w / 2 + Math.cos(a) * r * w, by: h / 2 + Math.sin(a) * r * h * 1.05,
        x: 0, y: 0, color: i % COLORS.length, phase: rand(0, 6.28),
        fan: i === 5 || i === 6, // yellow / green "fans" like the reference image
      };
    });
    clusters.forEach((c) => { c.x = c.bx; c.y = c.by; });

    const sizes = clusters.map((c) => (c.fan ? 0.6 : rand(0.8, 1.4)));
    const total = sizes.reduce((s, v) => s + v, 0);
    clusters.forEach((c, ci) => {
      const n = Math.max(12, Math.round((sizes[ci] / total) * count));
      const start = nodes.length;
      const spread = k * (c.fan ? 0.05 : 0.09);
      for (let j = 0; j < n; j++) {
        nodes.push({
          x: c.x + rand(-spread, spread), y: c.y + rand(-spread, spread), vx: 0, vy: 0,
          c: ci, hub: j === 0, r: j === 0 ? 3.4 : rand(1.2, 2.3), tw: rand(0, 6.28), deg: 0,
        });
        if (j > 0) {
          // Fans: every leaf hangs off the hub. Others: tree-like links plus a few extra.
          const parent = c.fan ? start : start + Math.floor(Math.random() * Math.min(j, 6 + j / 2));
          edges.push([start + j, parent]);
          if (!c.fan && Math.random() < 0.5) edges.push([start + j, start + Math.floor(Math.random() * j)]);
        }
      }
      c.start = start; c.end = nodes.length;
    });
    // Links between clusters (the long coloured strands in the reference).
    const bridges = Math.round(nodes.length * 0.16);
    for (let i = 0; i < bridges; i++) {
      const a = Math.floor(Math.random() * nodes.length);
      let b = Math.floor(Math.random() * nodes.length);
      if (nodes[a].c === nodes[b].c) b = clusters[(nodes[a].c + 1 + Math.floor(Math.random() * 3)) % clusters.length].start;
      edges.push([a, b]);
    }
    // A couple of tendrils: thin chains leaving the graph.
    for (let t = 0; t < 2; t++) {
      const c = clusters[2 + t * 4];
      let prev = c.start;
      const dir = Math.atan2(c.by - h / 2, c.bx - w / 2) + rand(-0.5, 0.5);
      for (let s = 1; s <= 9; s++) {
        nodes.push({ x: c.x + Math.cos(dir) * s * 18, y: c.y + Math.sin(dir) * s * 18, vx: 0, vy: 0,
          c: clusters.indexOf(c), hub: false, r: 1.2, tw: rand(0, 6.28), deg: 0, tendril: true });
        edges.push([nodes.length - 1, prev]);
        prev = nodes.length - 1;
      }
    }
    edges.forEach(([a, b]) => { nodes[a].deg++; nodes[b].deg++; });
    for (let i = 0; i < 260; i++) step(1, 0);
  }

  // Force-directed layout: springs on edges, repulsion between nearby nodes, weak pull home.
  function step(strength, time) {
    const cell = 60, grid = new Map();
    clusters.forEach((c) => {
      c.x = c.bx + Math.sin(time * 0.00011 + c.phase) * 18;
      c.y = c.by + Math.cos(time * 0.00009 + c.phase) * 14;
    });
    nodes.forEach((n, i) => {
      const key = ((n.x / cell) | 0) + "," + ((n.y / cell) | 0);
      (grid.get(key) || grid.set(key, []).get(key)).push(i);
    });
    nodes.forEach((n, i) => {
      const gx = (n.x / cell) | 0, gy = (n.y / cell) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(gx + dx + "," + (gy + dy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const m = nodes[j];
          let ex = n.x - m.x, ey = n.y - m.y, d2 = ex * ex + ey * ey;
          if (d2 > cell * cell || d2 === 0) continue;
          const f = (160 / d2) * strength;
          ex *= f; ey *= f;
          n.vx += ex; n.vy += ey; m.vx -= ex; m.vy -= ey;
        }
      }
    });
    for (const [a, b] of edges) {
      const n = nodes[a], m = nodes[b];
      const rest = n.tendril || m.tendril ? 18 : nodes[a].c === nodes[b].c ? 20 : 110;
      const ex = m.x - n.x, ey = m.y - n.y, d = Math.hypot(ex, ey) || 1;
      const f = ((d - rest) / d) * (nodes[a].c === nodes[b].c ? 0.02 : 0.002) * strength;
      n.vx += ex * f; n.vy += ey * f; m.vx -= ex * f; m.vy -= ey * f;
    }
    for (const n of nodes) {
      const c = clusters[n.c];
      n.vx += (c.x - n.x) * 0.0012 * strength;
      n.vy += (c.y - n.y) * 0.0012 * strength;
      // The cursor gently parts the graph.
      const mx = n.x - mouse.x, my = n.y - mouse.y, md2 = mx * mx + my * my;
      if (md2 < 120 * 120) { const f = 0.6 / Math.max(md2, 400); n.vx += mx * f * 40; n.vy += my * f * 40; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
    }
  }

  function spawnPulse() {
    const e = edges[Math.floor(Math.random() * edges.length)];
    const forward = Math.random() < 0.5;
    pulses.push({ a: forward ? e[0] : e[1], b: forward ? e[1] : e[0], t: 0, speed: rand(0.5, 1.1) });
  }

  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const near = (n) => { const dx = n.x - mouse.x, dy = n.y - mouse.y; return dx * dx + dy * dy < 140 * 140; };

    ctx.lineWidth = 0.7;
    for (const [a, b] of edges) {
      const n = nodes[a], m = nodes[b], col = COLOR_RGB[clusters[n.c].color];
      const lit = near(n) || near(m);
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${lit ? 0.55 : n.c === m.c ? 0.2 : 0.11})`;
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
    }
    for (const n of nodes) {
      const col = COLOR_RGB[clusters[n.c].color];
      const twinkle = 0.55 + 0.45 * Math.sin(time * 0.0016 + n.tw);
      const lit = near(n);
      const r = n.r + (lit ? 1 : 0) + Math.min(n.deg, 12) * 0.06;
      if (n.hub || lit) {
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.12)`;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 3.2, 0, 6.283); ctx.fill();
      }
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${lit ? 1 : 0.45 + 0.4 * twinkle})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    for (const p of pulses) {
      const n = nodes[p.a], m = nodes[p.b], col = COLOR_RGB[clusters[n.c].color];
      const x = n.x + (m.x - n.x) * p.t, y = n.y + (m.y - n.y) * p.t;
      const fade = Math.sin(p.t * Math.PI);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.25 * fade})`;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function frame(time) {
    const dt = Math.min(0.05, (time - last) / 1000); last = time;
    step(0.35, time);
    spawnDebt += (PULSES_PER_SEC[activity] || 1) * dt;
    while (spawnDebt >= 1) { spawnPulse(); spawnDebt -= 1; }
    for (const p of pulses) {
      const n = nodes[p.a], m = nodes[p.b];
      p.t += (p.speed * 90 * dt) / (Math.hypot(m.x - n.x, m.y - n.y) || 1);
    }
    pulses = pulses.filter((p) => p.t < 1);
    draw(time);
    requestAnimationFrame(frame);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    build();
    if (reduced) draw(0);
  }

  let resizeTimer;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 200); });
  addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener("pointerleave", () => { mouse.x = mouse.y = -1e4; });
  resize();
  if (!reduced) requestAnimationFrame(frame);

  window.JoGraph = { setActivity(mode) { activity = mode in PULSES_PER_SEC ? mode : "idle"; } };
})();
