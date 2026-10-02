'use strict';
// gem-trade の CPU（画面・localStorage に触らない。engine.js の上に乗るだけ）。
//
// simpleMove  — 先読みなしの雑な CPU（今までどおり。3〜4人戦・CPUだけのモードで使う対戦相手）。
// evaluate    — 盤面の点数づけ（自分 - 相手の値）。重みは自己対戦で決めた目安値。
// ismctsMove  — 2人戦（人 vs CPU）用。unseenCards からくじ引きした盤面で先を読み、evaluate で手を選ぶ。

import {
  COLORS, CARD_BY_ID, NOBLE_BY_ID, emptyTokens, sumTokens,
  effectiveCost, canAfford, legalMoves, apply, isOver, determinize,
} from './engine.js';

// ---------- 雑なCPU（先読みなし） ----------
function cpuMissing(card, p) {
  const cost = effectiveCost(card, p);
  return COLORS.reduce((sum, c) => sum + Math.max(0, cost[c] - p.tokens[c]), 0) - p.tokens.gold;
}
function cpuCandidates(s, p) {
  const board = [1, 2, 3].flatMap((lv) => s.board[lv].map((id) => ({ id, lv })));
  return [...board, ...p.reserved.map((r) => ({ id: r.id, lv: null }))];
}
function cpuTarget(s, p) {
  const score = (x) => cpuMissing(CARD_BY_ID[x.id], p) - CARD_BY_ID[x.id].points;
  return cpuCandidates(s, p).sort((a, b) => score(a) - score(b))[0];
}
export function simpleMove(s) {
  const moves = legalMoves(s);
  if (moves.length === 1) return moves[0];
  const p = s.players[s.current];
  if (s.pendingNoble) return moves[0];
  if (s.pendingDiscard) {
    const t = cpuTarget(s, p);
    const cost = t ? effectiveCost(CARD_BY_ID[t.id], p) : emptyTokens();
    const spare = (c) => p.tokens[c] - (cost[c] || 0);
    return moves.filter((m) => m.type === 'discard').sort((a, b) => spare(b.color) - spare(a.color))[0];
  }
  const buyMoves = moves.filter((m) => m.type === 'buy');
  if (buyMoves.length) return buyMoves.sort((a, b) => CARD_BY_ID[b.cardId].points - CARD_BY_ID[a.cardId].points)[0];
  const t = cpuTarget(s, p);
  const availColors = COLORS.filter((c) => s.bank[c] > 0);
  const reserveMoves = moves.filter((m) => m.type === 'reserve');
  if ((sumTokens(p.tokens) >= 9 || !availColors.length) && reserveMoves.length) {
    const targetReserve = t && t.lv ? reserveMoves.find((m) => m.cardId === t.id) : null;
    return targetReserve || reserveMoves[0];
  }
  const takeMoves = moves.filter((m) => m.type === 'take');
  if (takeMoves.length) {
    const cost = t ? effectiveCost(CARD_BY_ID[t.id], p) : emptyTokens();
    const need = (c) => (cost[c] || 0) - p.tokens[c];
    const score = (m) => m.colors.reduce((sum, c) => sum + need(c), 0);
    return takeMoves.sort((a, b) => score(b) - score(a))[0];
  }
  return moves[0];
}

// ---------- 評価関数 ----------
// 1人分の「強さ」。点数・永続する割引(bonuses)・トークン・貴族への近さ・買えそうなカードの近さを足す。
// 重みは自己対戦（tools/arena.mjs）で雑に調整した目安値。厳密な最適化はしていない。
function playerValue(s, idx) {
  const p = s.players[idx];
  let v = p.points * 4;
  for (const c of COLORS) v += p.bonuses[c];
  const tokenTotal = sumTokens(p.tokens);
  v += Math.min(tokenTotal, 8) * 0.2 - Math.max(0, tokenTotal - 8) * 0.3;
  for (const nid of s.nobles) {
    const n = NOBLE_BY_ID[nid];
    const need = COLORS.reduce((sum, c) => sum + Math.max(0, (n.req[c] || 0) - p.bonuses[c]), 0);
    v += Math.max(0, 4 - need) * 0.5;
  }
  const candidates = [1, 2, 3].flatMap((lv) => s.board[lv].map((id) => CARD_BY_ID[id])).concat(p.reserved.map((r) => CARD_BY_ID[r.id]));
  let bestReach = Infinity;
  for (const card of candidates) {
    const reach = cpuMissing(card, p) - card.points * 0.5;
    if (reach < bestReach) bestReach = reach;
  }
  if (bestReach !== Infinity) v -= Math.max(0, bestReach) * 0.3;
  return v;
}
// 2人以上のどの人数でも使える: viewer 自身の値 - ほかの人の平均値
export function evaluate(s, viewerIdx) {
  const self = playerValue(s, viewerIdx);
  const others = s.players.map((_, i) => i).filter((i) => i !== viewerIdx);
  if (!others.length) return self;
  return self - others.reduce((sum, i) => sum + playerValue(s, i), 0) / others.length;
}

// ---------- ISMCTS ----------
// ponytail: 正式なISMCTS木（UCBで分岐を共有しノードを使い回す）ではなく、根の手だけをUCB1で選び、
// 毎回 determinize し直して数手の評価関数プレイアウトで採点する簡易版（flat MC + determinization）。
// 2人戦の思考2秒ぶんには足りる強さが出ている（tools/arena.mjs で確認）。木を共有したくなったら、
// 手の列をキーにノードを持つ本式のISMCTSに置き換える。
function greedyMove(s, rng) {
  const moves = legalMoves(s);
  if (moves.length === 1) return moves[0];
  const viewer = s.current;
  let best = -Infinity, bestM = moves[0];
  for (const m of moves) {
    const sc = evaluate(apply(s, m), viewer);
    if (sc > best) { best = sc; bestM = m; }
  }
  return bestM;
}
function rollout(s, viewerIdx, depth, rng) {
  let cur = s;
  for (let i = 0; i < depth && !isOver(cur); i++) cur = apply(cur, greedyMove(cur, rng));
  return evaluate(cur, viewerIdx);
}
export function ismctsMove(state, viewerIdx, opts = {}) {
  const { timeLimitMs = 2000, maxIters = Infinity, rolloutDepth = 6, rng = Math.random } = opts;
  const moves = legalMoves(state);
  if (moves.length <= 1) return moves[0];
  const stats = moves.map(() => ({ n: 0, total: 0 }));
  const totalN = () => stats.reduce((sum, x) => sum + x.n, 0);
  const start = Date.now();
  let iters = 0;
  while (iters < maxIters && (maxIters !== Infinity || Date.now() - start < timeLimitMs)) {
    iters++;
    let mi = stats.findIndex((x) => x.n === 0);
    if (mi === -1) {
      let best = -Infinity;
      const logN = Math.log(totalN());
      stats.forEach((x, i) => {
        const ucb = x.total / x.n + Math.SQRT2 * Math.sqrt(logN / x.n);
        if (ucb > best) { best = ucb; mi = i; }
      });
    }
    const d = determinize(state, viewerIdx, rng);
    const s1 = apply(d, moves[mi]);
    stats[mi].n++;
    stats[mi].total += rollout(s1, viewerIdx, rolloutDepth, rng);
    if (maxIters === Infinity && Date.now() - start >= timeLimitMs) break;
  }
  let best = -Infinity, bestI = 0;
  stats.forEach((x, i) => { const avg = x.n ? x.total / x.n : -Infinity; if (avg > best) { best = avg; bestI = i; } });
  return moves[bestI];
}
