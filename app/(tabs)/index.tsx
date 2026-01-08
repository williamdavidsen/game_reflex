import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  Text,
  Pressable,
  View,
  Dimensions,
  Vibration,
  Animated,
  StatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GAME_SECONDS = 30;

const START_SIZE = 80;
const MIN_SIZE = 38;

const STORAGE_KEY = "high_score_v1";

const VIB_HIT = 18;
const VIB_MISS_PATTERN = [0, 25, 30, 25];

type Pos = { x: number; y: number };

// ====== Stage ayarları (Skora göre) ======
type StageCfg = {
  name: string;
  glow: { a: string; b: string }; // arka plan glow renkleri
  fakeCount: number;
  fakeSize: number;
  comboWindowMs: number;
  shrinkPerHit: number;
};
const comboMultiplier = (combo: number) => Math.max(1, combo);

const STAGES: StageCfg[] = [
  {
    name: "STAGE 1",
    glow: { a: "rgba(255,82,82,0.18)", b: "rgba(120,169,255,0.14)" },
    fakeCount: 2,
    fakeSize: 56,
    comboWindowMs: 800,
    shrinkPerHit: 2,
  },
  {
    name: "STAGE 2",
    glow: { a: "rgba(255,179,71,0.18)", b: "rgba(130,250,170,0.12)" },
    fakeCount: 3,
    fakeSize: 54,
    comboWindowMs: 720,
    shrinkPerHit: 2,
  },
  {
    name: "STAGE 3",
    glow: { a: "rgba(140,120,255,0.18)", b: "rgba(255,82,200,0.12)" },
    fakeCount: 4,
    fakeSize: 52,
    comboWindowMs: 650,
    shrinkPerHit: 3,
  },
  {
    name: "STAGE 4",
    glow: { a: "rgba(90,210,255,0.16)", b: "rgba(255,82,82,0.12)" },
    fakeCount: 5,
    fakeSize: 50,
    comboWindowMs: 580,
    shrinkPerHit: 3,
  },
];

// Skor -> stage index (0..3)
function stageIndexFromScore(score: number) {
  if (score >= 180) return 3;
  if (score >= 120) return 2;
  if (score >= 50) return 1;
  return 0;
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <View
      style={{
        flexGrow: 1,
        minWidth: 86,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.07)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
      }}
    >
      <Text style={{ color: "rgba(255,255,255,0.68)", fontSize: 11 }}>{label}</Text>
      <Text style={{ color: "white", fontSize: 16, fontWeight: "900", marginTop: 3 }}>
        {value}
      </Text>
    </View>
  );
}

function SmallButton({
  title,
  onPress,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
}) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: isPrimary ? "white" : "rgba(255,255,255,0.10)",
        borderWidth: isPrimary ? 0 : 1,
        borderColor: "rgba(255,255,255,0.16)",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: isPrimary ? "#0B0F1A" : "white",
          fontSize: 14,
          fontWeight: "900",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export default function Index() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { width, height } = Dimensions.get("window");

  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);

  const [targetSize, setTargetSize] = useState(START_SIZE);
  const [targetPos, setTargetPos] = useState<Pos>({ x: 40, y: 260 });
  const [fakePos, setFakePos] = useState<Pos[]>([]);

  const [combo, setCombo] = useState(1);
  const [mult, setMult] = useState(1);
  const lastHitAtRef = useRef<number | null>(null);

  const [hudHeightFull, setHudHeightFull] = useState(0);
  const [hudHeightMini, setHudHeightMini] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Stage banner animasyonu
  const stageAnim = useRef(new Animated.Value(0)).current; // opacity
  const stageRef = useRef(0);

  // ✅ stage’i score’dan üret
  const stageIndex = useMemo(() => stageIndexFromScore(score), [score]);
  const stage = STAGES[stageIndex];

  // stage değiştiyse banner göster
  useEffect(() => {
    if (!running) return;
    if (stageRef.current === stageIndex) return;

    stageRef.current = stageIndex;
    stageAnim.setValue(0);
    Animated.sequence([
      Animated.timing(stageAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(520),
      Animated.timing(stageAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();

    // stage değişince hedefleri yeniden yerleştir
    setTimeout(() => spawnAll(targetSize), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIndex, running]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const n = raw ? Number(raw) : 0;
        setHighScore(Number.isFinite(n) ? n : 0);
      } catch {
        setHighScore(0);
      }
    })();
  }, []);

  const playPop = () => {
    scaleAnim.setValue(1);
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.14, duration: 70, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();
  };

  const activeHudHeight = running ? hudHeightMini : hudHeightFull;

  const playArea = () => {
    const sidePadding = 16;

    const top = Math.ceil(insets.top + activeHudHeight + 12);
    const bottom = Math.floor(height - (tabBarHeight + insets.bottom + 10));

    const minX = sidePadding;
    const maxX = Math.max(sidePadding, width - sidePadding);

    const minY = Math.min(top, bottom - 80);
    const maxY = Math.max(minY + 80, bottom);

    return { minX, maxX, minY, maxY };
  };

  const randPos = (size: number): Pos => {
    const { minX, maxX, minY, maxY } = playArea();
    const xMax = Math.max(minX, maxX - size);
    const yMax = Math.max(minY, maxY - size);

    const x = Math.floor(Math.random() * (xMax - minX + 1)) + minX;
    const y = Math.floor(Math.random() * (yMax - minY + 1)) + minY;

    return { x, y };
  };

  const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y);

  const spawnAll = (mainSize: number) => {
    const main = randPos(mainSize);

    const fakes: Pos[] = [];
    const minSep = 90;

    let guard = 0;
    while (fakes.length < stage.fakeCount && guard < 300) {
      guard++;
      const p = randPos(stage.fakeSize);
      const tooCloseToMain = dist(p, main) < minSep;
      const tooCloseToOther = fakes.some((q) => dist(q, p) < minSep);
      if (!tooCloseToMain && !tooCloseToOther) fakes.push(p);
    }

    setTargetPos(main);
    setFakePos(fakes);
  };

  const resetCombo = () => {
    setCombo(1);
    setMult(1);
    lastHitAtRef.current = null;
  };

  const startGame = () => {
    setScore(0);
    setTimeLeft(GAME_SECONDS);
    setTargetSize(START_SIZE);
    resetCombo();
    setRunning(true);

    stageRef.current = 0; // yeni oyun
    spawnAll(START_SIZE);
    setTimeout(() => spawnAll(START_SIZE), 0);
  };

  const stopGame = () => setRunning(false);

  const applyComboAndGetPoints = () => {
  const now = Date.now();
  const last = lastHitAtRef.current;

  let nextCombo = 1;
  if (last && now - last <= stage.comboWindowMs) nextCombo = combo + 1;
  else nextCombo = 1;

  lastHitAtRef.current = now;

  const nextMult = comboMultiplier(nextCombo); // ✅ stage.comboMultiplier DEĞİL
  setCombo(nextCombo);
  setMult(nextMult);

  return nextMult;
};

  const hitMain = () => {
    if (!running) return;
    Vibration.vibrate(VIB_HIT);
    playPop();

    const m = applyComboAndGetPoints();
    setScore((s) => s + m);

    setTargetSize((sz) => {
      const next = Math.max(MIN_SIZE, sz - stage.shrinkPerHit);
      spawnAll(next);
      return next;
    });
  };

  const hitFake = () => {
    if (!running) return;
    Vibration.vibrate(VIB_MISS_PATTERN);
    setScore((s) => Math.max(0, s - 1));
    resetCombo();
    spawnAll(targetSize);
  };

  useEffect(() => {
    if (!running) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((t) => t - 1);
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    if (timeLeft <= 0) setRunning(false);
  }, [timeLeft, running]);

  useEffect(() => {
    if (running) return;
    if (timeLeft === GAME_SECONDS) return;

    (async () => {
      if (score > highScore) {
        setHighScore(score);
        try {
          await AsyncStorage.setItem(STORAGE_KEY, String(score));
        } catch {}
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const showGameOver = !running && timeLeft !== GAME_SECONDS;
  const timeProgress = Math.max(0, Math.min(1, timeLeft / GAME_SECONDS));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B0F1A" }}>
      <StatusBar barStyle="light-content" />

      {/* ✅ Stage'e göre glow renkleri */}
      <View
        style={{
          position: "absolute",
          left: -120,
          top: -120,
          width: 260,
          height: 260,
          borderRadius: 260,
          backgroundColor: stage.glow.a,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: -160,
          top: 140,
          width: 320,
          height: 320,
          borderRadius: 320,
          backgroundColor: stage.glow.b,
        }}
      />

      {/* ===== HUD (FULL) - oyun dururken ===== */}
      {!running ? (
        <View
          onLayout={(e) => {
            const h = Math.ceil(e.nativeEvent.layout.height);
            if (h !== hudHeightFull) setHudHeightFull(h);
          }}
          style={{ paddingHorizontal: 16, paddingTop: 10 }}
        >
          <Text style={{ color: "white", fontSize: 26, fontWeight: "900" }}>
            Reflex Rush
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.65)", marginTop: 3 }}>
            Kırmızıya bas, gri tuzak.
          </Text>

          <BlurView
            intensity={26}
            tint="dark"
            style={{
              marginTop: 10,
              borderRadius: 20,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.16)",
            }}
          >
            <View style={{ padding: 12 }}>
              <View
                style={{
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.14)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${timeProgress * 100}%`,
                    backgroundColor: "rgba(255,255,255,0.78)",
                  }}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <StatPill label="SÜRE" value={`${timeLeft}s`} />
                <StatPill label="SKOR" value={score} />
                <StatPill label="REKOR" value={highScore} />
                <StatPill label="STAGE" value={stageIndex + 1} />
              </View>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <SmallButton title="Start" onPress={startGame} />
                <SmallButton
                  title="Reset Rekor"
                  variant="ghost"
                  onPress={async () => {
                    setHighScore(0);
                    try {
                      await AsyncStorage.setItem(STORAGE_KEY, "0");
                    } catch {}
                  }}
                />
              </View>

              {showGameOver ? (
                <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 10 }}>
                  Oyun bitti! Skor:{" "}
                  <Text style={{ color: "white", fontWeight: "900" }}>{score}</Text>
                </Text>
              ) : (
                <Text style={{ color: "rgba(255,255,255,0.6)", marginTop: 10, fontSize: 12 }}>
                  Zorluk skora göre artar: fake sayısı ↑, combo süresi ↓.
                </Text>
              )}
            </View>
          </BlurView>
        </View>
      ) : (
        // ===== HUD (MINI) - oyun sırasında =====
        <View
          onLayout={(e) => {
            const h = Math.ceil(e.nativeEvent.layout.height);
            if (h !== hudHeightMini) setHudHeightMini(h);
          }}
          style={{ paddingHorizontal: 16, paddingTop: 10 }}
        >
          <BlurView
            intensity={22}
            tint="dark"
            style={{
              borderRadius: 18,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
            }}
          >
            <View style={{ padding: 10 }}>
              <View
                style={{
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.14)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${timeProgress * 100}%`,
                    backgroundColor: "rgba(255,255,255,0.78)",
                  }}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <Text style={{ color: "rgba(255,255,255,0.8)", fontWeight: "800" }}>
                  {timeLeft}s
                </Text>

                <Text style={{ color: "white", fontWeight: "900" }}>Skor: {score}</Text>

                <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900" }}>
                  x{mult}
                </Text>

                <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "900" }}>
                  S{stageIndex + 1}
                </Text>

                <Pressable
                  onPress={stopGame}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    backgroundColor: "rgba(255,255,255,0.10)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.14)",
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>
                    Stop
                  </Text>
                </Pressable>
              </View>
            </View>
          </BlurView>
        </View>
      )}

      {/* ✅ Stage banner */}
      {running ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: insets.top + activeHudHeight + 18,
            left: 16,
            right: 16,
            opacity: stageAnim,
            transform: [
              {
                translateY: stageAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-8, 0],
                }),
              },
            ],
          }}
        >
          <View
            style={{
              alignSelf: "center",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.10)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.16)",
            }}
          >
            <Text style={{ color: "white", fontWeight: "900" }}>
              {stage.name} • Fake {stage.fakeCount} • {stage.comboWindowMs}ms
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Fake targets */}
      {running
        ? fakePos.map((p, i) => (
            <Pressable
              key={i}
              onPress={hitFake}
              style={{
                position: "absolute",
                left: p.x,
                top: p.y,
                width: stage.fakeSize,
                height: stage.fakeSize,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.10)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.16)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "900" }}>✕</Text>
            </Pressable>
          ))
        : null}

      {/* Main target */}
      {running ? (
        <Animated.View
          style={{
            position: "absolute",
            left: targetPos.x,
            top: targetPos.y,
            transform: [{ scale: scaleAnim }],
          }}
        >
          <Pressable
            onPress={hitMain}
            style={{
              width: targetSize,
              height: targetSize,
              borderRadius: 22,
              backgroundColor: "rgba(255,82,82,0.95)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.24)",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOpacity: 0.22,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
          >
            <Text style={{ color: "white", fontWeight: "900" }}>TAP</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}
