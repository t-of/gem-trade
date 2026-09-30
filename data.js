'use strict';

// スプレンダー風のカード・貴族のデータ。
//
// 発展カード 90 枚と貴族 10 枚は公式と同じ中身。値段は 白・青・緑・赤・黒 の順。
const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const COLOR_LABEL = { white: '白', blue: '青', green: '緑', red: '赤', black: '黒', gold: '金' };

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

const CARDS = CARD_TABLE.trim().split(/[|\n]/).map((row, i) => {
  const [level, bonus, points, ...nums] = row.trim().split(' ');
  const cost = {};
  nums.forEach((n, k) => { if (+n) cost[COLORS[k]] = +n; });
  return { id: `c${i}`, level: +level, bonus, points: +points, cost };
});

// 貴族 10 枚（公式）: 輪で隣り合う 2 色を 4 枚ずつが 5 枚、続く 3 色を 3 枚ずつが 5 枚。どれも 3 点。
const NOBLES = [];
for (let i = 0; i < COLORS.length; i++) {
  const c = (k) => COLORS[(i + k) % COLORS.length];
  NOBLES.push({ id: `n${NOBLES.length}`, points: 3, req: { [c(0)]: 4, [c(1)]: 4 } });
  NOBLES.push({ id: `n${NOBLES.length}`, points: 3, req: { [c(0)]: 3, [c(1)]: 3, [c(2)]: 3 } });
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
