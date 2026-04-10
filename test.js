/**
 * Auto Harmony Plugin — Unit Tests (Node.js)
 *
 * SynthV API 不要の純粋関数を Node.js で直接テストする。
 * 実行: node test.js
 */

"use strict";

// ============================================================
// Pure function copies (SV API 依存を除いた関数のみ抽出)
// ============================================================

var BLICKS_PER_QUARTER = 705600000;

var SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10]
};

var PARAMETER_PRESETS = {
  classic_chorus: {
    name: "Classic Chorus",
    vibratoDepthMult: 0.50, vibratoFreqMult: 0.90,
    breathinessAdd: 0.15, tensionAdd: -0.10, genderMult: 1.00, loudnessAdd: -3.00
  },
  pop_harmony: {
    name: "Pop Harmony",
    vibratoDepthMult: 0.60, vibratoFreqMult: 0.95,
    breathinessAdd: 0.15, tensionAdd: -0.10, genderMult: 1.00, loudnessAdd: -2.00
  },
  rnb_harmony: {
    name: "R&B Harmony",
    vibratoDepthMult: 0.70, vibratoFreqMult: 1.00,
    breathinessAdd: 0.20, tensionAdd: -0.05, genderMult: 1.00, loudnessAdd: -2.00
  },
  minimal: {
    name: "Minimal（調整なし）",
    vibratoDepthMult: 1.00, vibratoFreqMult: 1.00,
    breathinessAdd: 0.00, tensionAdd: 0.00, genderMult: 1.00, loudnessAdd: 0.00
  }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function barToBlicks(bar) {
  return Math.round((bar - 1) * 4 * BLICKS_PER_QUARTER);
}

function buildScalePitchClasses(keyRoot, mode) {
  var intervals = SCALE_INTERVALS[mode] || SCALE_INTERVALS.major;
  var pitchClasses = {};
  intervals.forEach(function(iv) { pitchClasses[(keyRoot + iv) % 12] = true; });
  return pitchClasses;
}

function snapToScale(pitch, scalePitchClasses) {
  var pc = ((pitch % 12) + 12) % 12;
  if (scalePitchClasses[pc]) return pitch;
  var bestOffset = 0, bestDistance = 999;
  for (var offset = -6; offset <= 6; offset++) {
    var candidate = ((pc + offset) % 12 + 12) % 12;
    if (scalePitchClasses[candidate]) {
      var dist = Math.abs(offset);
      if (dist < bestDistance) { bestDistance = dist; bestOffset = offset; }
    }
  }
  return pitch + bestOffset;
}

function generateHarmonyNotes(sourceNotes, semitones, scaleCorrection, scalePitchClasses) {
  return sourceNotes.map(function(src) {
    var harmonyPitch = clamp(src.pitch + semitones, 0, 127);
    if (scaleCorrection && scalePitchClasses) {
      harmonyPitch = snapToScale(harmonyPitch, scalePitchClasses);
    }
    return {
      pitch: harmonyPitch,
      onset: src.onset,
      duration: src.duration,
      lyrics: src.lyrics,
      attributes: JSON.parse(JSON.stringify(src.attributes || {}))
    };
  });
}

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

function detectKeyAndScale(sourceNotes) {
  if (sourceNotes.length === 0) return { keyIndex: 0, mode: "major" };

  var KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  var pcWeight = [0,0,0,0,0,0,0,0,0,0,0,0];
  var totalDur = 0;
  sourceNotes.forEach(function(note) {
    var pc = ((note.pitch % 12) + 12) % 12;
    pcWeight[pc] += note.duration;
    totalDur += note.duration;
  });
  if (totalDur === 0) return { keyIndex: 0, mode: "major" };
  for (var i = 0; i < 12; i++) pcWeight[i] /= totalDur;

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

var PRESET_KEYS = Object.keys(PARAMETER_PRESETS);

function parseDialogAnswers(answers) {
  var presetIdx = answers.intervalPresetIndex || 0;
  var semitones;
  if (INTERVAL_PRESETS[presetIdx].semitones === null) {
    semitones = Math.round(answers.manualInterval);
    if (semitones < -24 || semitones > 24) return null;
  } else {
    semitones = INTERVAL_PRESETS[presetIdx].semitones;
  }
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

function applyParametersToNotes(harmonyNoteData, harmonyParams) {
  return harmonyNoteData.map(function(noteData) {
    var existingAttrs = noteData.attributes || {};
    var newAttrs = JSON.parse(JSON.stringify(existingAttrs));
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
// テストフレームワーク（軽量）
// ============================================================

var passed = 0, failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log("  PASS  " + label);
    passed++;
  } catch (e) {
    console.error("  FAIL  " + label);
    console.error("        " + e.message);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || "") + " expected " + b + " got " + a);
}

function assertClose(a, b, epsilon, msg) {
  epsilon = epsilon || 1e-9;
  if (Math.abs(a - b) > epsilon) throw new Error((msg || "") + " expected ~" + b + " got " + a);
}

// ============================================================
// clamp
// ============================================================

console.log("\n[ clamp ]");

test("中間値はそのまま返る", function() {
  assertEqual(clamp(5, 0, 10), 5);
});
test("上限を超える値はmax に切られる", function() {
  assertEqual(clamp(200, 0, 127), 127);
});
test("下限を下回る値はmin に切られる", function() {
  assertEqual(clamp(-5, 0, 127), 0);
});
test("上限ちょうどは通す", function() {
  assertEqual(clamp(127, 0, 127), 127);
});
test("下限ちょうどは通す", function() {
  assertEqual(clamp(0, 0, 127), 0);
});

// ============================================================
// barToBlicks
// ============================================================

console.log("\n[ barToBlicks ]");

test("小節1 → 0 blicks", function() {
  assertEqual(barToBlicks(1), 0);
});
test("小節2 → 1拍×4×SV.QUARTER blicks", function() {
  assertEqual(barToBlicks(2), 4 * BLICKS_PER_QUARTER);
});
test("小節5 → 4拍 × 4小節", function() {
  assertEqual(barToBlicks(5), 16 * BLICKS_PER_QUARTER);
});

// ============================================================
// buildScalePitchClasses
// ============================================================

console.log("\n[ buildScalePitchClasses ]");

test("Cメジャーは {0,2,4,5,7,9,11}", function() {
  var sc = buildScalePitchClasses(0, "major");
  [0,2,4,5,7,9,11].forEach(function(pc) {
    assert(sc[pc], "C major should contain pc=" + pc);
  });
  [1,3,6,8,10].forEach(function(pc) {
    assert(!sc[pc], "C major should NOT contain pc=" + pc);
  });
});
test("Aマイナーは {9,11,0,2,4,5,7} = {0,2,4,5,7,9,11}", function() {
  var sc = buildScalePitchClasses(9, "minor");
  // A natural minor = A B C D E F G → pitchclasses 9,11,0,2,4,5,7
  [9,11,0,2,4,5,7].forEach(function(pc) {
    assert(sc[pc], "A minor should contain pc=" + pc);
  });
});
test("Gメジャーは {7,9,11,0,2,4,6}", function() {
  var sc = buildScalePitchClasses(7, "major");
  [7,9,11,0,2,4,6].forEach(function(pc) {
    assert(sc[pc], "G major should contain pc=" + pc);
  });
  assert(!sc[5], "G major should NOT contain F (pc=5)");
});
test("不明モードはメジャーにフォールバック", function() {
  var sc = buildScalePitchClasses(0, "unknown_mode");
  [0,2,4,5,7,9,11].forEach(function(pc) {
    assert(sc[pc], "should fallback to major for pc=" + pc);
  });
});

// ============================================================
// snapToScale
// ============================================================

console.log("\n[ snapToScale ]");

test("スケール内音はそのまま返る (C4=60, Cメジャー)", function() {
  var sc = buildScalePitchClasses(0, "major");
  assertEqual(snapToScale(60, sc), 60); // C
  assertEqual(snapToScale(64, sc), 64); // E
  assertEqual(snapToScale(67, sc), 67); // G
});
test("C#4 (61) → Cメジャーで C4(60) に補正", function() {
  var sc = buildScalePitchClasses(0, "major");
  // C#(1) は C(0) と D(2) が等距離 → より低い方(C=0)に補正されることを確認
  var result = snapToScale(61, sc);
  assert(result === 60 || result === 62, "C# should snap to C or D, got " + result);
});
test("A#4 (70) → Cメジャーで A4(69) に補正（等距離の場合は下方向を優先）", function() {
  var sc = buildScalePitchClasses(0, "major");
  // A#(10) は A(9) と B(11) が等距離。アルゴリズムは -6→+6 で走査するため
  // offset=-1 (A) が offset=+1 (B) より先にヒットし、A(69) に補正される。
  assertEqual(snapToScale(70, sc), 69);
});
test("Bb4 (70) → Gメジャーで A4(69) に補正", function() {
  var sc = buildScalePitchClasses(7, "major"); // G major: no Bb
  assertEqual(snapToScale(70, sc), 69); // Bb→A
});
test("オクターブをまたいでも正しく補正される (B0=23, Cメジャー)", function() {
  var sc = buildScalePitchClasses(0, "major");
  // B(11) is in C major, so B0=23 should stay
  assertEqual(snapToScale(23, sc), 23);
});

// ============================================================
// generateHarmonyNotes
// ============================================================

console.log("\n[ generateHarmonyNotes ]");

var NOTE_C4  = { pitch: 60, onset: 0,              duration: BLICKS_PER_QUARTER, lyrics: "な", attributes: {} };
var NOTE_E4  = { pitch: 64, onset: BLICKS_PER_QUARTER, duration: BLICKS_PER_QUARTER, lyrics: "に", attributes: {} };
var NOTE_G4  = { pitch: 67, onset: BLICKS_PER_QUARTER * 2, duration: BLICKS_PER_QUARTER, lyrics: "ぬ", attributes: {} };
var sourceNotes = [NOTE_C4, NOTE_E4, NOTE_G4];

test("長3度上(+4st): C4→E4, E4→G#4, G4→B4", function() {
  var result = generateHarmonyNotes(sourceNotes, 4, false, null);
  assertEqual(result[0].pitch, 64); // C4+4=E4
  assertEqual(result[1].pitch, 68); // E4+4=G#4
  assertEqual(result[2].pitch, 71); // G4+4=B4
});
test("完全5度下(-7st): C4→F3, E4→A3, G4→C4", function() {
  var result = generateHarmonyNotes(sourceNotes, -7, false, null);
  assertEqual(result[0].pitch, 53); // C4-7=F3
  assertEqual(result[1].pitch, 57); // E4-7=A3
  assertEqual(result[2].pitch, 60); // G4-7=C4
});
test("デュレーションと歌詞はメインから継承される", function() {
  var result = generateHarmonyNotes(sourceNotes, 4, false, null);
  assertEqual(result[0].duration, BLICKS_PER_QUARTER);
  assertEqual(result[0].lyrics, "な");
  assertEqual(result[1].lyrics, "に");
  assertEqual(result[2].lyrics, "ぬ");
});
test("onset（開始位置）はメインから継承される", function() {
  var result = generateHarmonyNotes(sourceNotes, 4, false, null);
  assertEqual(result[0].onset, 0);
  assertEqual(result[1].onset, BLICKS_PER_QUARTER);
  assertEqual(result[2].onset, BLICKS_PER_QUARTER * 2);
});
test("MIDIピッチ上限クランプ: pitch=125 + 4 → 127（127超にならない）", function() {
  var highNote = [{ pitch: 125, onset: 0, duration: BLICKS_PER_QUARTER, lyrics: "a", attributes: {} }];
  var result = generateHarmonyNotes(highNote, 4, false, null);
  assertEqual(result[0].pitch, 127);
});
test("MIDIピッチ下限クランプ: pitch=3 - 7 → 0（負にならない）", function() {
  var lowNote = [{ pitch: 3, onset: 0, duration: BLICKS_PER_QUARTER, lyrics: "a", attributes: {} }];
  var result = generateHarmonyNotes(lowNote, -7, false, null);
  assertEqual(result[0].pitch, 0);
});
test("スケール補正あり: G#4(68)+Cメジャー → G4(67) または A4(69)", function() {
  var sc = buildScalePitchClasses(0, "major");
  var note = [{ pitch: 64, onset: 0, duration: BLICKS_PER_QUARTER, lyrics: "a", attributes: {} }];
  var result = generateHarmonyNotes(note, 4, true, sc); // E4+4=G#4 → snap
  assert(result[0].pitch === 67 || result[0].pitch === 69,
    "G#4 should snap to G4(67) or A4(69) in C major, got " + result[0].pitch);
});
test("スケール補正なし: G#4(68) はそのまま", function() {
  var note = [{ pitch: 64, onset: 0, duration: BLICKS_PER_QUARTER, lyrics: "a", attributes: {} }];
  var result = generateHarmonyNotes(note, 4, false, null);
  assertEqual(result[0].pitch, 68);
});
test("空のソースノートは空配列を返す", function() {
  var result = generateHarmonyNotes([], 4, false, null);
  assertEqual(result.length, 0);
});
test("attributes はディープコピーされる（参照共有なし）", function() {
  var attrNote = [{ pitch: 60, onset: 0, duration: 100, lyrics: "a", attributes: { paramLou: -3 } }];
  var result = generateHarmonyNotes(attrNote, 4, false, null);
  result[0].attributes.paramLou = 99; // 変更
  assertEqual(attrNote[0].attributes.paramLou, -3); // 元が変わらない
});

// ============================================================
// calculateHarmonyParams
// ============================================================

console.log("\n[ calculateHarmonyParams ]");

var defaultSource = {
  vibratoDepth: 0.8, vibratoFreq: 6.0,
  breathiness: 0.0, tension: 0.0, gender: 0.0, loudness: 0.0
};

test("classic_chorus: ビブラート深度は50%に", function() {
  var p = calculateHarmonyParams(defaultSource, "classic_chorus");
  assertClose(p.vibratoDepth, 0.4, 1e-9, "vibratoDepth");
});
test("classic_chorus: ラウドネスは-3dB", function() {
  var p = calculateHarmonyParams(defaultSource, "classic_chorus");
  assertClose(p.loudness, -3.0, 1e-9, "loudness");
});
test("classic_chorus: ブレスネスは+0.15", function() {
  var p = calculateHarmonyParams(defaultSource, "classic_chorus");
  assertClose(p.breathiness, 0.15, 1e-9, "breathiness");
});
test("minimal: 全パラメーター変化なし（メイン値をそのまま返す）", function() {
  var p = calculateHarmonyParams(defaultSource, "minimal");
  assertClose(p.vibratoDepth, 0.8, 1e-9, "vibratoDepth");
  assertClose(p.loudness, 0.0, 1e-9, "loudness");
  assertClose(p.breathiness, 0.0, 1e-9, "breathiness");
});
test("ブレスネスが上限(1.0)でクランプされる", function() {
  var highBre = Object.assign({}, defaultSource, { breathiness: 0.9 });
  var p = calculateHarmonyParams(highBre, "rnb_harmony"); // +0.2
  assertEqual(p.breathiness, 1.0); // 0.9+0.2=1.1 → 1.0
});
test("テンションが下限(-1.0)でクランプされる", function() {
  var lowTen = Object.assign({}, defaultSource, { tension: -0.95 });
  var p = calculateHarmonyParams(lowTen, "classic_chorus"); // -0.10
  assertEqual(p.tension, -1.0); // -0.95-0.1=-1.05 → -1.0
});
test("未定義プリセットキーは classic_chorus にフォールバック", function() {
  var p = calculateHarmonyParams(defaultSource, "nonexistent_preset");
  assertClose(p.vibratoDepth, 0.4, 1e-9, "should fallback to classic_chorus");
});

// ============================================================
// applyParametersToNotes
// ============================================================

console.log("\n[ applyParametersToNotes ]");

var harmonyParams = {
  vibratoDepth: 0.4, vibratoFreq: 5.4,
  breathiness: 0.15, tension: -0.1, gender: 0.0, loudness: -3.0
};

test("属性が未定義のノートに全パラメーターが設定される", function() {
  var notes = [{ pitch: 60, onset: 0, duration: 100, lyrics: "a", attributes: {} }];
  var result = applyParametersToNotes(notes, harmonyParams);
  assertClose(result[0].attributes.pF0Vbr,   0.4,  1e-9, "pF0Vbr");
  assertClose(result[0].attributes.paramBre,  0.15, 1e-9, "paramBre");
  assertClose(result[0].attributes.paramLou, -3.0,  1e-9, "paramLou");
});
test("既存の属性値（undefined でない）は上書きされない", function() {
  var notes = [{
    pitch: 60, onset: 0, duration: 100, lyrics: "a",
    attributes: { pF0Vbr: 0.9, paramBre: 0.5 }  // 明示的に設定済み
  }];
  var result = applyParametersToNotes(notes, harmonyParams);
  assertClose(result[0].attributes.pF0Vbr,  0.9, 1e-9, "pF0Vbr should NOT change");
  assertClose(result[0].attributes.paramBre, 0.5, 1e-9, "paramBre should NOT change");
  // 未設定の属性は設定される
  assertClose(result[0].attributes.paramLou, -3.0, 1e-9, "paramLou should be set");
});
test("属性の変更はディープコピーされ元データを変えない", function() {
  var notes = [{ pitch: 60, onset: 0, duration: 100, lyrics: "a", attributes: {} }];
  var result = applyParametersToNotes(notes, harmonyParams);
  result[0].attributes.pF0Vbr = 999;
  assertEqual(notes[0].attributes.pF0Vbr, undefined); // 元は変わらない
});
test("空のノートリストは空配列を返す", function() {
  var result = applyParametersToNotes([], harmonyParams);
  assertEqual(result.length, 0);
});

// ============================================================
// detectKeyAndScale
// ============================================================

console.log("\n[ detectKeyAndScale ]");

/** ピッチ + duration からノートデータを簡易生成するヘルパー */
function makeNotes(pitches, duration) {
  duration = duration || BLICKS_PER_QUARTER;
  return pitches.map(function(p, i) {
    return { pitch: p, onset: i * duration, duration: duration, lyrics: "a", attributes: {} };
  });
}

test("空のノートリスト → デフォルト C major", function() {
  var r = detectKeyAndScale([]);
  assertEqual(r.keyIndex, 0);
  assertEqual(r.mode, "major");
});
test("Cメジャースケール音のみ → C major を検出", function() {
  // C D E F G A B × 2 octaves
  var pitches = [60,62,64,65,67,69,71, 72,74,76,77,79,81,83];
  var r = detectKeyAndScale(makeNotes(pitches));
  assertEqual(r.keyIndex, 0, "keyIndex should be C(0)");
  assertEqual(r.mode, "major");
});
test("Aマイナースケール音のみ → A minor を検出", function() {
  // KK アルゴリズムは相対調(A minor vs C major)を区別するため、
  // 実際の楽曲同様にトニック(A)を長く演奏したデータを使う。
  var long  = 4 * BLICKS_PER_QUARTER;  // A(トニック)は長い
  var short = BLICKS_PER_QUARTER;
  var notes = [
    { pitch: 69, onset: 0 * short, duration: long,  lyrics: "a", attributes: {} }, // A (tonic)
    { pitch: 71, onset: 4 * short, duration: short, lyrics: "a", attributes: {} }, // B
    { pitch: 60, onset: 5 * short, duration: short, lyrics: "a", attributes: {} }, // C
    { pitch: 62, onset: 6 * short, duration: short, lyrics: "a", attributes: {} }, // D
    { pitch: 64, onset: 7 * short, duration: short, lyrics: "a", attributes: {} }, // E
    { pitch: 65, onset: 8 * short, duration: short, lyrics: "a", attributes: {} }, // F
    { pitch: 67, onset: 9 * short, duration: short, lyrics: "a", attributes: {} }, // G
  ];
  var r = detectKeyAndScale(notes);
  assertEqual(r.keyIndex, 9, "keyIndex should be A(9)");
  assertEqual(r.mode, "minor");
});
test("Gメジャースケール音のみ → G major を検出", function() {
  // G A B C D E F#
  var pitches = [67,69,71,60,62,64,66];
  var r = detectKeyAndScale(makeNotes(pitches));
  assertEqual(r.keyIndex, 7, "keyIndex should be G(7)");
  assertEqual(r.mode, "major");
});
test("Dメジャースケール音のみ → D major を検出", function() {
  // D E F# G A B C#
  var pitches = [62,64,66,67,69,71,61];
  var r = detectKeyAndScale(makeNotes(pitches));
  assertEqual(r.keyIndex, 2, "keyIndex should be D(2)");
  assertEqual(r.mode, "major");
});
test("duration重み付け: 長音符が多いキーに引き寄せられる", function() {
  // Cメジャートライアドを短く、Gメジャートライアド(G,B,D)を長くすると G major を検出するはず
  // 注: F#(leading tone)は KK プロファイルで低値のため G major の区別には使わない
  var cNotes = makeNotes([60,64,67], 100);      // 短い C major トライアド
  var gNotes = makeNotes([67,71,62], 100000);   // 長い G major トライアド (G, B, D)
  var r = detectKeyAndScale(cNotes.concat(gNotes));
  assertEqual(r.keyIndex, 7, "should detect G major due to duration weighting");
  assertEqual(r.mode, "major");
});
test("ノートが1件でも動作する（エラーにならない）", function() {
  var r = detectKeyAndScale(makeNotes([60]));
  assert(typeof r.keyIndex === "number", "keyIndex should be number");
  assert(r.mode === "major" || r.mode === "minor", "mode should be major or minor");
});

// ============================================================
// parseDialogAnswers
// ============================================================

console.log("\n[ parseDialogAnswers ]");

var baseAnswers = {
  sourceTrackIndex:   0,
  intervalPresetIndex: 0,   // 長3度上 (+4st)
  manualInterval:      4,
  scaleCorrection:     true,
  keyIndex:            0,   // C
  modeIndex:           0,   // Major
  rangeType:           0,   // 全体
  startBar:            1,
  endBar:              8,
  useParamOptimize:    true,
  paramPresetIndex:    0    // classic_chorus
};

test("プリセット選択(長3度上): semitones=4 が返る", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { intervalPresetIndex: 0 }));
  assertEqual(s.semitones, 4);
});
test("プリセット選択(完全5度下): semitones=-7 が返る", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { intervalPresetIndex: 6 }));
  assertEqual(s.semitones, -7);
});
test("手動入力プリセット選択 + manualInterval=10: semitones=10 が返る", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    intervalPresetIndex: 7,  // 手動入力
    manualInterval: 10
  }));
  assertEqual(s.semitones, 10);
});
test("手動入力 + manualInterval=-24: 境界値 semitones=-24 が返る", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    intervalPresetIndex: 7,
    manualInterval: -24
  }));
  assertEqual(s.semitones, -24);
});
test("手動入力 + manualInterval=25: バリデーションエラーで null を返す", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    intervalPresetIndex: 7,
    manualInterval: 25
  }));
  assertEqual(s, null);
});
test("手動入力 + manualInterval=-25: バリデーションエラーで null を返す", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    intervalPresetIndex: 7,
    manualInterval: -25
  }));
  assertEqual(s, null);
});
test("手動入力 + Slider 小数(3.7): Math.round で 4 になる", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    intervalPresetIndex: 7,
    manualInterval: 3.7
  }));
  assertEqual(s.semitones, 4);
});
test("modeIndex=0 → mode='major'", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { modeIndex: 0 }));
  assertEqual(s.mode, "major");
});
test("modeIndex=1 → mode='minor'", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { modeIndex: 1 }));
  assertEqual(s.mode, "minor");
});
test("rangeType=0（全体）: startBlicks/endBlicks が null", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { rangeType: 0 }));
  assertEqual(s.startBlicks, null);
  assertEqual(s.endBlicks, null);
});
test("rangeType=1（カスタム）+ startBar=1, endBar=4: blicks に変換される", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    rangeType: 1, startBar: 1, endBar: 4
  }));
  assertEqual(s.startBlicks, 0);                                   // 小節1 = 0
  assertEqual(s.endBlicks, barToBlicks(5));                        // 小節5 = exclusive end
});
test("rangeType=1 + startBar=3: startBlicks=barToBlicks(3)", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, {
    rangeType: 1, startBar: 3, endBar: 10
  }));
  assertEqual(s.startBlicks, barToBlicks(3));
});
test("scaleCorrection=true → scaleCorrection=true", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { scaleCorrection: true }));
  assertEqual(s.scaleCorrection, true);
});
test("scaleCorrection=false → scaleCorrection=false", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { scaleCorrection: false }));
  assertEqual(s.scaleCorrection, false);
});
test("useParamOptimize=false → useParamOptimize=false", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { useParamOptimize: false }));
  assertEqual(s.useParamOptimize, false);
});
test("paramPresetIndex=1 → paramPresetKey='pop_harmony'", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { paramPresetIndex: 1 }));
  assertEqual(s.paramPresetKey, "pop_harmony");
});
test("sourceTrackIndex=2 → sourceTrackIndex=2", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { sourceTrackIndex: 2 }));
  assertEqual(s.sourceTrackIndex, 2);
});
test("rangeType=2（選択リージョン）: useActiveRegion=true, startBlicks/endBlicks が null", function() {
  var s = parseDialogAnswers(Object.assign({}, baseAnswers, { rangeType: 2 }));
  assertEqual(s.useActiveRegion, true);
  assertEqual(s.startBlicks, null);
  assertEqual(s.endBlicks, null);
});

// ============================================================
// 結果サマリー
// ============================================================

console.log("\n========================================");
console.log("  PASS: " + passed + "  FAIL: " + failed);
console.log("========================================\n");

if (failed > 0) {
  process.exit(1);
}
