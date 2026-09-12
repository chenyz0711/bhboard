// ============================================================
// 走廊瓶子赛 · 共享引擎（5v5）
// 被 /kick/（独立页）与 /nfls/（生存内手动踢）共用。
// 引擎只负责：组队、物理、AI、绘制、计时、结束回调。
// 不依赖任何游戏状态（G）；角色数据与结算逻辑由调用方注入。
// ============================================================
(function () {
  const CONST = {
    MW: 640, MH: 220,                 // 画布尺寸
    RAIL_T: 12, RAIL_B: 220 - 12,     // 上下栏杆（走廊边线）
    GX_L: 12, GX_R: 640 - 12,         // 左右球门线
    GM_T: 80, GM_B: 140, GM_C: 110,   // 球门口上沿/下沿/中心
    PR: 11, BR: 7,                    // 球员 / 瓶子半径
    BASE_SPEED: 2.0,                  // 标准速度
    SHOOT_POWER: 7.5,
    GK_SAVE_P: 0.7,                   // 门将守住概率
    PAST_P: 0.75,                     // 遇人过人概率（被断 = 1 - 0.75）
    TACKLE_CD: 30                     // 对抗冷却（帧）
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function chance(p) { return Math.random() < p; }
  function matchSpeed(body) { return CONST.BASE_SPEED * (1 + body * 0.1); }

  // 组队：你操控的 + 随机 4 人 = 我方；其余 5 人 = 对方。每队末位是门将
  function buildTeams(chars, meId) {
    const me = chars.find(c => c.id === meId) || chars[0];
    const pool = chars.filter(c => c.id !== me.id).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return { me, home: [me].concat(pool.slice(0, 4)), away: pool.slice(4, 9) };
  }

  function mkPlayer(c, team, isGK, isUser, x, y) {
    return { c, team, isGK, isUser, x, y, speed: matchSpeed(c.body), cd: 0, hx: x, hy: y };
  }

  function kickoff(m, dir) {
    const hs = m.home, as = m.away;
    m.players = [];
    // 我方守左侧球门、攻右侧
    m.players.push(mkPlayer(hs[4], 'home', true, false, 34, CONST.GM_C));
    m.players.push(mkPlayer(hs[0], 'home', false, true, 250, CONST.GM_C));
    for (let i = 1; i <= 3; i++) m.players.push(mkPlayer(hs[i], 'home', false, false, 130 + i * 45, CONST.GM_C + (i % 2 ? 50 : -50)));
    // 对方守右侧球门、攻左侧
    m.players.push(mkPlayer(as[4], 'away', true, false, CONST.MW - 34, CONST.GM_C));
    for (let i = 0; i <= 3; i++) m.players.push(mkPlayer(as[i], 'away', false, false, CONST.MW - 130 - i * 45, CONST.GM_C + (i % 2 ? 50 : -50)));

    m.players.forEach(p => { p.hx = p.x; p.hy = p.y; });
    m.ball = { x: CONST.MW / 2, y: CONST.GM_C, vx: 0, vy: 0, carrier: null, lock: 0, team: null };
    m.flash = '';
    m.flashT = 0;
  }

  function movePlayer(p, dx, dy) {
    p.x = clamp(p.x + dx, CONST.GX_L + CONST.PR, CONST.GX_R - CONST.PR);
    p.y = clamp(p.y + dy, CONST.RAIL_T + CONST.PR, CONST.RAIL_B - CONST.PR);
  }

  function stepToward(p, tx, ty, dt, mul) {
    const dx = tx - p.x, dy = ty - p.y, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const s = p.speed * (mul || 1) * 0.95 * dt;
    movePlayer(p, dx / len * s, dy / len * s);
  }

  function shoot(m, p) {
    const b = m.ball;
    const tx = p.team === 'home' ? CONST.GX_R : CONST.GX_L;
    const ty = CONST.GM_C + (Math.random() - 0.5) * 26;
    const dx = tx - p.x, dy = ty - p.y, len = Math.hypot(dx, dy) || 1;
    b.carrier = null; b.team = p.team;
    b.vx = dx / len * CONST.SHOOT_POWER; b.vy = dy / len * CONST.SHOOT_POWER;
    b.lock = 10;
  }

  function flashMatch(m, txt) { m.flash = txt; m.flashT = 45; }

  function handleGoalLine(m, b, side) {
    // side = +1 右侧球门（我方向此进攻）；-1 左侧球门
    const line = side > 0 ? CONST.GX_R : CONST.GX_L;
    const crossed = side > 0 ? (b.x + CONST.BR >= line) : (b.x - CONST.BR <= line);
    if (!crossed) return;
    const inMouth = b.y > CONST.GM_T && b.y < CONST.GM_B;
    if (inMouth) {
      const gk = m.players.find(p => p.isGK && p.team === (side > 0 ? 'away' : 'home'));
      if (gk && chance(CONST.GK_SAVE_P)) {
        // 门将扑出：弹回场内
        b.x = side > 0 ? line - CONST.BR - 26 : line + CONST.BR + 26;
        b.vx = side > 0 ? -Math.abs(b.vx || 3) - 1 : Math.abs(b.vx || 3) + 1;
        b.vy = (Math.random() - 0.5) * 3;
        b.lock = 12;
        flashMatch(m, `${gk.c.name} 扑出来了！`);
        return;
      }
      // 进球
      if (side > 0) m.scoreH++; else m.scoreA++;
      flashMatch(m, side > 0 ? '⚽ 你队进球！' : '😱 对方进球！');
      kickoff(m, side > 0 ? -1 : 1);
      return;
    }
    // 打在门柱 / 底线：反弹
    b.x = side > 0 ? line - CONST.BR : line + CONST.BR;
    b.vx = -b.vx * 0.7;
  }

  function aiPlayer(m, p, dt) {
    const b = m.ball;
    const attackX = p.team === 'home' ? CONST.GX_R : CONST.GX_L;
    const defendX = p.team === 'home' ? CONST.GX_L : CONST.GX_R;

    if (p.isGK) {
      const ty = clamp(b.y, CONST.GM_T + CONST.PR, CONST.GM_B - CONST.PR);
      const tx = p.team === 'home' ? CONST.GX_L + 22 : CONST.GX_R - 22;
      stepToward(p, tx, ty, dt, 0.9);
      return;
    }

    if (b.carrier === p) {
      stepToward(p, attackX, CONST.GM_C, dt, 1);
      const distToGoal = Math.abs(attackX - p.x);
      if (distToGoal < 190 && Math.random() < 0.04 * dt) shoot(m, p);
      return;
    }

    const myTeamHas = b.carrier && b.carrier.team === p.team;
    if (!b.carrier) {
      const mates = m.players.filter(x => x.team === p.team && !x.isGK);
      const nearest = mates.slice().sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
      if (nearest === p) stepToward(p, b.x, b.y, dt, 1);
      else stepToward(p, p.hx + (b.x - CONST.MW / 2) * 0.25, p.hy + (b.y - CONST.GM_C) * 0.3, dt, 0.8);
    } else if (myTeamHas) {
      stepToward(p, p.hx + (attackX - p.hx) * 0.35, p.hy + (b.y - CONST.GM_C) * 0.25, dt, 0.85);
    } else {
      const mates = m.players.filter(x => x.team === p.team && !x.isGK);
      const nearest = mates.slice().sort((a, c) => Math.hypot(a.x - b.carrier.x, a.y - b.carrier.y) - Math.hypot(c.x - b.carrier.x, c.y - b.carrier.y))[0];
      if (nearest === p) stepToward(p, b.carrier.x, b.carrier.y, dt, 1);
      else stepToward(p, p.hx + (defendX - p.hx) * 0.18, p.hy, dt, 0.8);
    }
  }

  function updateMatch(m, dt, keys) {
    const b = m.ball;

    // --- 玩家操控 ---
    const me = m.players.find(p => p.isUser);
    if (me) {
      let dx = 0, dy = 0;
      if (keys['a']) dx -= 1;
      if (keys['d']) dx += 1;
      if (keys['w']) dy -= 1;
      if (keys['s']) dy += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        movePlayer(me, dx / len * me.speed * dt, dy / len * me.speed * dt);
      }
      if (keys[' '] && b.carrier === me) shoot(m, me);
    }

    // --- AI ---
    m.players.forEach(p => {
      if (p.isUser) return;
      if (p.cd > 0) p.cd -= dt;
      aiPlayer(m, p, dt);
    });

    // --- 持球者带球 ---
    if (b.carrier) {
      const c = b.carrier;
      const dir = (c.team === 'home') ? 1 : -1;
      b.x = c.x + dir * (CONST.PR + 2);
      b.y = c.y;
      b.vx = b.vy = 0;
    } else {
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= Math.pow(0.985, dt); b.vy *= Math.pow(0.985, dt);
      if (b.lock > 0) b.lock -= dt;

      // 上下栏杆反弹
      if (b.y - CONST.BR < CONST.RAIL_T) { b.y = CONST.RAIL_T + CONST.BR; b.vy = Math.abs(b.vy); }
      if (b.y + CONST.BR > CONST.RAIL_B) { b.y = CONST.RAIL_B - CONST.BR; b.vy = -Math.abs(b.vy); }

      // 左右球门
      handleGoalLine(m, b, +1);
      handleGoalLine(m, b, -1);

      // 捡球
      if (b.lock <= 0) {
        for (const p of m.players) {
          if (Math.hypot(p.x - b.x, p.y - b.y) < CONST.PR + CONST.BR) {
            b.carrier = p; b.team = p.team; b.vx = b.vy = 0;
            break;
          }
        }
      }
    }

    // --- 对抗：过人 / 被断 ---
    if (b.carrier) {
      const c = b.carrier;
      for (const p of m.players) {
        if (p.team === c.team) continue;
        if (c.cd > 0 || p.cd > 0) continue;
        if (Math.hypot(p.x - c.x, p.y - c.y) < CONST.PR * 2) {
          c.cd = CONST.TACKLE_CD; p.cd = CONST.TACKLE_CD;
          if (chance(CONST.PAST_P)) {
            // 过人：保住球，把对方顶到接触范围之外（避免冷却结束后立刻再判一次）
            let ux = p.x - c.x, uy = p.y - c.y;            // 从持球者指向对手 = 顶开方向
            let al = Math.hypot(ux, uy);
            if (al < 0.001) { ux = 1; uy = 0; al = 1; }      // 完全重叠时给个确定方向
            const sep = CONST.PR * 2 + 6;                    // 目标间距：接触范围 + 余量
            const push = Math.max(sep - al, CONST.PR * 1.6); // 至少顶开 1.6 个身位
            movePlayer(p, ux / al * push, uy / al * push);
            if (c.isUser || p.isUser) flashMatch(m, c.isUser ? '过掉了！' : '被过掉了');
          } else {
            // 被断：球权易主
            b.carrier = p; b.team = p.team;
            if (c.isUser) flashMatch(m, '被断了！');
            else if (p.isUser) flashMatch(m, '断球成功！');
          }
          break;
        }
      }
    }

    m.players.forEach(p => { if (p.cd > 0) p.cd -= dt; });
    if (m.flashT > 0) m.flashT -= dt;
  }

  function drawMatch(ctx, m) {
    const b = m.ball;
    ctx.clearRect(0, 0, CONST.MW, CONST.MH);
    // 地面
    ctx.fillStyle = '#0d1422'; ctx.fillRect(0, 0, CONST.MW, CONST.MH);
    ctx.fillStyle = '#111a2b'; ctx.fillRect(CONST.GX_L, CONST.RAIL_T, CONST.GX_R - CONST.GX_L, CONST.RAIL_B - CONST.RAIL_T);
    // 中线
    ctx.strokeStyle = '#243350'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(CONST.MW / 2, CONST.RAIL_T); ctx.lineTo(CONST.MW / 2, CONST.RAIL_B); ctx.stroke();
    // 上下栏杆
    ctx.fillStyle = '#3a4a63';
    ctx.fillRect(0, 0, CONST.MW, CONST.RAIL_T); ctx.fillRect(0, CONST.RAIL_B, CONST.MW, CONST.MH - CONST.RAIL_B);
    // 球门
    ctx.fillStyle = '#1d3a5c';
    ctx.fillRect(0, CONST.GM_T, CONST.GX_L, CONST.GM_B - CONST.GM_T);
    ctx.fillRect(CONST.GX_R, CONST.GM_T, CONST.MW - CONST.GX_R, CONST.GM_B - CONST.GM_T);
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2;
    ctx.strokeRect(1, CONST.GM_T, CONST.GX_L - 1, CONST.GM_B - CONST.GM_T);
    ctx.strokeRect(CONST.GX_R, CONST.GM_T, CONST.MW - CONST.GX_R - 1, CONST.GM_B - CONST.GM_T);

    // 球员
    m.players.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONST.PR, 0, Math.PI * 2);
      ctx.fillStyle = p.team === 'home' ? '#3d7bd6' : '#d6574f';
      ctx.fill();
      if (p.isGK) { ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 2; ctx.stroke(); }
      if (p.isUser) {
        ctx.beginPath(); ctx.arc(p.x, p.y, CONST.PR + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#e8eefc'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.c.name, p.x, p.y - CONST.PR - 8);
      }
    });

    // 瓶子
    ctx.beginPath(); ctx.arc(b.x, b.y, CONST.BR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd76a'; ctx.fill();
    ctx.strokeStyle = '#8a6a1f'; ctx.lineWidth = 1.5; ctx.stroke();

    // 提示文字
    if (m.flashT > 0 && m.flash) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(m.flash, CONST.MW / 2, 34);
    }
  }

  // ------------------------------------------------------------
  // start(cfg) 启动一场比赛
  // cfg: { canvas, scoreEl, timeEl, chars, meId, seconds, onEnd }
  //   onEnd(result): result = { scoreH, scoreA, win, draw, me, goals }
  // 返回 { stop() }
  // ------------------------------------------------------------
  function start(cfg) {
    const ctx = cfg.canvas.getContext('2d');
    const teams = buildTeams(cfg.chars, cfg.meId);
    const m = {
      me: teams.me, home: teams.home, away: teams.away,
      scoreH: 0, scoreA: 0, players: [], ball: null,
      left: cfg.seconds * 1000, over: false, flash: '', flashT: 0
    };

    function hud() {
      if (cfg.scoreEl) cfg.scoreEl.textContent = `${m.scoreH} : ${m.scoreA}`;
      if (cfg.timeEl) cfg.timeEl.textContent = `${Math.ceil(m.left / 1000)} 秒`;
    }

    kickoff(m, 1);
    hud();

    const keys = {};
    function down(e) {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' '].indexOf(k) !== -1) { keys[k] = true; e.preventDefault(); }
    }
    function up(e) { keys[e.key.toLowerCase()] = false; }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    let raf = 0, last = performance.now();
    function stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    }
    function end() {
      m.over = true;
      stop();
      if (cfg.onEnd) cfg.onEnd({
        scoreH: m.scoreH, scoreA: m.scoreA,
        win: m.scoreH > m.scoreA, draw: m.scoreH === m.scoreA,
        me: m.me, goals: m.scoreH
      });
    }
    function frame(now) {
      if (m.over) return;
      const dt = Math.min((now - last) / 16.6667, 2.5);
      last = now;
      m.left -= dt * 16.6667;
      if (m.left <= 0) { m.left = 0; updateMatch(m, dt, keys); drawMatch(ctx, m); hud(); end(); return; }
      updateMatch(m, dt, keys);
      drawMatch(ctx, m);
      hud();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return { stop, state: m };
  }

  window.KickEngine = { CONST, matchSpeed, buildTeams, start };
})();
