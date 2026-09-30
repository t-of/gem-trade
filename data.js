'use strict';

// スプレンダー風のカード・貴族のデータ。
//
// 発展カード 90 枚（レベル1: 40枚、レベル2: 30枚、レベル3: 20枚）は、
// 色ごとに同じ「型」を回して作る（本家もボーナス色を回転させて色ごとの枚数をそろえている）。
// ponytail: 値段・点数の細かい数値は公式資料を見ずに記憶から再現した近似値。
// 枚数（40/30/20、色ごとの枚数）は仕様どおりに固定してある。正確な値を使いたければ
// 公式のカードを見て TEMPLATES を差し替える。
const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const COLOR_LABEL = { white: '白', blue: '青', green: '緑', red: '赤', black: '黒', gold: '金' };

// offset (1〜4) はボーナス色から色の輪（COLORS の並び）で何番目の色かを表す。
function costFromOffsets(bonusIndex, offsets) {
  const cost = {};
  for (const [off, n] of Object.entries(offsets)) {
    const idx = (bonusIndex + Number(off)) % COLORS.length;
    cost[COLORS[idx]] = n;
  }
  return cost;
}

const LEVEL1_TEMPLATES = [
  [{ 1: 1, 2: 1, 3: 1, 4: 1 }, 0],
  [{ 1: 1, 2: 2, 3: 1, 4: 1 }, 0],
  [{ 2: 2, 3: 2, 4: 1 }, 0],
  [{ 1: 2, 3: 2, 4: 1 }, 0],
  [{ 1: 3, 2: 1 }, 0],
  [{ 3: 1, 4: 4 }, 0],
  [{ 1: 4 }, 0],
  [{ 2: 3, 4: 2 }, 1],
];
const LEVEL2_TEMPLATES = [
  [{ 1: 2, 2: 3 }, 1],
  [{ 2: 1, 3: 4, 4: 2 }, 1],
  [{ 1: 5 }, 2],
  [{ 1: 3, 3: 3, 4: 2 }, 2],
  [{ 2: 5 }, 2],
  [{ 3: 6 }, 3],
];
const LEVEL3_TEMPLATES = [
  [{ 1: 3, 2: 3, 3: 5 }, 3],
  [{ 2: 7 }, 4],
  [{ 1: 3, 3: 6, 4: 3 }, 4],
  [{ 4: 7 }, 5],
];

function buildLevel(level, templates) {
  const cards = [];
  let n = 0;
  for (let bonusIndex = 0; bonusIndex < COLORS.length; bonusIndex++) {
    const bonus = COLORS[bonusIndex];
    for (const [offsets, points] of templates) {
      cards.push({ id: `l${level}-${n++}`, level, bonus, points, cost: costFromOffsets(bonusIndex, offsets) });
    }
  }
  return cards;
}

const CARDS = [
  ...buildLevel(1, LEVEL1_TEMPLATES),
  ...buildLevel(2, LEVEL2_TEMPLATES),
  ...buildLevel(3, LEVEL3_TEMPLATES),
];

// 貴族 10 枚: 5 色から 3 色を選ぶ組み合わせ（ちょうど 10 通り）。どれも 3 点、各色 3 枚。
const NOBLES = [];
for (let a = 0; a < COLORS.length; a++) {
  for (let b = a + 1; b < COLORS.length; b++) {
    for (let c = b + 1; c < COLORS.length; c++) {
      const req = {};
      req[COLORS[a]] = 3; req[COLORS[b]] = 3; req[COLORS[c]] = 3;
      NOBLES.push({ id: `n${NOBLES.length}`, points: 3, req });
    }
  }
}

// ---- 枚数の検算（RULES.md どおり: 40/30/20、色ごと 8/6/4、貴族 10） ----
console.assert(CARDS.filter((c) => c.level === 1).length === 40, 'レベル1は40枚');
console.assert(CARDS.filter((c) => c.level === 2).length === 30, 'レベル2は30枚');
console.assert(CARDS.filter((c) => c.level === 3).length === 20, 'レベル3は20枚');
for (const color of COLORS) {
  console.assert(CARDS.filter((c) => c.level === 1 && c.bonus === color).length === 8, `レベル1 ${color} は8枚`);
  console.assert(CARDS.filter((c) => c.level === 2 && c.bonus === color).length === 6, `レベル2 ${color} は6枚`);
  console.assert(CARDS.filter((c) => c.level === 3 && c.bonus === color).length === 4, `レベル3 ${color} は4枚`);
}
console.assert(NOBLES.length === 10, '貴族は10枚');

// トークンの枚数（人数ごと）。金はいつも5枚。
const TOKEN_COUNT_BY_PLAYERS = { 2: 4, 3: 5, 4: 7 };

window.GEM_TRADE_DATA = { COLORS, COLOR_LABEL, CARDS, NOBLES, TOKEN_COUNT_BY_PLAYERS };
