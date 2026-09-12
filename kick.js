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
    GM_T: 62, GM_B: 158, GM_C: 110,   // 球门口上沿/下沿/中心（已加宽：原 80/140）
    PR: 11, BR: 7,                    // 球员 / 瓶子半径
    BASE_SPEED: 2.0,                  // 标准速度
    SHOOT_POWER: 7.5,
    GK_SAVE_P: 0.7,                   // 门将守住概率
    PAST_P: 0.75,                     // 遇人过人概率（被断 = 1 - 0.75）
    TACKLE_CD: 30,                    // 对抗冷却（帧）

    CARRY_MUL: 0.6,                   // 持球时移速 ×0.6
    GK_HOLD: 45,                      // 门将没收瓶子后持球帧数（约 0.75 秒）再大脚开出
    GK_PUNT_DUR: 42,                  // 大脚飞行帧数（落地前不可被抢）
    GK_SAFE_R: 64,                    // 门将持球时其他人的回避半径
    PASS_PANIC: 0.055,                // 被贴身逼抢时每帧传球概率
    PASS_CHANCE: 0.012,               // 无压力推进时每帧传球概率
    PASS_LOCK: 6,                     // 传球后的短暂拾取保护（防刚传出就被自己捡回）
    THREAT_R: 72                      // 判定"被逼近"的距离
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function chance(p) { return Math.random() < p; }
  function randRange(a, b) { return a + Math.random() * (b - a); }
  function matchSpeed(body) { return CONST.BASE_SPEED * (1 + body * 0.1); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

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
    // 注意：m.triedUser 是整场记忆，重新开球不重置
    m.ball = { x: CONST.MW / 2, y: CONST.GM_C, vx: 0, vy: 0, carrier: null, lock: 0, team: null, air: null };
    m.gkHold = null;
    m.flash = '';
    m.flashT = 0;
  }

  function movePlayer(p, dx, dy) {
    p.x = clamp(p.x + dx, CONST.GX_L + CONST.PR, CONST.GX_R - CONST.PR);
    p.y = clamp(p.y + dy, CONST.RAIL_T + CONST.PR, CONST.RAIL_B - CONST.PR);
  }

  // 持球者移速 ×0.6
  function speedMul(m, p) { return (m.ball && m.ball.carrier === p) ? CONST.CARRY_MUL : 1; }

  function stepToward(m, p, tx, ty, dt, mul) {
    const dx = tx - p.x, dy = ty - p.y, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const s = p.speed * speedMul(m, p) * (mul || 1) * 0.95 * dt;
    movePlayer(p, dx / len * s, dy / len * s);
  }

  function stepAway(m, p, sx, sy, dt, mul) {
    const dx = p.x - sx, dy = p.y - sy, len = Math.hypot(dx, dy) || 1;
    const s = p.speed * speedMul(m, p) * (mul || 1) * 0.95 * dt;
    movePlayer(p, dx / len * s, dy / len * s);
  }

  function shoot(m, p) {
    const b = m.ball;
    const tx = p.team === 'home' ? CONST.GX_R : CONST.GX_L;
    const ty = CONST.GM_C + (Math.random() - 0.5) * 52;   // 球门加宽，射门角度范围同步放大
    const dx = tx - p.x, dy = ty - p.y, len = Math.hypot(dx, dy) || 1;
    b.carrier = null; b.team = p.team; b.air = null;
    b.vx = dx / len * CONST.SHOOT_POWER; b.vy = dy / len * CONST.SHOOT_POWER;
    b.lock = 10;
  }

  // 传球：把瓶子踢向队友，飞行途中可被对方拦截
  function passBall(m, p, mate) {
    const b = m.ball;
    const dx = mate.x - p.x, dy = mate.y - p.y, len = Math.hypot(dx, dy) || 1;
    const pw = clamp(len * 0.05, 4.2, 8.6);              // 距离越远踢得越用力
    b.carrier = null; b.team = p.team; b.air = null;
    b.vx = dx / len * pw; b.vy = dy / len * pw;
    b.lock = CONST.PASS_LOCK;
    m.stats.passes++;
    if (p.isUser || mate.isUser) flashMatch(m, `${p.c.name} → ${mate.c.name} 传球！`);
  }

  // 挑选接球人：靠前、周围没人、距离适中
  function bestPassTarget(m, p) {
    let best = null, bestScore = -Infinity;
    for (const x of m.players) {
      if (x === p || x.team !== p.team || x.isGK) continue;
      const d = Math.hypot(x.x - p.x, x.y - p.y);
      if (d < 46 || d > 320) continue;                    // 太近没意义，太远传不到
      let near = 0;
      for (const o of m.players) {
        if (o.team !== p.team && Math.hypot(o.x - x.x, o.y - x.y) < 58) near++;
      }
      const advance = (p.team === 'home' ? x.x - p.x : p.x - x.x);
      const score = advance * 1.0 - near * 95 - d * 0.22;
      if (score > bestScore) { bestScore = score; best = x; }
    }
    return bestScore > -70 ? best : null;
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
        // 门将扑出：直接没收（进入门将持球状态）
        b.x = side > 0 ? line - CONST.BR - 20 : line + CONST.BR + 20;
        b.vx = b.vy = 0;
        b.carrier = gk; b.team = gk.team; b.air = null; b.lock = 0;
        m.gkHold = { gk, timer: CONST.GK_HOLD };
        m.stats.saves++;
        flashMatch(m, `${gk.c.name} 把瓶子没收了！`);
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

  // 门将大脚：把瓶子扔到对面半场，落地前谁都抢不到
  function gkPunt(m) {
    const b = m.ball;
    const gk = m.gkHold.gk;
    const toRight = gk.team === 'home';                 // home 守左门 → 往右半场扔
    b.carrier = null; b.team = gk.team; b.vx = b.vy = 0;
    b.air = {
      t: 0, dur: CONST.GK_PUNT_DUR,
      fromX: b.x, fromY: b.y,
      toX: toRight ? randRange(CONST.MW * 0.60, CONST.MW * 0.88) : randRange(CONST.MW * 0.12, CONST.MW * 0.40),
      toY: randRange(CONST.RAIL_T + 26, CONST.RAIL_B - 26)
    };
    b.lock = CONST.GK_PUNT_DUR + 10;                    // 覆盖整个飞行时间，落地前不可捡
    m.gkHold = null;
    m.stats.punts++;
    flashMatch(m, `${gk.c.name} 大脚开到对面半场！`);
  }

  function aiPlayer(m, p, dt) {
    const b = m.ball;
    const attackX = p.team === 'home' ? CONST.GX_R : CONST.GX_L;
    const defendX = p.team === 'home' ? CONST.GX_L : CONST.GX_R;

    // --- 门将持球阶段：持球门将站定，其余人全部回避、不靠近 ---
    if (m.gkHold) {
      if (m.gkHold.gk === p) return;                    // 持球门将不动，等着开球
      const gk = m.gkHold.gk;
      const d = Math.hypot(p.x - gk.x, p.y - gk.y);
      if (d < CONST.GK_SAFE_R) {
        // 优先退回自己的开球原位（合法布阵点，不会贴墙角）；
        // 若原位也在圈内（极罕见），才用径向推挤，避免被墙壁 clamp 卡死
        const hd = Math.hypot(p.hx - gk.x, p.hy - gk.y);
        if (hd >= CONST.GK_SAFE_R) stepToward(m, p, p.hx, p.hy, dt, 1);
        else stepAway(m, p, gk.x, gk.y, dt, 1);
        return;
      }
      // 已退出回避圈：往门将将要开球的方向散开准备接应
      const puntDir = gk.team === 'home' ? 1 : -1;
      if (p.isGK) stepToward(m, p, p.hx, p.hy, dt, 0.9);
      else stepToward(m, p, p.hx + puntDir * 110, p.hy, dt, 0.85);
      return;
    }

    // --- 本队门将：守门线，跟球纵向移动 ---
    if (p.isGK) {
      const ty = clamp(b.y, CONST.GM_T + CONST.PR, CONST.GM_B - CONST.PR);
      const tx = p.team === 'home' ? CONST.GX_L + 22 : CONST.GX_R - 22;
      stepToward(m, p, tx, ty, dt, 0.9);
      return;
    }

    // --- 自己持球：推进 / 射门 / 传球 ---
    if (b.carrier === p) {
      let threats = 0;
      for (const o of m.players) {
        if (o.team !== p.team && Math.hypot(o.x - p.x, o.y - p.y) < CONST.THREAT_R) threats++;
      }
      const passP = threats > 0 ? CONST.PASS_PANIC : CONST.PASS_CHANCE;
      if (Math.random() < passP * dt) {
        const mate = bestPassTarget(m, p);
        if (mate) { passBall(m, p, mate); return; }
      }
      stepToward(m, p, attackX, CONST.GM_C, dt, 1);
      const distToGoal = Math.abs(attackX - p.x);
      if (distToGoal < 200 && Math.random() < 0.04 * dt) shoot(m, p);
      return;
    }

    // --- 球在空中（门将大脚）：去落点附近等着，但不能拦截 ---
    if (b.air) {
      const landX = b.air.toX, landY = b.air.toY;
      const mySide = (p.team === 'home') ? (landX > CONST.MW / 2) : (landX < CONST.MW / 2);
      if (mySide) stepToward(m, p, landX + (p.team === 'home' ? -26 : 26), landY, dt, 1);
      else stepToward(m, p, p.hx, p.hy, dt, 0.8);
      return;
    }

    const myTeamHas = b.carrier && b.carrier.team === p.team;

    if (!b.carrier) {
      // 自由球：最近的队友去抢，其余回位
      const mates = m.players.filter(x => x.team === p.team && !x.isGK);
      const nearest = mates.slice().sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
      if (nearest === p) stepToward(m, p, b.x, b.y, dt, 1);
      else stepToward(m, p, p.hx + (b.x - CONST.MW / 2) * 0.25, p.hy + (b.y - CONST.GM_C) * 0.3, dt, 0.8);
    } else if (myTeamHas) {
      // 队友持球：往前插跑位
      stepToward(m, p, p.hx + (attackX - p.hx) * 0.35, p.hy + (b.y - CONST.GM_C) * 0.25, dt, 0.85);
    } else {
      // 对方持球
      const carrierIsUser = !!b.carrier.isUser;
      const iAlreadyTried = carrierIsUser && m.triedUser[p.c.id];
      if (iAlreadyTried) {
        // 我已经断过他一次了，不再跟着他抢 → 回防站位
        stepToward(m, p, p.hx + (defendX - p.hx) * 0.22, p.hy, dt, 0.8);
        return;
      }
      // 竞选去抢球的人：排除已断过用户的 AI
      const mates = m.players.filter(x => x.team === p.team && !x.isGK && !(carrierIsUser && m.triedUser[x.c.id]));
      const nearest = mates.slice().sort((a, c) => Math.hypot(a.x - b.carrier.x, a.y - b.carrier.y) - Math.hypot(c.x - b.carrier.x, c.y - b.carrier.y))[0];
      if (nearest === p) stepToward(m, p, b.carrier.x, b.carrier.y, dt, 1);
      else stepToward(m, p, p.hx + (defendX - p.hx) * 0.18, p.hy, dt, 0.8);
    }
  }

  function updateMatch(m, dt, keys) {
    const b = m.ball;

    // --- 玩家操控（持球时移速 ×0.6）---
    const me = m.players.find(p => p.isUser);
    if (me && !(m.gkHold && m.gkHold.gk === me)) {
      let dx = 0, dy = 0;
      if (keys['a']) dx -= 1;
      if (keys['d']) dx += 1;
      if (keys['w']) dy -= 1;
      if (keys['s']) dy += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const sp = me.speed * speedMul(m, me) * dt;
        movePlayer(me, dx / len * sp, dy / len * sp);
      }
      if (keys[' '] && b.carrier === me && !m.gkHold) shoot(m, me);
    }

    // --- 门将持球倒计时 → 大脚开出 ---
    if (m.gkHold) {
      m.gkHold.timer -= dt;
      if (m.gkHold.timer <= 0) gkPunt(m);
    }

    // --- AI ---
    m.players.forEach(p => {
      if (p.isUser) return;
      if (p.cd > 0) p.cd -= dt;
      aiPlayer(m, p, dt);
    });

    // --- 瓶子运动 ---
    if (b.carrier) {
      const c = b.carrier;
      const dir = (c.team === 'home') ? 1 : -1;
      b.x = c.x + dir * (CONST.PR + 2);
      b.y = c.y;
      b.vx = b.vy = 0;
    } else if (b.air) {
      // 大脚飞行：抛物线插值，落地前不可捡、不可抢、不会进门
      b.air.t += dt / b.air.dur;
      if (b.air.t >= 1) {
        b.x = b.air.toX; b.y = b.air.toY;
        b.air = null; b.lock = 5;
        flashMatch(m, '瓶子落地了！');
      } else {
        b.x = b.air.fromX + (b.air.toX - b.air.fromX) * b.air.t;
        b.y = b.air.fromY + (b.air.toY - b.air.fromY) * b.air.t;
      }
      if (b.lock > 0) b.lock -= dt;
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

      // 捡球（飞行中不可捡）
      if (b.lock <= 0 && !b.air && !b.carrier) {
        for (const p of m.players) {
          if (Math.hypot(p.x - b.x, p.y - b.y) < CONST.PR + CONST.BR) {
            b.carrier = p; b.team = p.team; b.vx = b.vy = 0;
            if (p.isGK) {                                 // 门将捡到 → 进入持球状态
              m.gkHold = { gk: p, timer: CONST.GK_HOLD };
              flashMatch(m, `${p.c.name} 没收了瓶子！`);
            }
            break;
          }
        }
      }
    }

    // --- 对抗：过人 / 被断（门将持球时任何人都抢不到）---
    if (b.carrier && !m.gkHold) {
      const c = b.carrier;
      for (const p of m.players) {
        if (p.team === c.team) continue;
        if (c.cd > 0 || p.cd > 0) continue;
        if (c.isUser && m.triedUser[p.c.id]) continue;      // 此人已断过用户一次，不再抢
        if (Math.hypot(p.x - c.x, p.y - c.y) < CONST.PR * 2) {
          c.cd = CONST.TACKLE_CD; p.cd = CONST.TACKLE_CD;
          if (c.isUser) {
            m.triedUser[p.c.id] = true;                     // 记录：他试过了，之后不再追用户
            m.stats.tacklesOnUser++;
          }
          if (chance(CONST.PAST_P)) {
            // 过人：保住球，把对方顶到接触范围之外
            let ux = p.x - c.x, uy = p.y - c.y;
            let al = Math.hypot(ux, uy);
            if (al < 0.001) { ux = 1; uy = 0; al = 1; }
            const sep = CONST.PR * 2 + 6;
            const push = Math.max(sep - al, CONST.PR * 1.6);
            movePlayer(p, ux / al * push, uy / al * push);
            if (c.isUser) flashMatch(m, `过掉了 ${p.c.name}！`);
            else if (p.isUser) flashMatch(m, `${c.c.name} 过了你！`);
          } else {
            // 被断：球权易主
            b.carrier = p; b.team = p.team;
            if (c.isUser) flashMatch(m, `被 ${p.c.name} 断了！`);
            else if (p.isUser) { flashMatch(m, `你断下了 ${c.c.name} 的球！`); m.stats.userTackles++; }
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
    // 球门（已加宽）
    ctx.fillStyle = '#1d3a5c';
    ctx.fillRect(0, CONST.GM_T, CONST.GX_L, CONST.GM_B - CONST.GM_T);
    ctx.fillRect(CONST.GX_R, CONST.GM_T, CONST.MW - CONST.GX_R, CONST.GM_B - CONST.GM_T);
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2;
    ctx.strokeRect(1, CONST.GM_T, CONST.GX_L - 1, CONST.GM_B - CONST.GM_T);
    ctx.strokeRect(CONST.GX_R, CONST.GM_T, CONST.MW - CONST.GX_R - 1, CONST.GM_B - CONST.GM_T);

    // 门将持球时画出回避圈
    if (m.gkHold) {
      const gk = m.gkHold.gk;
      ctx.beginPath(); ctx.arc(gk.x, gk.y, CONST.GK_SAFE_R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,215,106,0.45)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,215,106,0.9)'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${gk.c.name} 持球 · 抢不到`, gk.x, gk.y + CONST.GK_SAFE_R + 13);
    }

    // 球员（全员显示名字）
    m.players.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONST.PR, 0, Math.PI * 2);
      ctx.fillStyle = p.team === 'home' ? '#3d7bd6' : '#d6574f';
      ctx.fill();
      if (p.isGK) { ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 2; ctx.stroke(); }
      if (p.isUser) {
        ctx.beginPath(); ctx.arc(p.x, p.y, CONST.PR + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
      }
      // 名字：贴近上栏杆时改画到下方，避免被裁掉
      const above = p.y - CONST.PR - 6;
      const nameY = above < 10 ? p.y + CONST.PR + 12 : above;
      ctx.font = (p.isUser ? 'bold 10px sans-serif' : '9px sans-serif');
      ctx.textAlign = 'center';
      ctx.fillStyle = p.isUser ? '#ffffff' : 'rgba(232,238,252,0.8)';
      ctx.fillText(p.c.name + (p.isGK ? '🧤' : ''), p.x, nameY);
    });

    // 瓶子（大脚飞行时画抛物线高度与影子）
    const airH = b.air ? Math.sin(Math.min(b.air.t, 1) * Math.PI) * 30 : 0;
    if (airH > 0.5) {
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 5, CONST.BR * 0.95, CONST.BR * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(b.x, b.y - airH, CONST.BR + airH * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd76a'; ctx.fill();
    ctx.strokeStyle = '#8a6a1f'; ctx.lineWidth = 1.5; ctx.stroke();
    if (b.air) {
      ctx.fillStyle = 'rgba(255,215,106,0.85)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('空中 · 抢不到', b.x, b.y - airH - 12);
    }

    // 提示文字
    if (m.flashT > 0 && m.flash) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(m.flash, CONST.MW / 2, 28);
    }
  }

  // ------------------------------------------------------------
  // start(cfg) 启动一场比赛
  // cfg: { canvas, scoreEl, timeEl, chars, meId, seconds, onEnd }
  //   onEnd(result): result = { scoreH, scoreA, win, draw, me, goals, stats }
  // 返回 { stop(), state }
  // ------------------------------------------------------------
  function start(cfg) {
    const ctx = cfg.canvas.getContext('2d');
    const teams = buildTeams(cfg.chars, cfg.meId);
    const m = {
      me: teams.me, home: teams.home, away: teams.away,
      scoreH: 0, scoreA: 0, players: [], ball: null,
      left: cfg.seconds * 1000, over: false, flash: '', flashT: 0,
      gkHold: null,
      triedUser: {},                                   // 整场记忆：谁已经试过断用户
      stats: { passes: 0, saves: 0, punts: 0, tacklesOnUser: 0, userTackles: 0 }
    };
    m.home.concat(m.away).forEach(c => { m.triedUser[c.id] = false; });

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
        me: m.me, goals: m.scoreH, stats: m.stats
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
