'use strict';
// 2人戦のCPU（ISMCTS）を別スレッドで回す。画面は { state, viewerIdx, opts } を送り、{ move } を受け取る。
// 重い探索をここに閉じ込めるので、2秒待つあいだも画面は固まらない。
import { ismctsMove } from './cpu.js';

self.onmessage = (e) => {
  const { id, state, viewerIdx, opts } = e.data;
  let move = null;
  try { move = ismctsMove(state, viewerIdx, opts); } catch { move = null; }
  self.postMessage({ id, move });
};
