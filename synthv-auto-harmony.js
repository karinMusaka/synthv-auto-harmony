/**
 * Synthesizer V Auto Harmony Plugin
 * Version: 1.0.0
 *
 * SynthV Script API v2 (JavaScript) を使用。
 * 主要 API:
 *   SV.getProject()                         → Project
 *   Project.getNumTracks()                  → int
 *   Project.getTrack(i)                     → Track
 *   Project.addTrack(track)                 → void
 *   Track.getName() / setName(s)
 *   Track.getNumGroups()                    → int
 *   Track.getGroupReference(i)              → NoteGroupReference
 *   NoteGroupReference.getTarget()          → NoteGroup
 *   NoteGroupReference.getOnset()           → int (blicks)
 *   NoteGroup.getNumNotes()                 → int
 *   NoteGroup.getNote(i)                    → Note
 *   NoteGroup.addNote(note)                 → void
 *   Note.getPitch() / setPitch(v)           → int (MIDI 0-127)
 *   Note.getOnset() / setOnset(v)           → int (blicks)
 *   Note.getDuration() / setDuration(v)     → int (blicks)
 *   Note.getLyrics() / setLyrics(s)         → string
 *   Note.getAttributes() / setAttributes(o) → object
 *   SV.create("Note") / ("Track")
 *   SV.newCustomDialogForm(1)               → Form
 *   SV.showCustomDialogAsync(form, cb)
 *   SV.showMessageBox(title, msg)
 *   SV.finish()                             ← 必ず1回呼ぶ
 *   SV.QUARTER                              = 705600000 blicks
 *
 * NOTE: トラックレベルのデフォルトパラメーター設定 API は非公開のため、
 *       ハモリノートの生成時に note.setAttributes() でノートレベルで設定する。
 *       効果は同等（生成ノートすべてに一括適用）。
 *
 * インストール:
 *   このファイルを SynthV Studio の Scripts フォルダへコピーし再起動する。
 *   Windows: %APPDATA%\Dreamtonics\Synthesizer V Studio\scripts\
 *   macOS  : ~/Library/Application Support/Dreamtonics/Synthesizer V Studio/scripts/
 */

"use strict";

// ============================================================
// Script Metadata
// ============================================================

function getClientInfo() {
  return {
    name:             SV.T("Auto Harmony"),
    category:         SV.T("Utilities"),
    description:      SV.T("Automatically generate harmony vocal parts with parameter optimization."),
    author:           "synthv-harm",
    versionNumber:    10000,       // 1.0.0
    minEditorVersion: 65540        // SynthV Studio 2.0.0+
  };
}

// ============================================================
// Constants
// ============================================================

var BLICKS_PER_QUARTER = 705600000; // SV.QUARTER

/** キー名（表示用） */
var KEY_NAMES_DISPLAY = [
  "C", "C#/Db", "D", "D#/Eb", "E", "F",
  "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"
];

/**
 * スケール音程テーブル（ルートからの半音オフセット、1オクターブ分）
 * 全12キー × 2モード (major / minor) を動的に生成するためここで定義。
 */
var SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10]   // ナチュラルマイナー
};

/**
 * ソーストラックのノートを解析してキー・スケールを推定する（純粋関数）。
 * ピッチクラスを duration で重み付けし、全 24 キー中最フィットするものを返す。
 * @param {Object[]} sourceNotes  analyzeTrack() の戻り値
 * @returns {{ keyIndex: number, mode: string }}
 */
/**
 * Krumhansl-Kessler キープロファイルを用いた Pearson 相関によるキー検出。
 * duration 重み付きピッチクラス分布と各キーのプロファイルを相関させ、
 * 最も相関の高いキー・モードを返す。
 * 単純音符カウント法よりも相対調（A minor vs C major 等）の区別精度が高い。
 */
function detectKeyAndScale(sourceNotes) {
  if (sourceNotes.length === 0) return { keyIndex: 0, mode: "major" };

  // Krumhansl-Kessler プロファイル（主音から各半音のトーナル重要度）
  var KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  // duration 重み付きピッチクラス分布
  var pcWeight = [0,0,0,0,0,0,0,0,0,0,0,0];
  var totalDur = 0;
  sourceNotes.forEach(function(note) {
    var pc = ((note.pitch % 12) + 12) % 12;
    pcWeight[pc] += note.duration;
    totalDur += note.duration;
  });
  if (totalDur === 0) return { keyIndex: 0, mode: "major" };
  for (var i = 0; i < 12; i++) pcWeight[i] /= totalDur; // 正規化

  // Pearson 相関係数
  function pearson(x, y) {
    var mx = 0, my = 0;
    for (var i = 0; i < 12; i++) { mx += x[i]; my += y[i]; }
    mx /= 12; my /= 12;
    var num = 0, sdx = 0, sdy = 0;
    for (var i = 0; i < 12; i++) {
      var dx = x[i] - mx, dy = y[i] - my;
      num += dx * dy; sdx += dx * dx; sdy += dy * dy;
    }
    var denom = Math.sqrt(sdx * sdy);
    return denom === 0 ? 0 : num / denom;
  }

  var bestKeyIndex = 0, bestMode = "major", bestCorr = -Infinity;

  for (var root = 0; root < 12; root++) {
    // プロファイルをピッチクラス空間に回転
    var majorProfile = new Array(12), minorProfile = new Array(12);
    for (var pc = 0; pc < 12; pc++) {
      var deg = (pc - root + 12) % 12;
      majorProfile[pc] = KK_MAJOR[deg];
      minorProfile[pc] = KK_MINOR[deg];
    }
    var majorCorr = pearson(pcWeight, majorProfile);
    var minorCorr = pearson(pcWeight, minorProfile);
    if (majorCorr > bestCorr) { bestCorr = majorCorr; bestKeyIndex = root; bestMode = "major"; }
    if (minorCorr > bestCorr) { bestCorr = minorCorr; bestKeyIndex = root; bestMode = "minor"; }
  }

  return { keyIndex: bestKeyIndex, mode: bestMode };
}

/** インターバルプリセット */
var INTERVAL_PRESETS = [
  { label: "長3度上  (+4st)",    semitones: 4  },
  { label: "完全5度上 (+7st)",   semitones: 7  },
  { label: "長6度上  (+9st)",    semitones: 9  },
  { label: "短3度上  (+3st)",    semitones: 3  },
  { label: "完全4度上 (+5st)",   semitones: 5  },
  { label: "長3度下  (-4st)",    semitones: -4 },
  { label: "完全5度下 (-7st)",   semitones: -7 },
  { label: "手動入力",            semitones: null }
];

/**
 * ボーカルパラメータープリセット
 *
 * vibratoDepthMult  : メインのビブラート深度に乗算
 * vibratoFreqMult   : メインのビブラート周波数に乗算
 * breathinessAdd    : メインのブレスネスに加算（-1〜1 範囲）
 * tensionAdd        : メインのテンションに加算（-1〜1 範囲）
 * genderMult        : メインのジェンダーに乗算（変更なし = 1.0）
 * loudnessAdd       : メインのラウドネスに加算（dB）
 */
var PARAMETER_PRESETS = {
  classic_chorus: {
    name:               "Classic Chorus",
    vibratoDepthMult:   0.50,
    vibratoFreqMult:    0.90,
    breathinessAdd:     0.15,
    tensionAdd:        -0.10,
    genderMult:         1.00,
    loudnessAdd:       -3.00
  },
  pop_harmony: {
    name:               "Pop Harmony",
    vibratoDepthMult:   0.60,
    vibratoFreqMult:    0.95,
    breathinessAdd:     0.15,
    tensionAdd:        -0.10,
    genderMult:         1.00,
    loudnessAdd:       -2.00
  },
  rnb_harmony: {
    name:               "R&B Harmony",
    vibratoDepthMult:   0.70,
    vibratoFreqMult:    1.00,
    breathinessAdd:     0.20,
    tensionAdd:        -0.05,
    genderMult:         1.00,
    loudnessAdd:       -2.00
  },
  minimal: {
    name:               "Minimal（調整なし）",
    vibratoDepthMult:   1.00,
    vibratoFreqMult:    1.00,
    breathinessAdd:     0.00,
    tensionAdd:         0.00,
    genderMult:         1.00,
    loudnessAdd:        0.00
  }
};

var PRESET_KEYS = Object.keys(PARAMETER_PRESETS);

// ============================================================
// Utilities
// ============================================================

/** 値を [min, max] にクランプ */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 小節番号をブリックスに変換（4/4拍子を仮定）。
 * SynthV のテンポマップ API が利用できる場合はそちらを使用すること。
 */
function barToBlicks(bar) {
  var beatsPerBar = 4;
  return Math.round((bar - 1) * beatsPerBar * BLICKS_PER_QUARTER);
}

// ============================================================
// Module: track-analyzer (Task 2.1 - 2.4)
// ============================================================

/**
 * 2.1: プロジェクト内の全ボーカルトラックを取得する。
 * @param {Object} project
 * @returns {Object[]} tracks 配列
 */
function getVocalTracks(project) {
  var tracks = [];
  var numTracks = project.getNumTracks();
  for (var i = 0; i < numTracks; i++) {
    var t = project.getTrack(i);
    // WAV/インストゥルメントトラックはノートグループを持たない → 除外
    if (t.getNumGroups() > 0) {
      tracks.push(t);
    }
  }
  return tracks;
}

/**
 * ボーカルトラック名リストを返す（UI 用）。
 */
function getVocalTrackNames(project) {
  return getVocalTracks(project).map(function(t) { return t.getName(); });
}

/**
 * 2.2, 2.3: 指定トラックの全ノート情報を抽出する。
 * @param {Object} track
 * @param {number|null} startBlicks  開始時刻フィルタ（null = 先頭から）
 * @param {number|null} endBlicks    終了時刻フィルタ（null = 末尾まで）
 * @returns {Object[]} ノートデータ配列
 */
function analyzeTrack(track, startBlicks, endBlicks) {
  var notes = [];
  var numGroups = track.getNumGroups();

  for (var g = 0; g < numGroups; g++) {
    var groupRef  = track.getGroupReference(g);
    var group     = groupRef.getTarget();
    var groupBias = groupRef.getTimeOffset(); // グループの絶対開始位置（blicks）
    var numNotes  = group.getNumNotes();

    for (var n = 0; n < numNotes; n++) {
      var note           = group.getNote(n);
      var absoluteOnset  = note.getOnset() + groupBias;

      // 2.3: 時間範囲フィルタ
      if (startBlicks !== null && absoluteOnset < startBlicks) continue;
      if (endBlicks   !== null && absoluteOnset >= endBlicks)  continue;

      notes.push({
        pitch:      note.getPitch(),
        onset:      absoluteOnset,
        duration:   note.getDuration(),
        lyrics:     note.getLyrics(),
        attributes: note.getAttributes()   // ノートレベル属性（後でコピー）
      });
    }
  }

  // 絶対 onset 順にソート（複数グループ混在時の順序保証）
  notes.sort(function(a, b) { return a.onset - b.onset; });

  // 2.4: ノートが0件でも空配列を返す（エラーにしない）
  return notes;
}

/**
 * 単一の NoteGroupReference からノート情報を抽出する（選択リージョンモード用）。
 * @param {Object} groupRef  NoteGroupReference
 * @returns {Object[]}
 */
function analyzeGroupRef(groupRef) {
  var notes    = [];
  var group    = groupRef.getTarget();
  var bias     = groupRef.getTimeOffset(); // グループの絶対開始位置
  var numNotes = group.getNumNotes();

  for (var n = 0; n < numNotes; n++) {
    var note = group.getNote(n);
    notes.push({
      pitch:      note.getPitch(),
      onset:      note.getOnset() + bias,
      duration:   note.getDuration(),
      lyrics:     note.getLyrics(),
      attributes: note.getAttributes()
    });
  }
  return notes;
}

/**
 * 空きトラック（ノート0件）を検出する。
 * @param {Object}  project
 * @param {number}  excludeIndex  ソーストラックのインデックス（除外）
 * @returns {{ index: number, track: Object }[]}
 */
function findEmptyTracks(project, excludeIndex) {
  var result = [];
  var numTracks = project.getNumTracks();

  for (var i = 0; i < numTracks; i++) {
    if (i === excludeIndex) continue;

    var track     = project.getTrack(i);
    var numGroups = track.getNumGroups();

    // WAV/インストゥルメントトラックはグループなし → ボーカルトラックではない
    if (numGroups === 0) continue;

    var totalNotes = 0;
    for (var g = 0; g < numGroups; g++) {
      totalNotes += track.getGroupReference(g).getTarget().getNumNotes();
    }

    if (totalNotes === 0) {
      result.push({ index: i, track: track });
    }
  }

  return result;
}

// ============================================================
// Module: harmony-generator (Task 3.1 - 3.5)
// ============================================================

/**
 * 3.2: 指定キー・モードのスケール音クラスセットを構築する。
 * @param {number} keyRoot  0=C … 11=B
 * @param {string} mode     "major" or "minor"
 * @returns {Set<number>}   ピッチクラス集合（0-11）
 */
function buildScalePitchClasses(keyRoot, mode) {
  var intervals   = SCALE_INTERVALS[mode] || SCALE_INTERVALS.major;
  var pitchClasses = {};   // ES5 互換: Set の代わりにオブジェクト
  intervals.forEach(function(iv) {
    pitchClasses[(keyRoot + iv) % 12] = true;
  });
  return pitchClasses;
}

/**
 * 3.3: スケール補正 — スケール外ピッチを最近接スケール音に補正する。
 * @param {number} pitch          補正前 MIDI ピッチ
 * @param {Object} scalePitchClasses  ピッチクラスオブジェクト（キー = 0-11）
 * @returns {number}              補正後 MIDI ピッチ
 */
function snapToScale(pitch, scalePitchClasses) {
  var pc = ((pitch % 12) + 12) % 12;
  if (scalePitchClasses[pc]) return pitch;  // 既にスケール内

  var bestOffset   = 0;
  var bestDistance = 999;

  for (var offset = -6; offset <= 6; offset++) {
    var candidate = ((pc + offset) % 12 + 12) % 12;
    if (scalePitchClasses[candidate]) {
      var dist = Math.abs(offset);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestOffset   = offset;
      }
    }
  }

  return pitch + bestOffset;
}

/**
 * 3.1, 3.4, 3.5: ハモリノートリストを生成する。
 * @param {Object[]} sourceNotes
 * @param {number}   semitones         インターバル（正=上、負=下）
 * @param {boolean}  scaleCorrection
 * @param {Object|null} scalePitchClasses
 * @returns {Object[]}
 */
function generateHarmonyNotes(sourceNotes, semitones, scaleCorrection, scalePitchClasses) {
  return sourceNotes.map(function(src) {
    var harmonyPitch = clamp(src.pitch + semitones, 0, 127);

    if (scaleCorrection && scalePitchClasses) {
      harmonyPitch = snapToScale(harmonyPitch, scalePitchClasses);
    }

    // 3.5: デュレーション・歌詞はメインノートから継承
    return {
      pitch:      harmonyPitch,
      onset:      src.onset,
      duration:   src.duration,
      lyrics:     src.lyrics,
      // attributes は後で vocal-parameter-optimizer が上書きする
      attributes: JSON.parse(JSON.stringify(src.attributes || {}))
    };
  });
}

// ============================================================
// Module: vocal-parameter-optimizer (Task 6.1 - 6.9)
// ============================================================

/**
 * 6.1 (調査結果):
 *   SynthV Script API ではトラックレベルのデフォルトパラメーター書き込み
 *   メソッドは公開されていない（2025年時点）。
 *   代替策: 生成する全ハモリノートに setAttributes() で直接設定する。
 *   効果はトラックデフォルト設定と同等。
 */

/**
 * 6.3: ソーストラックの代表パラメーター値を読み取る（最初のノートを参照）。
 * 属性キー名は SynthV Script API Reference に準拠。
 * @param {Object} track
 * @returns {Object} sourceParams
 */
function getSourceTrackDefaultParams(track) {
  // デフォルト値（SynthV のゼロ値）
  var params = {
    vibratoDepth:  0.5,   // pF0Vbr: 0-1
    vibratoFreq:   5.5,   // dF0Vbr: Hz 相当（0-14 程度）
    breathiness:   0.0,   // paramBre: -1 to 1
    tension:       0.0,   // paramTen: -1 to 1
    gender:        0.0,   // paramGender: -1 to 1
    loudness:      0.0    // paramLou: dB
  };

  if (track.getNumGroups() > 0) {
    var group = track.getGroupReference(0).getTarget();
    if (group.getNumNotes() > 0) {
      var attrs = group.getNote(0).getAttributes();
      // NOTE: 属性キー名は SynthV バージョンにより異なる場合がある
      if (typeof attrs.pF0Vbr       !== "undefined") params.vibratoDepth = attrs.pF0Vbr;
      if (typeof attrs.dF0Vbr       !== "undefined") params.vibratoFreq  = attrs.dF0Vbr;
      if (typeof attrs.paramBre     !== "undefined") params.breathiness  = attrs.paramBre;
      if (typeof attrs.paramTen     !== "undefined") params.tension       = attrs.paramTen;
      if (typeof attrs.paramGender  !== "undefined") params.gender        = attrs.paramGender;
      if (typeof attrs.paramLou     !== "undefined") params.loudness      = attrs.paramLou;
    }
  }

  return params;
}

/**
 * 6.4: プリセットに基づきハモリ向けパラメーター値を計算する。
 */
function calculateHarmonyParams(sourceParams, presetKey) {
  var preset = PARAMETER_PRESETS[presetKey] || PARAMETER_PRESETS.classic_chorus;

  return {
    vibratoDepth: clamp(sourceParams.vibratoDepth * preset.vibratoDepthMult, 0, 1),
    vibratoFreq:  clamp(sourceParams.vibratoFreq  * preset.vibratoFreqMult,  0, 20),
    breathiness:  clamp(sourceParams.breathiness  + preset.breathinessAdd,  -1, 1),
    tension:      clamp(sourceParams.tension      + preset.tensionAdd,      -1, 1),
    gender:       clamp(sourceParams.gender       * preset.genderMult,      -1, 1),
    loudness:     sourceParams.loudness + preset.loudnessAdd
  };
}

/**
 * 6.5, 6.6: ハモリノートデータに計算済みパラメーターを設定する。
 * ノートレベルの個別設定値（明示的に設定された属性）は保護する。
 */
function applyParametersToNotes(harmonyNoteData, harmonyParams) {
  return harmonyNoteData.map(function(noteData) {
    var existingAttrs = noteData.attributes || {};
    var newAttrs = JSON.parse(JSON.stringify(existingAttrs));

    // 6.6: 既存値が明示的に設定されていない場合のみ上書き
    // SynthV のデフォルト（未設定）値は 0 または undefined の場合が多い
    // ここでは undefined のものを「未設定」とみなして上書きする
    if (typeof existingAttrs.pF0Vbr      === "undefined") newAttrs.pF0Vbr      = harmonyParams.vibratoDepth;
    if (typeof existingAttrs.dF0Vbr      === "undefined") newAttrs.dF0Vbr      = harmonyParams.vibratoFreq;
    if (typeof existingAttrs.paramBre    === "undefined") newAttrs.paramBre    = harmonyParams.breathiness;
    if (typeof existingAttrs.paramTen    === "undefined") newAttrs.paramTen    = harmonyParams.tension;
    if (typeof existingAttrs.paramGender === "undefined") newAttrs.paramGender = harmonyParams.gender;
    if (typeof existingAttrs.paramLou    === "undefined") newAttrs.paramLou    = harmonyParams.loudness;

    return Object.assign({}, noteData, { attributes: newAttrs });
  });
}

// ============================================================
// Voice Copy Utility
// ============================================================

/**
 * ソーストラックのシンガー（ボイスDB）をターゲットトラックにコピーする。
 * SynthV Script API では NoteGroupReference.getDatabase() / setDatabase() で
 * シンガー DB を取得・設定できる（バージョンによって API 名が異なる場合あり）。
 * @param {Object} sourceTrack
 * @param {Object} targetTrack
 * @returns {boolean}  成功 true / 非対応 false
 */
function copyVoiceToTrack(sourceTrack, targetTrack) {
  // 注意: スクリプト API ではシンガー DB の選択は変更不可（GUI のみ）。
  // getVoice()/setVoice() で操作できるのはボイスパラメーター値
  //（loudness, tension, breathiness, gender, toneShift）のみ。
  // ここではパラメーター値のコピーを試みる。
  try {
    if (sourceTrack.getNumGroups() === 0 || targetTrack.getNumGroups() === 0) return false;

    var tgtRef = targetTrack.getGroupReference(0);

    for (var g = 0; g < sourceTrack.getNumGroups(); g++) {
      var srcRef = sourceTrack.getGroupReference(g);
      if (typeof srcRef.getVoice === "function" && typeof tgtRef.setVoice === "function") {
        var voice = srcRef.getVoice();
        if (voice && Object.keys(voice).length > 0) {
          tgtRef.setVoice(voice);
          return true;
        }
      }
    }
  } catch(e) {}
  return false;
}

// ============================================================
// Module: track-placer (Task 4.1 - 4.6)
// ============================================================

/**
 * 4.2, 4.3, 4.4: ハモリノートをターゲットトラックへ配置する。
 * @param {Object}   project
 * @param {Object[]} harmonyNotes  ハモリノートデータ配列
 * @param {string}   trackName    配置先トラック名
 * @param {number|null} targetTrackIndex  空きトラックのインデックス（null = 新規作成）
 * @returns {number|false}  配置したノート数 or false（エラー）
 */
function placeHarmonyNotes(project, harmonyNotes, trackName, targetTrackIndex) {
  var targetTrack;

  if (targetTrackIndex !== null && targetTrackIndex !== undefined) {
    // 4.2: 既存の空きトラックを使用
    targetTrack = project.getTrack(targetTrackIndex);
  } else {
    // 4.3: 空きトラックなし → 新規トラック作成
    // NOTE: SV.create("Track") と project.addTrack() の可否は
    //       SynthV Studio 2 のバージョンにより異なる。
    //       動作しない場合は SV.showMessageBox でユーザーに手動作成を促す。
    try {
      targetTrack = SV.create("Track");
      project.addTrack(targetTrack);
    } catch (e) {
      SV.showMessageBox(
        "Auto Harmony",
        "新規トラックの自動作成に失敗しました。\n" +
        "SynthV Studio で空のボーカルトラックを手動で追加してから再実行してください。\n" +
        "エラー: " + e.message
      );
      return false;
    }
  }

  // 4.4: トラック名を設定
  targetTrack.setName(trackName);

  // ハモリノートの絶対開始位置（グループの onset に使用）
  var groupOnset = harmonyNotes[0].onset;
  var addedCount = 0;
  var regionCreated = false;

  // ── リージョンブロック作成（公式ドキュメント準拠フロー）──
  // 正しい順序:
  //   1. NoteGroup を作成してノートを追加
  //   2. project.addNoteGroup() でプロジェクトライブラリに登録（setTarget の前に必須）
  //   3. NoteGroupReference を作成し setTarget() で NoteGroup を関連付け
  //   4. setTimeOffset() で位置を設定（NoteGroupReference には setOnset() は存在しない）
  //   5. track.addGroupReference() でアレンジビューに追加
  try {
    var noteGroup = SV.create("NoteGroup");
    noteGroup.setName(trackName);

    harmonyNotes.forEach(function(noteData) {
      var note = SV.create("Note");
      note.setPitch(noteData.pitch);
      note.setOnset(noteData.onset - groupOnset); // Note の setOnset() は有効
      note.setDuration(noteData.duration);
      note.setLyrics(noteData.lyrics);
      if (noteData.attributes && Object.keys(noteData.attributes).length > 0) {
        try { note.setAttributes(noteData.attributes); } catch (e) {}
      }
      noteGroup.addNote(note);
      addedCount++;
    });

    // プロジェクトライブラリへ登録（setTarget の前に必須）
    project.addNoteGroup(noteGroup);

    // NoteGroupReference を作成して位置・グループを設定
    var lastHNote = harmonyNotes[harmonyNotes.length - 1];
    var regionDuration = lastHNote.onset + lastHNote.duration - groupOnset;

    var newGroupRef = SV.create("NoteGroupReference");
    newGroupRef.setTarget(noteGroup);
    newGroupRef.setTimeOffset(groupOnset);
    // リージョンブロックの表示範囲を明示（GroupHarmony.lua パターン）
    try { newGroupRef.setTimeRange(groupOnset, regionDuration); } catch (e) {}

    targetTrack.addGroupReference(newGroupRef);

    // 空の main group（index 0）が measure 1 から表示されるのを防ぐ:
    // SV.create("Track") が生成する main group は timeOffset=0 のため、
    // region block と同じ位置に移動させてトラック表示範囲を揃える。
    try {
      var emptyMainRef = targetTrack.getGroupReference(0);
      emptyMainRef.setTimeOffset(groupOnset);
      emptyMainRef.setTimeRange(groupOnset, regionDuration);
    } catch (e) {}

    regionCreated = true;

  } catch (e) {
    // 非対応バージョン → フォールバックへ
    addedCount = 0;
  }

  // ── フォールバック: メイングループ (index 0) にノートを追加 ──
  if (!regionCreated) {
    if (targetTrack.getNumGroups() === 0) {
      SV.showMessageBox("Auto Harmony", "警告: 対象トラックにグループが存在しません。");
      return false;
    }
    var mainGroupRef = targetTrack.getGroupReference(0);
    var mainGroup    = mainGroupRef.getTarget();
    var groupOffset  = mainGroupRef.getTimeOffset();

    harmonyNotes.forEach(function(noteData) {
      var note = SV.create("Note");
      note.setPitch(noteData.pitch);
      note.setOnset(noteData.onset - groupOffset);
      note.setDuration(noteData.duration);
      note.setLyrics(noteData.lyrics);
      if (noteData.attributes && Object.keys(noteData.attributes).length > 0) {
        try { note.setAttributes(noteData.attributes); } catch (e) {}
      }
      mainGroup.addNote(note);
      addedCount++;
    });
  }

  return { count: addedCount, track: targetTrack };
}

// ============================================================
// Module: harmony-config-ui (Task 5.1 - 5.7)
// ============================================================

/**
 * 5.1 - 5.7: メイン設定ダイアログを表示する（同期）。
 * @param {string[]} trackNames
 * @param {{ keyIndex: number, modeIndex: number }} detected  自動検出済みキー情報
 * @returns {Object|null}  settings オブジェクト または null（キャンセル）
 */
function showMainDialog(trackNames, detected) {
  detected = detected || { keyIndex: 0, modeIndex: 0 };
  // 5.3: インターバルプリセット選択肢
  var intervalChoices    = INTERVAL_PRESETS.map(function(p) { return p.label; });
  // 6.7: パラメータープリセット選択肢
  var paramPresetChoices = PRESET_KEYS.map(function(k) { return PARAMETER_PRESETS[k].name; });

  var form = {
    title:   "Auto Harmony — ハモリ自動生成",
    message: "ハモリ生成の設定を行ってください。\n※ スケール補正 ON の場合は指定キー・モードでピッチ補正します。",
    buttons: "OkCancel",
    widgets: [
      // 5.2: ソーストラック選択
      {
        name:    "sourceTrackIndex",
        type:    "ComboBox",
        label:   "ソーストラック（メインボーカル）",
        choices: trackNames,
        default: 0
      },
      // 5.3: インターバルプリセット
      {
        name:    "intervalPresetIndex",
        type:    "ComboBox",
        label:   "インターバル（音程）",
        choices: intervalChoices,
        default: 0
      },
      // 5.4: 手動インターバル（Slider: TextBox は非対応）
      {
        name:     "manualInterval",
        type:     "Slider",
        label:    "手動インターバル（半音数、「手動入力」選択時のみ有効）",
        format:   "%1.0f",
        minValue: -24,
        maxValue: 24,
        interval: 1,
        default:  4
      },
      // 5.5: スケール補正 ON/OFF
      {
        name:    "scaleCorrection",
        type:    "CheckBox",
        text:    "スケール補正を適用する",   // CheckBox は "text" キー
        default: true
      },
      // 5.5: キー選択（自動検出値をデフォルトに）
      {
        name:    "keyIndex",
        type:    "ComboBox",
        label:   "キー（★自動検出済み）",
        choices: KEY_NAMES_DISPLAY,
        default: detected.keyIndex
      },
      // 5.5: モード選択（自動検出値をデフォルトに）
      {
        name:    "modeIndex",
        type:    "ComboBox",
        label:   "モード（★自動検出済み）",
        choices: ["メジャー", "マイナー（ナチュラル）"],
        default: detected.modeIndex
      },
      // 5.6: 生成範囲
      {
        name:    "rangeType",
        type:    "ComboBox",
        label:   "生成範囲",
        choices: ["トラック全体", "カスタム範囲（小節指定）", "選択リージョン（ピアノロールで開いているブロック）"],
        default: 0
      },
      // 5.6: 範囲（Slider: TextBox は非対応）
      {
        name:     "startBar",
        type:     "Slider",
        label:    "開始小節（カスタム範囲の場合）",
        format:   "%1.0f",
        minValue: 1,
        maxValue: 300,
        interval: 1,
        default:  1
      },
      {
        name:     "endBar",
        type:     "Slider",
        label:    "終了小節（カスタム範囲の場合）",
        format:   "%1.0f",
        minValue: 1,
        maxValue: 300,
        interval: 1,
        default:  8
      },
      // 6.7, 6.9: パラメーター最適化
      {
        name:    "useParamOptimize",
        type:    "CheckBox",
        text:    "ボーカルパラメーターをハモリ向けに最適化する",
        default: true
      },
      // 6.7: プリセット選択
      {
        name:    "paramPresetIndex",
        type:    "ComboBox",
        label:   "パラメータープリセット",
        choices: paramPresetChoices,
        default: 0
      }
    ]
  };

  var results = SV.showCustomDialog(form);
  if (!results.status) return null;

  var parsed = parseDialogAnswers(results.answers);
  if (parsed === null) {
    SV.showMessageBox("Auto Harmony", "インターバルは -24 〜 +24 の範囲で設定してください。");
  }
  return parsed;
}

/**
 * ダイアログ回答オブジェクトを settings に変換する純粋関数（SV API 不要）。
 * @param {Object} answers  SV.showCustomDialog の results.answers
 * @returns {Object|null}   settings オブジェクト、またはバリデーションエラー時 null
 */
function parseDialogAnswers(answers) {
  // 5.4: インターバル解決
  var presetIdx = answers.intervalPresetIndex || 0;
  var semitones;

  if (INTERVAL_PRESETS[presetIdx].semitones === null) {
    // 手動入力（Slider 値）
    semitones = Math.round(answers.manualInterval);
    if (semitones < -24 || semitones > 24) return null;
  } else {
    semitones = INTERVAL_PRESETS[presetIdx].semitones;
  }

  // 5.6: 範囲解決
  var startBlicks    = null;
  var endBlicks      = null;
  var useActiveRegion = false;
  if (answers.rangeType === 1) {
    startBlicks = barToBlicks(Math.round(answers.startBar));
    endBlicks   = barToBlicks(Math.round(answers.endBar) + 1);
  } else if (answers.rangeType === 2) {
    useActiveRegion = true;
  }

  return {
    sourceTrackIndex: answers.sourceTrackIndex,
    semitones:        semitones,
    scaleCorrection:  !!answers.scaleCorrection,
    keyIndex:         answers.keyIndex || 0,
    mode:             (answers.modeIndex === 1) ? "minor" : "major",
    startBlicks:      startBlicks,
    endBlicks:        endBlicks,
    useActiveRegion:  useActiveRegion,
    useParamOptimize: !!answers.useParamOptimize,
    paramPresetKey:   PRESET_KEYS[answers.paramPresetIndex || 0]
  };
}

/**
 * 4.5: 配置前確認ダイアログを表示する（同期）。
 * @returns {boolean}
 */
function showConfirmDialog(noteCount, trackName) {
  var results = SV.showCustomDialog({
    title:   "Auto Harmony — 配置確認",
    message: noteCount + " 個のハモリノートを「" + trackName + "」に配置します。\nよろしいですか？",
    buttons: "OkCancel",
    widgets: []
  });
  return results.status;
}

// ============================================================
// Main Flow (Task 7.1)
// ============================================================

/**
 * ハモリ生成を実行する（同期）。
 * @returns {boolean}  成功なら true
 */
function executeHarmonyGeneration(settings) {
  var project         = SV.getProject();
  // sourceTrack は main() で vocalTracks[] から解決済み
  var sourceTrack     = settings.sourceTrack;
  var sourceTrackName = sourceTrack.getName();
  var sourceNotes;

  if (settings.useActiveRegion) {
    // 選択リージョンモード: ピアノロールで現在開いているブロックをソースにする
    var activeGroupRef;
    try {
      activeGroupRef = SV.getMainEditor().getCurrentGroup();
    } catch(e) {
      SV.showMessageBox("Auto Harmony", "エラー: getMainEditor() が利用できません。\n別の範囲モードを使用してください。");
      return false;
    }

    if (!activeGroupRef || activeGroupRef.isMain()) {
      SV.showMessageBox("Auto Harmony",
        "「選択リージョン」モードを使用するには、アレンジビューでリージョンブロックを\n" +
        "ダブルクリックして開いた状態で実行してください。");
      return false;
    }

    sourceNotes = analyzeGroupRef(activeGroupRef);
    // ソーストラックをリージョンの親トラックで上書き
    sourceTrack     = activeGroupRef.getParent();
    sourceTrackName = sourceTrack.getName();
  } else {
    // 通常モード: トラック全体 or カスタム小節範囲
    sourceNotes = analyzeTrack(sourceTrack, settings.startBlicks, settings.endBlicks);
  }

  if (sourceNotes.length === 0) {
    SV.showMessageBox("Auto Harmony", "指定範囲にノートが見つかりませんでした。\n範囲設定を確認してください。");
    return false;
  }

  // 3.2: スケールピッチクラスを構築
  var scalePitchClasses = null;
  if (settings.scaleCorrection) {
    scalePitchClasses = buildScalePitchClasses(settings.keyIndex, settings.mode);
  }

  // 3.1, 3.3, 3.4, 3.5: ハモリノート生成
  var harmonyNotes = generateHarmonyNotes(
    sourceNotes,
    settings.semitones,
    settings.scaleCorrection,
    scalePitchClasses
  );

  // 6.3 - 6.5: ボーカルパラメーター最適化
  if (settings.useParamOptimize) {
    var sourceParams  = getSourceTrackDefaultParams(sourceTrack);
    var harmonyParams = calculateHarmonyParams(sourceParams, settings.paramPresetKey);
    harmonyNotes      = applyParametersToNotes(harmonyNotes, harmonyParams);
  }

  // 4.3: 常に新規トラックを作成（既存の空きトラックは再利用しない）
  // 既存トラックの再利用は予期しない上書きを引き起こすため廃止
  var targetTrackIndex = null;

  // 4.4: トラック名生成
  var sign      = settings.semitones >= 0 ? "+" : "";
  var trackName = "[Harmony] " + sourceTrackName + " " + sign + settings.semitones + "st";

  // 4.5: 配置前確認ダイアログ（同期）
  if (!showConfirmDialog(harmonyNotes.length, trackName)) return false;

  // 4.2, 4.3: ノート配置
  var placed = placeHarmonyNotes(project, harmonyNotes, trackName, targetTrackIndex);
  if (placed === false) return false;

  // ボイスコピー（ソーストラックと同じシンガーをハモリトラックに設定）
  var voiceCopied = copyVoiceToTrack(sourceTrack, placed.track);

  var presetName = settings.useParamOptimize
    ? "\nパラメータープリセット: " + PARAMETER_PRESETS[settings.paramPresetKey].name
    : "\nパラメーター最適化: なし";
  // シンガーDB の選択はスクリプト API 対象外のため常に手動設定が必要
  var voiceMsg = "\n※ シンガーを手動で選択してください（スクリプト API の制約）。";

  SV.showMessageBox(
    "Auto Harmony",
    placed.count + " 個のハモリノートを「" + trackName + "」に配置しました。" + presetName + voiceMsg
  );

  return true;
}

/**
 * スクリプトエントリーポイント（同期）。
 */
function main() {
  var project   = SV.getProject();
  var numTracks = project.getNumTracks();

  if (numTracks === 0) {
    SV.showMessageBox("Auto Harmony", "プロジェクトにボーカルトラックが見つかりません。\nトラックを追加してから再実行してください。");
    SV.finish();
    return;
  }

  var vocalTracks = getVocalTracks(project);
  var trackNames  = vocalTracks.map(function(t) { return t.getName(); });

  if (vocalTracks.length === 0) {
    SV.showMessageBox("Auto Harmony", "ボーカルトラックが見つかりません。\nボーカルトラックを追加してから再実行してください。");
    SV.finish();
    return;
  }

  // ソーストラック（デフォルト: 1番目）のノートを解析してキー・スケールを自動検出
  var firstNotes        = analyzeTrack(vocalTracks[0], null, null);
  var detectedKey       = detectKeyAndScale(firstNotes);
  var detectedModeIndex = detectedKey.mode === "minor" ? 1 : 0;

  // 5.1 - 5.7: 設定ダイアログ（同期）
  var settings = showMainDialog(trackNames, {
    keyIndex:  detectedKey.keyIndex,
    modeIndex: detectedModeIndex
  });
  if (settings !== null) {
    // ダイアログの sourceTrackIndex は vocalTracks[] の index なので
    // 実際のトラックオブジェクトをここで解決して渡す
    settings.sourceTrack = vocalTracks[settings.sourceTrackIndex];
    executeHarmonyGeneration(settings);
  }

  SV.finish();
}
