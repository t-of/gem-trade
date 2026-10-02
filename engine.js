'use strict';
// gem-trade のルールをまとめた純粋な関数群（画面・音・localStorage に触らない）。
// ブラウザ（main.js・worker.js が import）と Node（tools/arena.mjs・test.mjs が import）の両方から使う。
// state はいつも JSON にできる素のオブジェクト。apply() は state を書き換えず、新しい state を返す
// （ISMCTS が同じ手番から何度も試すのに、複製してから渡せば元の state を壊さずにすむ）。

// ---- カード・貴族のデータ（スプレンダー風。発展カード90枚・貴族10枚は公式と同じ中身） ----
export const COLORS = ['white', 'blue', 'green', 'red', 'black'];
export const COLOR_LABEL = { white: '白', blue: '青', green: '緑', red: '赤', black: '黒', gold: '金' };

// [レベル, ボーナス色, 点数, 白, 青, 緑, 赤, 黒]
const CARD_TABLE = `
1 black 0 1 1 1 1 0|1 black 0 1 2 1 1 0|1 black 0 2 2 0 1 0|1 black 0 0 0 1 3 1|1 black 0 0 0 2 1 0|1 black 0 2 0 2 0 0|1 black 0 0 0 3 0 0|1 black 1 0 4 0 0 0
1 blue 0 1 0 1 1 1|1 blue 0 1 0 1 2 1|1 blue 0 1 0 2 2 0|1 blue 0 0 1 3 1 0|1 blue 0 1 0 0 0 2|1 blue 0 0 0 2 0 2|1 blue 0 0 0 0 0 3|1 blue 1 0 0 0 4 0
1 white 0 0 1 1 1 1|1 white 0 0 1 2 1 1|1 white 0 0 2 2 0 1|1 white 0 3 1 0 0 1|1 white 0 0 0 0 2 1|1 white 0 0 2 0 0 2|1 white 0 0 3 0 0 0|1 white 1 0 0 4 0 0
1 green 0 1 1 0 1 1|1 green 0 1 1 0 1 2|1 green 0 0 1 0 2 2|1 green 0 1 3 1 0 0|1 green 0 2 1 0 0 0|1 green 0 0 2 0 2 0|1 green 0 0 0 0 3 0|1 green 1 0 0 0 0 4
1 red 0 1 1 1 0 1|1 red 0 2 1 1 0 1|1 red 0 2 0 1 0 2|1 red 0 1 0 0 1 3|1 red 0 0 2 1 0 0|1 red 0 2 0 0 2 0|1 red 0 3 0 0 0 0|1 red 1 4 0 0 0 0
2 black 1 3 2 2 0 0|2 black 1 3 0 3 0 2|2 black 2 0 1 4 2 0|2 black 2 0 0 5 3 0|2 black 2 5 0 0 0 0|2 black 3 0 0 0 0 6
2 blue 1 0 2 2 3 0|2 blue 1 0 2 3 0 3|2 blue 2 5 3 0 0 0|2 blue 2 2 0 0 1 4|2 blue 2 0 5 0 0 0|2 blue 3 0 6 0 0 0
2 white 1 0 0 3 2 2|2 white 1 2 3 0 3 0|2 white 2 0 0 1 4 2|2 white 2 0 0 0 5 3|2 white 2 0 0 0 5 0|2 white 3 6 0 0 0 0
2 green 1 3 0 2 3 0|2 green 1 2 3 0 0 2|2 green 2 4 2 0 0 1|2 green 2 0 5 3 0 0|2 green 2 0 0 5 0 0|2 green 3 0 0 6 0 0
2 red 1 2 0 0 2 3|2 red 1 0 3 0 2 3|2 red 2 1 4 2 0 0|2 red 2 3 0 0 0 5|2 red 2 0 0 0 0 5|2 red 3 0 0 0 6 0
3 black 3 3 3 5 3 0|3 black 4 0 0 0 7 0|3 black 4 0 0 3 6 3|3 black 5 0 0 0 7 3
3 blue 3 3 0 3 3 5|3 blue 4 7 0 0 0 0|3 blue 4 6 3 0 0 3|3 blue 5 7 3 0 0 0
3 white 3 0 3 3 5 3|3 white 4 0 0 0 0 7|3 white 4 3 0 0 3 6|3 white 5 3 0 0 0 7
3 green 3 5 3 0 3 3|3 green 4 0 7 0 0 0|3 green 4 3 6 3 0 0|3 green 5 0 7 3 0 0
3 red 3 3 5 3 0 3|3 red 4 0 0 7 0 0|3 red 4 0 3 6 3 0|3 red 5 0 0 7 3 0`;

export const CARDS = CARD_TABLE.trim().split(/[|\n]/).map((row, i) => {
  const [level, bonus, points, ...nums] = row.trim().split(' ');
  const cost = {};
  nums.forEach((n, k) => { if (+n) cost[COLORS[k]] = +n; });
  return { id: `c${i}`, level: +level, bonus, points: +points, cost };
});

// 貴族10枚（公式）: 輪で隣り合う2色を4枚ずつが5枚、続く3色を3枚ずつが5枚。どれも3点。
export const NOBLES = [];
for (let i = 0; i < COLORS.length; i++) {
  const c = (k) => COLORS[(i + k) % COLORS.length];
  NOBLES.push({ id: `n${NOBLES.length}`, points: 3, req: { [c(0)]: 4, [c(1)]: 4 } });
  NOBLES.push({ id: `n${NOBLES.length}`, points: 3, req: { [c(0)]: 3, [c(1)]: 3, [c(2)]: 3 } });
}

export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const NOBLE_BY_ID = Object.fromEntries(NOBLES.map((n) => [n.id, n]));

// トークンの枚数（人数ごと）。金はいつも5枚。
export const TOKEN_COUNT_BY_PLAYERS = { 2: 4, 3: 5, 4: 7 };

// ---- 小さな道具 ----
export function emptyTokens() { return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 }; }
export function sumTokens(t) { return COLORS.reduce((s, c) => s + t[c], 0) + t.gold; }
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// state は素のオブジェクトなので JSON の往復で十分に複製できる（関数・循環参照を持たない）
export function clone(state) { return JSON.parse(JSON.stringify(state)); }

// ---- 新しいゲーム ----
export function newGame(numPlayers, numCpu = 0, rng = Math.random) {
  const perColor = TOKEN_COUNT_BY_PLAYERS[numPlayers];
  const bank = emptyTokens();
  for (const c of COLORS) bank[c] = perColor;
  bank.gold = 5;

  const decks = { 1: [], 2: [], 3: [] };
  for (const level of [1, 2, 3]) decks[level] = shuffle(CARDS.filter((c) => c.level === level).map((c) => c.id), rng);
  const board = { 1: [], 2: [], 3: [] };
  for (const level of [1, 2, 3]) for (let i = 0; i < 4; i++) board[level].push(decks[level].pop());

  const nobles = shuffle(NOBLES.map((n) => n.id), rng).slice(0, numPlayers + 1);

  const players = Array.from({ length: numPlayers }, (_, i) => ({
    cpu: i >= numPlayers - numCpu,
    name: i >= numPlayers - numCpu ? `CPU${i - (numPlayers - numCpu) + 1}` : `プレイヤー${i + 1}`,
    tokens: emptyTokens(),
    bonuses: emptyTokens(),
    reserved: [],   // { id, level, hidden }。hidden = 山から伏せて取った（相手には見えない）
    bought: [],
    nobles: [],
    points: 0,
  }));

  return {
    v: 2,
    numPlayers,
    players,
    current: 0,
    bank,
    decks,
    board,
    nobles,
    endAfter: null,     // 誰かが15点に届いたら0（最初の人）。その回の最後の人まで回して終える
    winner: null,
    result: null,
    pendingDiscard: null,  // { need: 戻す枚数 }
    pendingNoble: null,    // 選べる貴族が2枚以上のときの候補id一覧
  };
}

// ---- 値段 ----
export function effectiveCost(card, player) {
  const cost = {};
  for (const c of COLORS) cost[c] = Math.max(0, (card.cost[c] || 0) - player.bonuses[c]);
  return cost;
}
export function canAfford(card, player) {
  const cost = effectiveCost(card, player);
  let goldNeed = 0;
  for (const c of COLORS) goldNeed += Math.max(0, cost[c] - player.tokens[c]);
  return goldNeed <= player.tokens.gold;
}
export function payFor(card, player) {
  const cost = effectiveCost(card, player);
  const paid = emptyTokens();
  let goldNeed = 0;
  for (const c of COLORS) {
    const pay = Math.min(cost[c], player.tokens[c]);
    paid[c] = pay;
    goldNeed += cost[c] - pay;
  }
  paid.gold = goldNeed;
  return paid;
}

// ---- 手番の進行（state を直接書き換える内部関数。apply() の中だけで使う） ----
// 場から取ったカードの場所に山札から補充する（山札が空なら詰める）
function takeFromBoard(s, level, cardId) {
  const idx = s.board[level].indexOf(cardId);
  if (s.decks[level].length) s.board[level][idx] = s.decks[level].pop();
  else s.board[level].splice(idx, 1);
}
function qualifyingNobles(s, player) {
  return s.nobles.filter((id) => {
    const n = NOBLE_BY_ID[id];
    return Object.entries(n.req).every(([c, need]) => player.bonuses[c] >= need);
  });
}
function giveNoble(s, id) {
  const player = s.players[s.current];
  player.points += NOBLE_BY_ID[id].points;
  player.nobles.push(id);
  s.nobles = s.nobles.filter((n) => n !== id);
}
function checkEndCondition(s) {
  const player = s.players[s.current];
  if (player.points >= 15 && s.endAfter === null) s.endAfter = 0;
}
function advanceTurn(s) {
  const next = (s.current + 1) % s.numPlayers;
  if (s.endAfter !== null && next === s.endAfter) { endGame(s); return; }
  s.current = next;
}
function endGame(s) {
  const ranked = s.players
    .map((p, i) => ({ i, p }))
    .sort((a, b) => b.p.points - a.p.points || a.p.bought.length - b.p.bought.length);
  s.result = ranked.map((r) => r.i);
  s.winner = s.result[0];
}
function finishTurn(s) {
  checkEndCondition(s);
  if (!s.result) advanceTurn(s);
  return s;
}
function settleNobleAndAdvance(s) {
  const player = s.players[s.current];
  const q = qualifyingNobles(s, player);
  if (q.length === 1) giveNoble(s, q[0]);
  else if (q.length > 1) { s.pendingNoble = q; return s; }
  return finishTurn(s);
}
function settleAfterMainAction(s) {
  const player = s.players[s.current];
  if (sumTokens(player.tokens) > 10) { s.pendingDiscard = { need: sumTokens(player.tokens) - 10 }; return s; }
  return settleNobleAndAdvance(s);
}

// ---- 合法な手 ----
function combinations3(colors) {
  const out = [];
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++)
      for (let k = j + 1; k < colors.length; k++)
        out.push([colors[i], colors[j], colors[k]]);
  return out;
}
export function legalMoves(s) {
  if (s.result) return [];
  if (s.pendingDiscard) {
    const p = s.players[s.current];
    return [...COLORS, 'gold'].filter((c) => p.tokens[c] > 0).map((c) => ({ type: 'discard', color: c }));
  }
  if (s.pendingNoble) return s.pendingNoble.map((id) => ({ type: 'noble', id }));

  const p = s.players[s.current];
  const moves = [];
  const avail = COLORS.filter((c) => s.bank[c] > 0);
  if (avail.length >= 3) for (const colors of combinations3(avail)) moves.push({ type: 'take', colors });
  else if (avail.length > 0) moves.push({ type: 'take', colors: avail.slice() });
  for (const c of COLORS) if (s.bank[c] >= 4) moves.push({ type: 'take', colors: [c, c] });

  if (p.reserved.length < 3) {
    for (const level of [1, 2, 3]) {
      for (const id of s.board[level]) moves.push({ type: 'reserve', level, cardId: id });
      if (s.decks[level].length) moves.push({ type: 'reserve', level, cardId: null });
    }
  }
  for (const level of [1, 2, 3]) for (const id of s.board[level]) if (canAfford(CARD_BY_ID[id], p)) moves.push({ type: 'buy', cardId: id, fromBoard: level });
  for (const r of p.reserved) if (canAfford(CARD_BY_ID[r.id], p)) moves.push({ type: 'buy', cardId: r.id, fromBoard: null });

  if (!moves.length) moves.push({ type: 'pass' });
  return moves;
}

// ---- 手を進める。state は書き換えず、新しい state を返す ----
export function apply(state, move) {
  const s = clone(state);
  const player = s.players[s.current];
  switch (move.type) {
    case 'take': {
      for (const c of move.colors) { player.tokens[c]++; s.bank[c]--; }
      return settleAfterMainAction(s);
    }
    case 'reserve': {
      let cardId = move.cardId;
      let hidden;
      if (cardId) {
        takeFromBoard(s, move.level, cardId);
        hidden = false;
      } else {
        cardId = s.decks[move.level].pop();
        hidden = true;
      }
      player.reserved.push({ id: cardId, level: move.level, hidden });
      if (s.bank.gold > 0) { player.tokens.gold++; s.bank.gold--; }
      return settleAfterMainAction(s);
    }
    case 'buy': {
      const card = CARD_BY_ID[move.cardId];
      const paid = payFor(card, player);
      for (const c of COLORS) { player.tokens[c] -= paid[c]; s.bank[c] += paid[c]; }
      player.tokens.gold -= paid.gold; s.bank.gold += paid.gold;
      player.bonuses[card.bonus]++;
      player.bought.push(move.cardId);
      player.points += card.points;
      if (move.fromBoard) {
        takeFromBoard(s, move.fromBoard, move.cardId);
      } else {
        player.reserved = player.reserved.filter((r) => r.id !== move.cardId);
      }
      return settleAfterMainAction(s);
    }
    case 'discard': {
      player.tokens[move.color]--; s.bank[move.color]++;
      s.pendingDiscard.need--;
      if (s.pendingDiscard.need <= 0) { s.pendingDiscard = null; return settleNobleAndAdvance(s); }
      return s;
    }
    case 'noble': {
      giveNoble(s, move.id);
      s.pendingNoble = null;
      return finishTurn(s);
    }
    case 'pass': {
      return finishTurn(s);
    }
    default:
      throw new Error(`gem-trade: 未知の手 ${move.type}`);
  }
}

export function isOver(state) { return state.result !== null; }
export function scores(state) { return state.players.map((p) => p.points); }

// ---- 見えない情報 ----
// 「相手に見えないか」を判断する道はここ1か所。山札の並び・相手が伏せて予約したカードの中身を
// 自分（viewer）が知らない前提で、残り90枚から見えたカードを引いた「未知の候補」を返す。
export function unseenCards(state, viewerIdx) {
  const seen = new Set();
  for (const level of [1, 2, 3]) for (const id of state.board[level]) seen.add(id);
  for (const p of state.players) for (const id of p.bought) seen.add(id);
  state.players.forEach((p, i) => {
    for (const r of p.reserved) if (i === viewerIdx || !r.hidden) seen.add(r.id);
  });
  return CARDS.map((c) => c.id).filter((id) => !seen.has(id));
}

// unseenCards() から山札・相手の伏せ予約の中身をくじ引きし直した「ありえる1つの盤面」を作る
// （ISMCTS の決定化）。viewer 自身が知っていることは変えない。
export function determinize(state, viewerIdx, rng = Math.random) {
  const s = clone(state);
  const pools = { 1: [], 2: [], 3: [] };
  for (const id of unseenCards(state, viewerIdx)) pools[CARD_BY_ID[id].level].push(id);
  for (const level of [1, 2, 3]) pools[level] = shuffle(pools[level], rng);
  for (const level of [1, 2, 3]) s.decks[level] = pools[level].splice(0, s.decks[level].length);
  s.players.forEach((p, i) => {
    if (i === viewerIdx) return;
    p.reserved = p.reserved.map((r) => (r.hidden ? { ...r, id: pools[r.level].pop() } : r));
  });
  return s;
}
