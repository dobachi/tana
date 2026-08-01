// extapps.js — 「別のアプリで開く」に使う外部アプリ一覧の真実源 (FR-13)
// エントリ: { id, name, command }
//   name    : メニューに出す表示名（省略時は command をそのまま使う）
//   command : 実行するプログラム。OS ごとの意味は下記。
// UI 参照用に一時 id を付与（favorites.js と同様、永続化はしない）。
//
// command に何を書けるか（tauri-plugin-opener → open クレートの実装より）:
//   Linux   : Command::new(command).arg(path)          → 実行ファイル名 or 絶対パス
//   macOS   : /usr/bin/open -a <command> <path>        → アプリ名 or .app のパス
//   Windows : cmd /c start "" "<command>" "<path>"     → 実行ファイル名 or 絶対パス
// いずれも「プログラムを1つ」渡すだけで、引数は付けられない（`code --wait` は不可）。
// 空白は macOS の "Visual Studio Code" や Windows の "C:\Program Files\..." で
// 正当に現れるので、空白では弾かない。

const STORAGE_KEY = 'tana.extapps';

/** o → 1..9 の二打鍵で選べる上限。これを超える登録はメニューからのみ使える。 */
export const QUICK_SLOTS = 9;

const MAX_NAME = 60;
const MAX_COMMAND = 260; // Windows の MAX_PATH 相当まで許す

/**
 * command / name の妥当性を判定する。
 * @param {{name?: string, command?: string}} raw
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateApp(raw) {
  const command = String((raw && raw.command) || '').trim();
  const name = String((raw && raw.name) || '').trim();
  if (!command) return { ok: false, reason: 'コマンドを入力してください' };
  if (command.length > MAX_COMMAND) return { ok: false, reason: 'コマンドが長すぎます' };
  if (name.length > MAX_NAME) return { ok: false, reason: '表示名が長すぎます' };
  // 制御文字（改行・タブ含む）は OS へ渡す前に落とす。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(command) || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, reason: '使用できない文字が含まれています' };
  }
  // Windows では cmd /c start "" "<command>" の形で、引用符が
  // エスケープされずにそのまま渡る。" を許すとコマンド境界を壊せてしまう。
  if (command.includes('"') || name.includes('"')) {
    return { ok: false, reason: '" は使用できません' };
  }
  return { ok: true };
}

/**
 * 入力を保存できる形へ整える。妥当でなければ null。
 * @returns {{name: string, command: string}|null}
 */
export function normalizeApp(raw) {
  if (!validateApp(raw).ok) return null;
  const command = String(raw.command).trim();
  const name = String((raw && raw.name) || '').trim() || command;
  return { name, command };
}

/** 永続化用に id を除いた配列へ変換 */
export function serialize(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({ name: a.name, command: a.command }));
}

/** 保存値から妥当なものだけを取り出す（壊れた値・型違いは捨てる） */
export function hydrate(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeApp).filter(Boolean);
}

/**
 * 二打鍵 `o → 1..9` のキーからエントリを引く。範囲外・未登録は null。
 * @param {Array} list
 * @param {string|number} key '1'..'9'
 */
export function pickByIndex(list, key) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 1 || n > QUICK_SLOTS) return null;
  return (Array.isArray(list) ? list : [])[n - 1] || null;
}

/** 「開けませんでした」に添える理由。アプリ名を必ず出す（何が失敗したか分かるように） */
export function describeAppError(app, error) {
  const label = app || '既定のアプリ';
  const msg = (error && (error.message || String(error))) || '';
  if (/No such file|not found|見つかりません|ENOENT|os error 2|os error 3/i.test(msg)) {
    return `${label} が見つかりません。コマンド名を確認してください`;
  }
  return msg ? `${label} で開けませんでした: ${msg}` : `${label} で開けませんでした`;
}

/**
 * 外部アプリ一覧のストア。favorites.js と同じく購読型。
 * @param {Array} initial 保存値（hydrate 前でよい）
 */
export function createExtApps(initial) {
  let idCounter = 0;
  const makeId = () => `app-${(idCounter += 1)}`;
  const listeners = new Set();
  let list = hydrate(initial).map((a) => ({ id: makeId(), ...a }));

  const emit = () => {
    for (const fn of listeners) fn(list);
  };

  return {
    /** 現在の一覧（新しい配列を返すので呼び出し側で壊せない） */
    list: () => list.slice(),
    /** 変更通知の購読。戻り値で解除。 */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /**
     * 追加。妥当でなければ理由を返す。
     * @returns {{ok: true, entry: object} | {ok: false, reason: string}}
     */
    add(raw) {
      const v = validateApp(raw);
      if (!v.ok) return v;
      const app = normalizeApp(raw);
      if (list.some((a) => a.command === app.command && a.name === app.name)) {
        return { ok: false, reason: 'すでに登録されています' };
      }
      const entry = { id: makeId(), ...app };
      list = [...list, entry];
      emit();
      return { ok: true, entry };
    },
    /** 削除。存在しない id は false。 */
    remove(id) {
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return false;
      list = next;
      emit();
      return true;
    },
    /** 並べ替え（1..9 のスロットを変えたいとき）。dir=-1 で上へ、+1 で下へ。 */
    move(id, dir) {
      const i = list.findIndex((a) => a.id === id);
      const j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= list.length) return false;
      const next = list.slice();
      [next[i], next[j]] = [next[j], next[i]];
      list = next;
      emit();
      return true;
    },
    /** 保存用の配列 */
    serialize: () => serialize(list),
  };
}

/** localStorage から読む（不在・壊れていれば空配列） */
export function loadStoredExtApps() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** localStorage へ保存する */
export function storeExtApps(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(list)));
  } catch {
    /* localStorage 不在時は無視 */
  }
}
