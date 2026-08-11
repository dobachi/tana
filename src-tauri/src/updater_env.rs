//! updater_env.rs — アプリ内更新（Tauri updater）が最後まで通る環境かの判定。
//!
//! updater プラグインは Linux の deb/rpm 版で、権限昇格を次の順に試す:
//!   1. `pkexec dpkg -i …`
//!   2. zenity / kdialog でパスワードを聞いて `sudo -S dpkg -i …`
//!   3. 端末で `sudo dpkg -i …`
//!
//! WSL には logind のセッションが無く polkit の認証が通らない。1 はエージェント不在の
//! ため**コンソール**でパスワードを聞いた末に失敗し、続けて 2 が**GUI**でもう一度聞く。
//! つまり「両方で聞かれた上で必ず失敗する」。試すだけ無駄なので、この経路に入る前に
//! 判定してフロントに返し、手動更新へ誘導する。
//!
//! 形式の判定は updater プラグインと同じ `tauri::utils::platform::bundle_type()` を使う。
//! これはバンドル時にバイナリへ焼かれる値なので、`cargo run` などの非バンドル実行では
//! Unknown（= root 不要扱い）になる。開発中はアプリ内更新を使わないので実害は無い。

use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;

/// フロントに返すアプリ内更新の可否。
#[derive(Debug, Serialize, PartialEq, Clone, Default)]
pub struct UpdateEnv {
    /// 更新の適用に root 権限が要る形式（Linux の deb / rpm）で入っている。
    pub needs_root: bool,
    /// 権限昇格の認証ができない環境（WSL に polkit のセッションが無い）。
    pub no_auth: bool,
    /// アプリ内で更新まで完了できる見込み。false なら手動更新へ誘導する。
    pub can_install: bool,
}

/// 判定本体（純粋）。root が要る形式なのに認証できないなら、試すだけ無駄。
fn can_install(needs_root: bool, no_auth: bool) -> bool {
    !(needs_root && no_auth)
}

/// 現在の実行ファイルが root 権限を要する形式で入っているか。
fn needs_root_install() -> bool {
    matches!(bundle_type(), Some(BundleType::Deb) | Some(BundleType::Rpm))
}

/// アプリ内更新の可否をフロントへ返す。更新ダイアログのボタン出し分けに使う。
#[tauri::command]
pub fn update_env() -> UpdateEnv {
    let needs_root = needs_root_install();
    let no_auth = crate::wsl::is_wsl();
    UpdateEnv {
        needs_root,
        no_auth,
        can_install: can_install(needs_root, no_auth),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_install_only_fails_when_root_is_needed_and_unauthenticable() {
        assert!(!can_install(true, true)); // WSL の deb/rpm 版だけが成立しない
        assert!(can_install(true, false)); // 通常の Linux デスクトップ（polkit あり）
        assert!(can_install(false, true)); // WSL でも AppImage なら root 不要
        assert!(can_install(false, false)); // Windows / macOS
    }

    #[test]
    fn update_env_is_consistent_with_its_flags() {
        let env = update_env();
        assert_eq!(env.can_install, can_install(env.needs_root, env.no_auth));
    }

    // 非バンドル実行（cargo test）では形式が不明なので root 不要扱いになる。
    #[test]
    fn unbundled_binary_does_not_need_root() {
        assert!(!needs_root_install());
    }
}
