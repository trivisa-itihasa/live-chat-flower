// ==UserScript==
// @name         Live Chat Flower
// @namespace    live-chat-flower
// @version      1.0.0
// @description  ライブ配信のチャットをニコニコ動画のように映像の上へ流します（対応: Twitch）
// @match        https://www.twitch.tv/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  /* ===========================================================================
   * 1. 設定
   * ======================================================================== */

  const CONFIG = {
    /* ---------- 見た目 ---------- */

    // コメントの不透明度（0.0 = 完全に透明 〜 1.0 = 不透明）
    OPACITY: 0.8,
    // フォント（CSS の font-family と同じ書式）
    FONT_FAMILY: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, "Noto Sans JP", sans-serif',
    // 文字の太さ（'normal' / 'bold' / 100〜900）
    FONT_WEIGHT: '600',
    // コメントの大きさ: 映像の高さを何行に分けるか（大きいほど文字が小さくなる）
    LINES: 12,
    // 1行の高さに対する文字サイズの割合（1.0 で行間なし）
    FONT_SIZE_RATIO: 0.8,
    // 文字色
    TEXT_COLOR: '#ffffff',
    // true: チャットのユーザー名の色でコメントを表示（色を設定していないユーザーは TEXT_COLOR）
    USE_USER_COLOR: false,
    // 縁取りの色
    OUTLINE_COLOR: 'rgba(0, 0, 0, 0.5)',
    // 縁取りの太さ（文字サイズに対する割合。0 で縁取りなし）
    OUTLINE_WIDTH: 0.04,
    // コメントの先頭に投稿者名を表示する
    SHOW_AUTHOR_NAME: false,
    // エモートを画像で表示する（false: エモート名をテキストで表示）
    SHOW_EMOTES: true,

    /* ---------- 流れ方 ---------- */

    // コメントが画面の右端から左端まで流れきるまでの秒数（小さいほど速い）
    DURATION_SEC: 5,
    // 'nico'     : どのコメントも DURATION_SEC 秒で流れきる（長いコメントほど速い。ニコニコ動画と同じ方式）
    // 'constant' : すべてのコメントが同じ速さで流れる（長いコメントほど表示時間が長い）
    SPEED_MODE: 'nico',
    // 映像の上から何割の範囲にコメントを流すか（1.0 = 全体、0.5 = 上半分）
    DISPLAY_AREA: 1.0,
    // true: 黒帯を除いた映像部分にだけコメントを流す / false: プレイヤー全体に流す
    FIT_TO_VIDEO: true,
    // 同時に表示するコメント数の上限（超えた分は表示しない）
    MAX_ON_SCREEN: 100,
    // 空いている行がないとき: 'overlap' = いちばん空きに近い行に重ねて流す / 'drop' = 表示しない
    WHEN_FULL: 'overlap',

    /* ---------- フィルタ ---------- */

    // これより長いコメントは切り詰める（エモートは1文字として数える。0 で無制限）
    MAX_LENGTH: 50,
    // '!' で始まるボットコマンドを流さない
    IGNORE_COMMANDS: true,
    // NG ワード: 文字列（部分一致・大文字小文字を区別しない）または正規表現
    NG_WORDS: [
      // 'ネタバレ',
      // /https?:\/\//i,
    ],
    // NG ユーザー（ログイン名または表示名。大文字小文字を区別しない）
    NG_USERS: ['nightbot', 'streamelements', 'moobot', 'fossabot', 'streamlabs', 'wizebot'],
    // モデレーターが削除したコメントや BAN されたユーザーのコメントを画面から消す
    REMOVE_DELETED: true,

    /* ---------- 操作 ---------- */

    // 表示 / 非表示を切り替えるキー（例: 'Alt+C', 'Ctrl+Shift+K'。'' で無効）
    TOGGLE_HOTKEY: 'Alt+C',
    // 読み込み時にコメントを表示するか
    START_VISIBLE: true,

    /* ---------- プラットフォーム固有 ---------- */

    TWITCH: {
      // サブスク継続・アナウンスなどに添えられたメッセージも流す
      SHOW_USERNOTICE_MESSAGES: true,
    },

    // 動作ログをコンソールに出す
    DEBUG: false,
  };

  // 内部定数（通常は変更不要）
  const STYLE_ID = 'lcf-style';
  const LANE_GAP_EM = 0.5;          // 同じ行を流れるコメント同士の最小間隔（文字サイズ比）
  const EMOTE_SIZE_EM = 1.1;        // エモート画像の高さ（文字サイズ比）
  const TICK_MS = 1000;             // ページ状態（URL・プレイヤー）の確認間隔
  const PLAYER_LOST_GRACE_TICKS = 5; // プレイヤーがこの回数続けて見つからなければ接続を切る

  const log = (...args) => {
    if (CONFIG.DEBUG) console.log('[LiveChatFlower]', ...args);
  };

  /* ===========================================================================
   * 2. 共通: データ形式とインターフェース
   *
   * コメント取得部分（プラットフォーム別）と描画部分（共通）は、以下の型だけで
   * やり取りします。描画側はどのプラットフォームのコメントかを一切知りません。
   * ======================================================================== */

  /**
   * 画面に流すコメント1件
   * @typedef {Object} FlowComment
   * @property {string} id            メッセージ ID（削除の反映に使用。無ければ ''）
   * @property {string} text          本文のプレーンテキスト（フィルタ用。エモートはその名前で含める）
   * @property {CommentPart[]} parts  表示用に分割した本文
   * @property {Author} author
   *
   * @typedef {{type: 'text', text: string}
   *         | {type: 'emote', alt: string, url: string, srcset?: string}} CommentPart
   *   srcset は幅記述子（'a.png 28w, b.png 56w'）で指定すると、表示サイズに合う解像度が選ばれる
   *
   * @typedef {Object} Author
   * @property {string} id     ユーザー ID（削除の反映に使用。無ければ ''）
   * @property {string} login  ログイン名
   * @property {string} name   表示名
   * @property {string} color  ユーザー名の色（CSS の色。無ければ ''）
   *
   * 画面から消すコメントの指定（いずれか1つ）
   * @typedef {{id: string} | {authorId: string} | {all: true}} DeleteTarget
   */

  /**
   * コメント取得部分（プラットフォームごとに実装）
   * @typedef {Object} CommentSource
   * @property {() => void} start  接続を開始する（切断されたら自動で再接続する）
   * @property {() => void} stop   接続を終了する
   *
   * @typedef {Object} SourceHandlers
   * @property {(comment: FlowComment) => void} onComment
   * @property {(target: DeleteTarget) => void} onDelete
   */

  /**
   * プラットフォームアダプタ（プラットフォームごとに実装）
   * @typedef {Object} PlatformAdapter
   * @property {string} name
   * @property {(loc: Location) => boolean} matches           このページを担当するか
   * @property {(loc: Location) => string|null} getStreamKey  視聴中の配信を表すキー（変わると接続し直す）
   * @property {() => PlayerInfo|null} findPlayer             コメントを重ねる動画
   * @property {(key: string, handlers: SourceHandlers) => CommentSource} createSource
   *
   * @typedef {Object} PlayerInfo
   * @property {HTMLVideoElement} video
   * @property {Element} [parent]    コメントレイヤーを挿入する親要素（省略時: video の親）
   * @property {Node|null} [before]  この要素の直前に挿入（省略時: video の直後。null で末尾）
   */

  /* ===========================================================================
   * 3. 共通: ユーティリティ
   * ======================================================================== */

  /** 表示されている動画のうち最も大きいものを返す */
  function findLargestVideo(videos, minArea = 160 * 90) {
    let best = null;
    let bestArea = minArea;
    for (const video of videos) {
      const r = video.getBoundingClientRect();
      const area = r.width * r.height;
      if (area >= bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return best;
  }

  function parseHotkey(spec) {
    if (!spec) return null;
    const keys = spec.split('+').map(s => s.trim().toLowerCase());
    return {
      key: keys.pop(),
      alt: keys.includes('alt'),
      ctrl: keys.includes('ctrl') || keys.includes('control'),
      shift: keys.includes('shift'),
      meta: keys.includes('meta') || keys.includes('cmd'),
    };
  }

  function matchesHotkey(e, hk) {
    if (e.altKey !== hk.alt || e.ctrlKey !== hk.ctrl || e.shiftKey !== hk.shift || e.metaKey !== hk.meta) {
      return false;
    }
    // Alt や Shift で e.key が変わるキーボードがあるため、英数字は物理キーで判定する
    if (/^[a-z]$/.test(hk.key)) return e.code === `Key${hk.key.toUpperCase()}`;
    if (/^[0-9]$/.test(hk.key)) return e.code === `Digit${hk.key}`;
    return e.key.toLowerCase() === hk.key;
  }

  function isTypingTarget(el) {
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function installHotkey(spec, callback) {
    const hk = parseHotkey(spec);
    if (!hk) return;
    document.addEventListener('keydown', e => {
      if (!matchesHotkey(e, hk) || isTypingTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      callback();
    }, true);
  }

  /* ===========================================================================
   * 4. 共通: フィルタ
   * ======================================================================== */

  /** @returns {(c: FlowComment) => boolean} 流してよいコメントなら true */
  function createCommentFilter(config) {
    const ngUsers = new Set(config.NG_USERS.map(u => u.toLowerCase()));
    const ngWords = config.NG_WORDS.map(w =>
      w instanceof RegExp ? new RegExp(w.source, w.flags.replace(/[gy]/g, '')) : String(w).toLowerCase());

    return comment => {
      const text = comment.text.trim();
      if (!text) return false;
      if (config.IGNORE_COMMANDS && /^[!！]/.test(text)) return false;

      const { login, name } = comment.author;
      if (ngUsers.has(login.toLowerCase()) || ngUsers.has(name.toLowerCase())) return false;

      const lower = text.toLowerCase();
      return !ngWords.some(w => (typeof w === 'string' ? lower.includes(w) : w.test(text)));
    };
  }

  /** 本文を max 文字（エモートは1文字）までに切り詰める */
  function truncateParts(parts, max) {
    if (!(max > 0)) return parts;
    const result = [];
    let remain = max;
    for (const part of parts) {
      const chars = part.type === 'text' ? Array.from(part.text) : null;
      const length = chars ? chars.length : 1;
      if (length <= remain) {
        result.push(part);
        remain -= length;
        continue;
      }
      if (chars && remain > 0) result.push({ type: 'text', text: chars.slice(0, remain).join('') });
      result.push({ type: 'text', text: '…' });
      break;
    }
    return result;
  }

  /* ===========================================================================
   * 5. 共通: 描画（コメントを流す部分）
   * ======================================================================== */

  function injectStyle(config) {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .lcf-layer {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }
      .lcf-stage {
        position: absolute;
        overflow: hidden;
        opacity: ${config.OPACITY};
      }
      .lcf-comment {
        position: absolute;
        top: 0;
        left: 0;
        width: max-content;
        margin: 0;
        padding: 0;
        white-space: pre;
        font-family: ${config.FONT_FAMILY};
        font-weight: ${config.FONT_WEIGHT};
        font-style: normal;
        font-size: var(--lcf-font-size);
        line-height: var(--lcf-line-height);
        letter-spacing: normal;
        text-align: left;
        color: ${config.TEXT_COLOR};
        text-shadow: var(--lcf-shadow);
        will-change: transform;
        user-select: none;
      }
      .lcf-author {
        margin-right: 0.4em;
        font-size: 0.6em;
        opacity: 0.85;
      }
      .lcf-emote {
        height: ${EMOTE_SIZE_EM}em;
        width: auto;
        max-width: none;
        aspect-ratio: auto 1 / 1; /* 読み込み前は正方形として幅を確保する */
        margin: 0 0.05em;
        vertical-align: -0.25em;
      }
      .lcf-toast {
        position: absolute;
        top: 12px;
        left: 12px;
        padding: 4px 10px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        font: bold 14px sans-serif;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function buildOutline(width, color) {
    if (!(width > 0)) return 'none';
    const w = Math.max(1, Math.round(width * 10) / 10);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    return dirs.map(([dx, dy]) => `${dx * w}px ${dy * w}px 0 ${color}`).join(', ');
  }

  /**
   * 動画の上にコメントレイヤーを重ね、FlowComment を右から左へ流す。
   * プラットフォームには依存しない。
   */
  class FlowRenderer {
    constructor(config) {
      this.config = config;
      this.visible = config.START_VISIBLE;
      this.video = null;
      this.layer = null;
      this.stage = null;
      this.rect = null;    // コメントを流す領域（layer 基準）
      this.geom = null;    // 行の高さ・文字サイズなど
      this.lanes = [];     // 行ごとの最後に流したコメント
      this.items = new Set();
      this.resizeObserver = null;
      this.layout = this.layout.bind(this);
    }

    isMountedOn(video) {
      return this.video === video && !!this.layer && this.layer.isConnected;
    }

    /** @param {PlayerInfo} player */
    mount(player) {
      this.unmount();
      injectStyle(this.config);

      const { video } = player;
      const parent = player.parent || video.parentElement;
      const before = player.before !== undefined
        ? player.before
        : (parent === video.parentElement ? video.nextSibling : null);

      const layer = document.createElement('div');
      layer.className = 'lcf-layer';
      const stage = document.createElement('div');
      stage.className = 'lcf-stage';
      stage.style.display = this.visible ? '' : 'none';
      layer.append(stage);
      parent.insertBefore(layer, before);

      this.video = video;
      this.layer = layer;
      this.stage = stage;
      this.resizeObserver = new ResizeObserver(this.layout);
      this.resizeObserver.observe(layer);
      this.resizeObserver.observe(video);
      video.addEventListener('resize', this.layout); // 映像の解像度が変わったとき
      this.layout();
      log('mounted', video);
    }

    unmount() {
      if (!this.layer) return;
      this.resizeObserver.disconnect();
      this.video.removeEventListener('resize', this.layout);
      this.clear();
      this.layer.remove();
      this.video = this.layer = this.stage = this.rect = this.geom = this.resizeObserver = null;
      log('unmounted');
    }

    computeStageRect() {
      const lr = this.layer.getBoundingClientRect();
      let x = 0;
      let y = 0;
      let w = lr.width;
      let h = lr.height;
      if (this.config.FIT_TO_VIDEO) {
        const vr = this.video.getBoundingClientRect();
        if (vr.width > 0 && vr.height > 0) {
          x = vr.left - lr.left;
          y = vr.top - lr.top;
          w = vr.width;
          h = vr.height;
        }
        // <video> は縦横比を保って表示されるので、黒帯を除いた部分を求める
        const { videoWidth: vw, videoHeight: vh } = this.video;
        if (vw > 0 && vh > 0) {
          const scale = Math.min(w / vw, h / vh);
          x += (w - vw * scale) / 2;
          y += (h - vh * scale) / 2;
          w = vw * scale;
          h = vh * scale;
        }
      }
      return { x, y, w, h };
    }

    /** コメントを流す領域の大きさを確認し、変わっていれば行の高さや文字サイズを計算し直す */
    layout() {
      if (!this.layer || !this.layer.isConnected) return;
      const rect = this.computeStageRect();
      const prev = this.rect;
      if (prev && ['x', 'y', 'w', 'h'].every(k => Math.abs(prev[k] - rect[k]) < 0.5)) return;

      // サイズが変わると流れている途中のコメントの位置関係が崩れるので、いったん消す
      this.clear();
      this.rect = rect;
      if (rect.w < 1 || rect.h < 1) {
        this.geom = null;
        return;
      }

      const { LINES, FONT_SIZE_RATIO, DISPLAY_AREA, OUTLINE_WIDTH, OUTLINE_COLOR } = this.config;
      const lineHeight = rect.h / LINES;
      const fontSize = lineHeight * FONT_SIZE_RATIO;
      const laneCount = Math.max(1, Math.floor(LINES * DISPLAY_AREA + 1e-6));
      this.geom = { width: rect.w, lineHeight, fontSize, gap: fontSize * LANE_GAP_EM };
      this.lanes = new Array(laneCount).fill(null);

      const s = this.stage.style;
      s.left = `${rect.x}px`;
      s.top = `${rect.y}px`;
      s.width = `${rect.w}px`;
      s.height = `${rect.h}px`;
      s.setProperty('--lcf-font-size', `${fontSize}px`);
      s.setProperty('--lcf-line-height', `${lineHeight}px`);
      s.setProperty('--lcf-shadow', buildOutline(fontSize * OUTLINE_WIDTH, OUTLINE_COLOR));
      log('layout', rect, this.geom);
    }

    /**
     * コメントを1件流す
     * @param {FlowComment} comment
     * @returns {boolean} 流したら true
     */
    push(comment) {
      const g = this.geom;
      if (!g || !this.visible || document.hidden) return false;
      if (this.items.size >= this.config.MAX_ON_SCREEN) return false;

      const el = this.createElement(comment);
      el.style.transform = `translateX(${g.width}px)`; // 画面の右外に置いて幅を測る
      this.stage.append(el);
      const width = el.offsetWidth;

      const durationMs = this.config.DURATION_SEC * 1000;
      const distance = g.width + width;
      const speed = (this.config.SPEED_MODE === 'constant' ? g.width : distance) / durationMs; // px/ms
      // 衝突判定とアニメーションで同じ時計を使う（performance.now() だと、描画が止まっている間に
      // アニメーションの開始だけが遅れて位置がずれる）
      const now = document.timeline.currentTime ?? performance.now();
      const lane = this.pickLane(now, width, speed);
      if (lane < 0) {
        el.remove();
        return false;
      }

      el.style.top = `${lane * g.lineHeight}px`;
      const item = { comment, el, lane, start: now, width, speed, anim: null };
      item.anim = el.animate(
        [{ transform: `translateX(${g.width}px)` }, { transform: `translateX(${-width}px)` }],
        { duration: distance / speed, easing: 'linear' },
      );
      item.anim.startTime = now; // 次の描画フレームを待たずに、判定に使った時刻を開始時刻にする
      item.anim.onfinish = () => this.removeItem(item);
      this.items.add(item);
      this.lanes[lane] = item;
      return true;
    }

    /** @param {FlowComment} comment */
    createElement(comment) {
      const el = document.createElement('div');
      el.className = 'lcf-comment';
      if (this.config.USE_USER_COLOR && comment.author.color) el.style.color = comment.author.color;

      if (this.config.SHOW_AUTHOR_NAME && comment.author.name) {
        const name = document.createElement('span');
        name.className = 'lcf-author';
        name.textContent = comment.author.name;
        el.append(name);
      }

      for (const part of comment.parts) {
        if (part.type === 'emote' && this.config.SHOW_EMOTES) {
          const img = document.createElement('img');
          img.className = 'lcf-emote';
          img.alt = part.alt;
          img.decoding = 'async';
          if (part.srcset) {
            img.sizes = `${Math.ceil(this.geom.fontSize * EMOTE_SIZE_EM)}px`;
            img.srcset = part.srcset;
          }
          img.src = part.url;
          el.append(img);
        } else {
          el.append(part.type === 'emote' ? part.alt : part.text);
        }
      }
      return el;
    }

    /** 行を選ぶ。上から順に空いている行を使い、空きがなければ WHEN_FULL に従う */
    pickLane(now, width, speed) {
      let best = -1;
      let bestOverlap = Infinity;
      for (let i = 0; i < this.lanes.length; i++) {
        const overlap = this.overlapWith(this.lanes[i], now, width, speed);
        if (overlap === 0) return i;
        if (overlap < bestOverlap) {
          best = i;
          bestOverlap = overlap;
        }
      }
      return this.config.WHEN_FULL === 'drop' ? -1 : best;
    }

    /**
     * 同じ行の直前のコメント prev と、今から流すコメントがどれだけ重なるか（px）。0 なら重ならない。
     * 各行の直前のコメントとだけ比べれば十分（それより前のコメントは prev よりさらに先を流れている）。
     */
    overlapWith(prev, now, width, speed) {
      if (!prev) return 0;
      const { width: screenWidth, gap } = this.geom;
      const prevRight = screenWidth + prev.width - prev.speed * (now - prev.start);

      // (1) 直前のコメントの末尾が、まだ画面右端から gap 以上入りきっていない
      const entering = prevRight + gap - screenWidth;

      // (2) 新しいコメントの方が速いと、直前のコメントが流れきる前に追いついてしまう
      let catchUp = 0;
      if (speed > prev.speed && prevRight > 0) {
        const timeToExit = prevRight / prev.speed;
        catchUp = speed * timeToExit - screenWidth; // 直前のコメントが消える瞬間に、新しいコメントの先頭が左端を越えている量
      }
      return Math.max(0, entering, catchUp);
    }

    removeItem(item) {
      item.el.remove();
      this.items.delete(item);
    }

    /** @param {(comment: FlowComment) => boolean} predicate */
    remove(predicate) {
      for (const item of this.items) {
        if (!predicate(item.comment)) continue;
        item.anim.cancel();
        this.removeItem(item);
      }
    }

    clear() {
      for (const item of this.items) {
        item.anim.cancel();
        item.el.remove();
      }
      this.items.clear();
      this.lanes.fill(null);
    }

    setVisible(visible) {
      this.visible = visible;
      if (!this.stage) return;
      if (!visible) this.clear();
      this.stage.style.display = visible ? '' : 'none';
      this.showToast(`コメント表示: ${visible ? 'ON' : 'OFF'}`);
    }

    showToast(text) {
      const toast = document.createElement('div');
      toast.className = 'lcf-toast';
      toast.textContent = text;
      this.layer.append(toast);
      toast.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1500 })
        .onfinish = () => toast.remove();
    }
  }

  /* ===========================================================================
   * 6. 共通: 全体の制御
   *
   * URL とプレイヤーを定期的に確認し、配信が変わったらコメントの取得先を切り替える。
   * SPA（ページ遷移なしで配信が切り替わるサイト）でも動くようにしている。
   * ======================================================================== */

  class LiveChatFlower {
    /** @param {PlatformAdapter} adapter */
    constructor(adapter, config) {
      this.adapter = adapter;
      this.config = config;
      this.renderer = new FlowRenderer(config);
      this.accept = createCommentFilter(config);
      this.source = null;
      this.streamKey = null;
      this.playerMisses = 0;
    }

    start() {
      this.update();
      setInterval(() => this.update(), TICK_MS);
      window.addEventListener('popstate', () => this.update());
    }

    toggle() {
      this.renderer.setVisible(!this.renderer.visible);
    }

    update() {
      const key = this.adapter.getStreamKey(location);
      if (key !== this.streamKey) {
        this.stopSource();
        this.renderer.clear();
        this.streamKey = key;
      }
      if (!key) {
        this.renderer.unmount();
        return;
      }

      const player = this.adapter.findPlayer();
      if (player) {
        this.playerMisses = 0;
        if (this.renderer.isMountedOn(player.video)) {
          this.renderer.layout(); // リサイズの通知を取りこぼしたときのための保険
        } else {
          this.renderer.mount(player);
        }
        if (!this.source) this.startSource(key);
      } else if (++this.playerMisses >= PLAYER_LOST_GRACE_TICKS) {
        // 画面の再描画で一瞬プレイヤーが消えることがあるので、しばらく待ってから切断する
        this.renderer.unmount();
        this.stopSource();
      }
    }

    startSource(key) {
      log(`connect: ${this.adapter.name} / ${key}`);
      this.source = this.adapter.createSource(key, {
        onComment: comment => this.handleComment(comment),
        onDelete: target => this.handleDelete(target),
      });
      this.source.start();
    }

    stopSource() {
      if (!this.source) return;
      log('disconnect');
      this.source.stop();
      this.source = null;
    }

    /** @param {FlowComment} comment */
    handleComment(comment) {
      if (!this.accept(comment)) return;
      this.renderer.push({ ...comment, parts: truncateParts(comment.parts, this.config.MAX_LENGTH) });
    }

    /** @param {DeleteTarget} target */
    handleDelete(target) {
      if (!this.config.REMOVE_DELETED) return;
      if (target.all) {
        this.renderer.clear();
      } else if (target.id) {
        this.renderer.remove(c => c.id === target.id);
      } else if (target.authorId) {
        this.renderer.remove(c => c.author.id === target.authorId);
      }
    }
  }

  /* ===========================================================================
   * 7. プラットフォーム: Twitch
   *
   * チャットは Twitch の IRC（WebSocket）に匿名の読み取り専用ユーザーで接続して取得する。
   * ページ上のチャット欄を読むわけではないので、チャット欄を閉じていても、
   * 全画面表示でも動作する。
   * ======================================================================== */

  const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
  const TWITCH_EMOTE_URL = 'https://static-cdn.jtvnw.net/emoticons/v2';

  // チャンネル名ではない URL の第1階層
  const TWITCH_RESERVED_PATHS = new Set([
    'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'search',
    'downloads', 'jobs', 'p', 'turbo', 'friends', 'messages', 'payments', 'prime', 'store', 'bits',
    'login', 'signup', 'logout', 'u', 'team', 'collections', 'following', 'event', 'broadcast',
  ]);

  const IRC_TAG_ESCAPES = { ':': ';', s: ' ', '\\': '\\', r: '\r', n: '\n' };

  /** IRCv3 のメッセージ1行を分解する */
  function parseIrcMessage(line) {
    const msg = { tags: {}, prefix: '', command: '', params: [] };
    let rest = line;

    if (rest.startsWith('@')) {
      const sp = rest.indexOf(' ');
      for (const pair of rest.slice(1, sp).split(';')) {
        const eq = pair.indexOf('=');
        if (eq < 0) {
          msg.tags[pair] = '';
        } else {
          msg.tags[pair.slice(0, eq)] = pair.slice(eq + 1).replace(/\\(.?)/g, (_, c) => IRC_TAG_ESCAPES[c] ?? c);
        }
      }
      rest = rest.slice(sp + 1);
    }
    if (rest.startsWith(':')) {
      const sp = rest.indexOf(' ');
      msg.prefix = rest.slice(1, sp);
      rest = rest.slice(sp + 1);
    }

    const trailingAt = rest.indexOf(' :');
    msg.params = (trailingAt < 0 ? rest : rest.slice(0, trailingAt)).split(' ').filter(Boolean);
    msg.command = msg.params.shift() || '';
    if (trailingAt >= 0) msg.params.push(rest.slice(trailingAt + 2));
    return msg;
  }

  /**
   * emotes タグ（例: '25:0-4,12-16/1902:6-10'）をもとに本文をテキストとエモートに分割する。
   * 位置は UTF-16 ではなくコードポイント単位。
   * @returns {CommentPart[]}
   */
  function buildTwitchParts(text, emotesTag) {
    if (!emotesTag) return [{ type: 'text', text }];

    const ranges = [];
    for (const group of emotesTag.split('/')) {
      const [id, positions] = group.split(':');
      if (!id || !positions || !/^[\w-]+$/.test(id)) continue;
      for (const pos of positions.split(',')) {
        const [start, end] = pos.split('-').map(Number);
        if (Number.isInteger(start) && Number.isInteger(end) && start <= end) ranges.push({ id, start, end });
      }
    }
    ranges.sort((a, b) => a.start - b.start);

    const chars = Array.from(text);
    const parts = [];
    let cursor = 0;
    for (const { id, start, end } of ranges) {
      if (start < cursor || end >= chars.length) continue;
      if (start > cursor) parts.push({ type: 'text', text: chars.slice(cursor, start).join('') });
      const base = `${TWITCH_EMOTE_URL}/${id}/default/dark`;
      parts.push({
        type: 'emote',
        alt: chars.slice(start, end + 1).join(''),
        url: `${base}/1.0`,
        srcset: `${base}/1.0 28w, ${base}/2.0 56w, ${base}/3.0 112w`,
      });
      cursor = end + 1;
    }
    if (cursor < chars.length) parts.push({ type: 'text', text: chars.slice(cursor).join('') });
    return parts;
  }

  /** @implements {CommentSource} */
  class TwitchChatSource {
    /**
     * @param {string} channel
     * @param {SourceHandlers} handlers
     */
    constructor(channel, handlers, options) {
      this.channel = channel;
      this.handlers = handlers;
      this.options = options;
      this.ws = null;
      this.stopped = true;
      this.retryCount = 0;
      this.retryTimer = 0;
    }

    start() {
      this.stopped = false;
      this.connect();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retryTimer);
      if (this.ws) {
        this.ws.onclose = this.ws.onmessage = null;
        this.ws.close();
        this.ws = null;
      }
    }

    connect() {
      const ws = new WebSocket(TWITCH_IRC_URL);
      this.ws = ws;
      ws.onopen = () => {
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 90000)}`); // 匿名ユーザー
        ws.send(`JOIN #${this.channel}`);
      };
      ws.onmessage = e => {
        for (const line of String(e.data).split('\r\n')) {
          if (line) this.handleLine(line);
        }
      };
      ws.onclose = () => this.reconnectLater();
    }

    reconnectLater() {
      this.ws = null;
      if (this.stopped) return;
      const delay = Math.min(30000, 1000 * 2 ** this.retryCount++);
      log(`Twitch: 切断されました。${delay / 1000} 秒後に再接続します`);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    }

    handleLine(line) {
      const msg = parseIrcMessage(line);
      switch (msg.command) {
        case 'PING':
          this.ws?.send(`PONG :${msg.params[0] || 'tmi.twitch.tv'}`);
          break;
        case 'JOIN':
          this.retryCount = 0;
          log(`Twitch: #${this.channel} に接続しました`);
          break;
        case 'RECONNECT': // サーバーから再接続を求められた
          this.ws?.close();
          break;
        case 'PRIVMSG':
          this.emitComment(msg);
          break;
        case 'USERNOTICE':
          if (this.options.SHOW_USERNOTICE_MESSAGES && msg.params[1]) this.emitComment(msg);
          break;
        case 'CLEARMSG': // 1件のメッセージが削除された
          if (msg.tags['target-msg-id']) this.handlers.onDelete({ id: msg.tags['target-msg-id'] });
          break;
        case 'CLEARCHAT': // ユーザーの BAN / タイムアウト、またはチャット全消去
          if (!msg.params[1]) this.handlers.onDelete({ all: true });
          else if (msg.tags['target-user-id']) this.handlers.onDelete({ authorId: msg.tags['target-user-id'] });
          break;
        case 'NOTICE':
          log(`Twitch NOTICE: ${msg.params[1]}`);
          break;
      }
    }

    emitComment(msg) {
      const { tags } = msg;
      let text = msg.params[1] || '';
      const action = /^\u0001ACTION (.*)\u0001$/.exec(text); // /me コマンド
      if (action) text = action[1];
      const login = tags.login || msg.prefix.split('!')[0];

      this.handlers.onComment({
        id: tags.id || '',
        text,
        parts: buildTwitchParts(text, tags.emotes),
        author: {
          id: tags['user-id'] || '',
          login,
          name: tags['display-name'] || login,
          color: tags.color || '',
        },
      });
    }
  }

  /** @type {PlatformAdapter} */
  const TwitchAdapter = {
    name: 'Twitch',

    matches: loc => loc.hostname === 'www.twitch.tv',

    getStreamKey(loc) {
      const segments = loc.pathname.split('/').filter(Boolean).map(s => s.toLowerCase());
      let channel = segments[0];
      if (channel === 'popout' || channel === 'moderator') channel = segments[1];
      if (!channel || TWITCH_RESERVED_PATHS.has(channel)) return null;
      return /^[a-z0-9_]{1,25}$/.test(channel) ? channel : null;
    },

    findPlayer() {
      const video = findLargestVideo(document.querySelectorAll('[data-a-target="video-ref"] video, .video-player video'));
      // 挿入位置は既定（<video> の直後）。プレイヤーの操作ボタンより下、映像より上に表示される
      return video ? { video } : null;
    },

    createSource: (channel, handlers) => new TwitchChatSource(channel, handlers, CONFIG.TWITCH),
  };

  /* ===========================================================================
   * 新しいプラットフォームに対応するには:
   *   1. CommentSource（start / stop を持ち、handlers.onComment に FlowComment を渡す）を実装する
   *   2. PlatformAdapter（matches / getStreamKey / findPlayer / createSource）を実装する
   *   3. 下の ADAPTERS に追加し、ヘッダーの @match に対象の URL を追加する
   * 描画（FlowRenderer）・フィルタ・全体の制御（LiveChatFlower）は変更不要。
   * ======================================================================== */

  /* ===========================================================================
   * 8. 起動
   * ======================================================================== */

  /** @type {PlatformAdapter[]} */
  const ADAPTERS = [TwitchAdapter];

  const adapter = ADAPTERS.find(a => a.matches(location));
  if (!adapter) return;

  const app = new LiveChatFlower(adapter, CONFIG);
  app.start();
  installHotkey(CONFIG.TOGGLE_HOTKEY, () => app.toggle());
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('コメント表示の切り替え', () => app.toggle());
  }
})();
