# Auto Harmony for Synthesizer V 2 Pro

Synthesizer V Studio 2 Pro 用のハモリ自動生成スクリプトです。  
メインボーカルトラックから指定した音程（インターバル）でハモリパートを自動生成し、空きトラックに配置します。ハモリ向けにボーカルパラメーターも最適化します。

---

## 機能

- **ハモリノート自動生成** — 長3度・完全5度・長6度など、7種類のプリセットまたは手動入力
- **スケール補正** — 指定したキー・モードに合わせてハモリのピッチを自動補正
- **空きトラックへの自動配置** — 空きトラックを自動検出して使用。なければ新規作成
- **ボーカルパラメーター最適化** — ビブラート・ブレスネス・テンション・ラウドネスをハモリ向けに調整
  - **Classic Chorus**: ビブラート50%、ラウドネス-3dB
  - **Pop Harmony**: ビブラート60%、ラウドネス-2dB
  - **R&B Harmony**: ブレスネス多め
  - **Minimal**: 調整なし

---

## 動作環境

- Synthesizer V Studio 2 **Pro** (version 2.0.0 以降)
- ※ 無料版（Synthesizer V Studio Basic）では動作しません

---

## インストール

1. `synthv-auto-harmony.js` をダウンロード
2. 以下の Scripts フォルダへコピー:

| OS      | パス |
|---------|------|
| Windows | `%APPDATA%\Dreamtonics\Synthesizer V Studio\scripts\` |
| macOS   | `~/Library/Application Support/Dreamtonics/Synthesizer V Studio/scripts/` |
| Linux   | `~/.local/share/Dreamtonics/Synthesizer V Studio/scripts/` |

3. Synthesizer V Studio を再起動
4. **Scripts** メニューに「Auto Harmony」が表示されます

---

## 使い方

1. ハモリを付けたいボーカルトラックを含むプロジェクトを開く
2. **Scripts** → **Utilities** → **Auto Harmony** を実行
3. 設定ダイアログで以下を設定:

| 設定項目 | 説明 |
|---------|------|
| ソーストラック | ハモリの基になるメインボーカルトラックを選択 |
| インターバル | ハモリの音程（例: 長3度上 = +4半音） |
| スケール補正 | ON にするとスケール外の音を自動補正 |
| キー / モード | スケール補正に使用するキーとモード |
| 生成範囲 | トラック全体 or 指定した小節範囲 |
| パラメーター最適化 | ハモリ向けにボーカルパラメーターを自動調整 |
| パラメータープリセット | Classic Chorus / Pop Harmony / R&B Harmony / Minimal |

4. **OK** をクリックすると配置確認ダイアログが表示されます
5. **OK** で配置完了。生成されたトラック名は `[Harmony] <元トラック名> +4st` のようになります

---

## 注意事項

- 生成操作は Ctrl+Z（Cmd+Z）で **元に戻す** ことができます
- メインボーカルトラックの既存データは一切変更しません
- ハモリトラックのパラメーター最適化はノートレベルで適用されます
- 新規トラックの自動作成が失敗した場合は、空のボーカルトラックを手動で追加してから再実行してください

---

## ライセンス

MIT License
