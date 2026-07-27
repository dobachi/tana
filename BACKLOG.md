# Backlog
- [x] 2026-07-27 FR-07 Places に Windows/OS のドライブ一覧(C:/I:/J:/K: 等)を出し、C 以外へ切り替える導線を作る。現状サイドバー「場所」は (M2 で実装) のままで、存在するドライブに気づけない=「Cしか開けない」の主因。M2 の本丸 #M2 (done: 2026-07-27)
- [x] 2026-07-27 存在しない/アクセス不可ドライブのエラー文言を具体化: navigatePane の catch が read_dir の OS エラー理由を握りつぶし「開けませんでした: L:/」しか出ない。理由(ドライブ無し/権限等)を surface する #bug #ux (done: 2026-07-27)
- [ ] 2026-07-27 FR-07 続き: WSL ディストロ(\\wsl$)の検出と Places の手動追加/永続化。ドライブ+標準フォルダ+クラウド同期(OneDrive/Box/Dropbox/Google Drive)は placesview.js/places.rs で実装済み。※WSL は UNC パスなので pathnav の正規化/ブレッドクラム対応も要確認 #M2
- [ ] 2026-07-27 make release を非対話対応にする: 現状 read -p でバージョンを対話入力必須なので CI/自動化/エージェントから使いにくい。make release VERSION=0.4.8 のように引数/環境変数で渡せるようにし、未指定時のみ従来の read -p にフォールバック #dx
- [x] 2026-07-27 [FR-16] プレビュー: 画像が横幅いっぱいで表示され縦スクロールが必要。画像はペインに収まるよう縦横フィット(object-fit:contain / max-height:100%)にして、下配置なら縦幅基準で全体が見えるようにする。preview.js / previewkind.js / style.css の画像表示周り #ux #preview (done: 2026-07-27)
- [ ] 2026-07-27 [FR-16] プレビュー: パン(ドラッグで表示位置移動)と +/− キーでのズーム。フィット⇄実寸クリック切替＋Ctrl+ホイール連続ズーム(画像上はフォント拡縮より優先)は実装済(previewzoom.js/onWheel) #preview
- [ ] 2026-07-27 [FR-09] プレビュー(将来): 動画のプレビューに対応。mp4/webm 等を <video controls> で再生（サムネイル+再生/一時停止/シーク）。CSP/asset プロトコルの許可、大容量のストリーミング、対応形式の判定を previewkind.js に追加。まずは軽量にネイティブ再生から #preview #future
- [x] 2026-07-27 プレビュー縦幅をマウスでリサイズ: #preview-divider(既に存在, 現状静的)をドラッグして preview 行の高さを可変にする。--preview-h を CSS 変数で持ち localStorage 永続化。純粋関数(高さclamp)+テスト。FR-09/FR-16 系 #ux (done: 2026-07-27)
- [ ] 2026-07-27 ナビゲーション履歴(戻る/進む): 現状 h/Backspace は親フォルダのみで履歴の戻る/進むが無い。ペインごとに訪問履歴を持ち、Alt+←/→ 等で戻る/進む。要件未登録なので FR 化も検討(セッション復元 FR-14 とも関連) #nav
