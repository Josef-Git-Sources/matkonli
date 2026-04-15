import {
  View,
  Text,
  Image,
  Modal,
  Alert,
  Share,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { fetchRecipeById, deleteRecipe, toggleFavorite } from '@/lib/api';
import type { RecipeDetail } from '@/lib/api';
import type { DifficultyLevel } from '@/types/database';

// ── Helpers ───────────────────────────────────────────────────

// ── Hebrew quantity helpers ───────────────────────────────────

/** Format a number cleanly: no trailing zeros, max 2 decimal places. */
function fmtNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * Multi-word Hebrew fraction phrases that must be checked before single-word
 * entries so "כוס וחצי" is caught before "חצי" alone.
 * Each entry: [hebrewPhrase, numericValue]
 */
const HEBREW_FRACTION_PHRASES: [string, number][] = [
  // Compound "N and a half" — must appear BEFORE standalone 'חצי'
  ['אחד וחצי',      1.5  ],
  ['אחת וחצי',      1.5  ],
  ['שניים וחצי',    2.5  ],
  ['שתיים וחצי',    2.5  ],
  ['שלושה וחצי',    3.5  ],
  ['שלוש וחצי',     3.5  ],
  // Unit-quantity compounds
  ['כוס וחצי',      1.5  ],
  ['שלושת רבעי',    0.75 ],
  ['שני שלישים',    0.667],
  // Standalone fractions
  ['חצי',           0.5  ],
  ['רבע',           0.25 ],
  ['שליש',          0.333],
  ['שלושה רבעים',   0.75 ],
];

/**
 * Unit words that imply a quantity of 1 when they appear at the start of an
 * ingredient string with no numeric prefix.
 */
const IMPLICIT_ONE_UNITS = [
  'קילו', 'כוס', 'כף', 'כפית', 'שן', 'חבילת', 'קופסת', 'מיכל',
  'חבילה', 'קופסה', 'צרור', 'ענף', 'פרוסת', 'פרוסה',
];

/**
 * Smart ingredient formatter:
 *  1. Multi-word Hebrew fractions  → numeric value × multiplier
 *  2. Single-word Hebrew fractions → numeric value × multiplier
 *  3. Numeric quantity (int / decimal / N/D fraction) → multiply in place
 *  4. Implicit-1 unit at start     → prepend scaled value when multiplier ≠ 1
 *  5. Fallback                     → return text unchanged
 */
function formatIngredient(text: string, multiplier: number): string {
  if (multiplier === 1) return text;

  // 1 & 2 — Hebrew fraction phrases (longest match first)
  for (const [phrase, value] of HEBREW_FRACTION_PHRASES) {
    const idx = text.indexOf(phrase);
    if (idx !== -1) {
      const result = fmtNum(value * multiplier);
      // Replace the phrase with the numeric result
      return text.slice(0, idx) + result + text.slice(idx + phrase.length);
    }
  }

  // 3 — Explicit numeric quantity (fraction N/D, decimal, integer)
  const numericRe = /(\d+\/\d+|\d+\.?\d*)/;
  if (numericRe.test(text)) {
    return text.replace(numericRe, (match) => {
      let value: number;
      if (match.includes('/')) {
        const [num, den] = match.split('/').map(Number);
        value = num / den;
      } else {
        value = parseFloat(match);
      }
      return fmtNum(value * multiplier);
    });
  }

  // 4 — Implicit "1": unit word at start with no preceding number
  for (const unit of IMPLICIT_ONE_UNITS) {
    if (text.startsWith(unit)) {
      return `${fmtNum(multiplier)} ${text}`;
    }
  }

  // 5 — Fallback: nothing to scale
  return text;
}

const MULTIPLIER_OPTIONS: { label: string; value: number }[] = [
  { label: 'חצי', value: 0.5 },
  { label: 'רגיל', value: 1 },
  { label: 'כפול', value: 2 },
  { label: 'פי 3',  value: 3 },
];

const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  easy:   'קל',
  medium: 'בינוני',
  hard:   'קשה',
};

const DIFFICULTY_COLOR: Record<DifficultyLevel, string> = {
  easy:   '#2A7E4F',
  medium: '#E8901A',
  hard:   '#C0392B',
};

// ── Timer helpers ─────────────────────────────────────────────

type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

function formatTime(totalSecs: number): string {
  const s = Math.max(0, totalSecs);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${String(sec).padStart(2, '0')}`
  );
}

/**
 * Plays 3 short beeps on web via AudioContext, or vibrates on native.
 * Fails silently if AudioContext is unavailable.
 */
function playTimerAlert() {
  if (Platform.OS === 'web') {
    try {
      const ACtx =
        (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!ACtx) return;
      const ctx = new ACtx() as AudioContext;
      for (let i = 0; i < 3; i++) {
        const t   = ctx.currentTime + i * 0.65;
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.frequency.value = 880;
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
      }
    } catch { /* AudioContext not available */ }
  } else {
    Vibration.vibrate([0, 300, 150, 300, 150, 600]);
  }
}

// ── Screen ────────────────────────────────────────────────────

const SCREEN = Dimensions.get('window');

export default function RecipeDetailScreen() {
  const { id }    = useLocalSearchParams<{ id: string }>();
  const router    = useRouter();
  const [recipe, setRecipe]                 = useState<RecipeDetail | null>(null);
  const [isLoading, setIsLoading]           = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  useKeepAwake();

  const [imageModalOpen, setImageModalOpen]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting]               = useState(false);
  const [multiplier, setMultiplier]               = useState(1);

  // ── Timer state ──────────────────────────────────────────────
  const [timerTotal,  setTimerTotal]  = useState(0);           // user-set duration (seconds)
  const [timerLeft,   setTimerLeft]   = useState(0);           // remaining seconds
  const [timerStatus, setTimerStatus] = useState<TimerStatus>('idle');
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishCbRef   = useRef<() => void>(() => {});
  const pulseAnim     = useRef(new Animated.Value(1)).current;
  const pulseLoopRef  = useRef<Animated.CompositeAnimation | null>(null);

  async function handleToggleFavorite() {
    if (!recipe) return;
    const newValue = !recipe.is_favorite;
    // Optimistic update
    setRecipe(prev => prev ? { ...prev, is_favorite: newValue } : prev);
    try {
      await toggleFavorite(recipe.id, newValue);
    } catch {
      // Revert on failure
      setRecipe(prev => prev ? { ...prev, is_favorite: !newValue } : prev);
    }
  }

  async function handleShare() {
    if (!recipe) return;

    const lines: string[] = [];

    lines.push(`🍳 *${recipe.title}* 🍳`);

    if (recipe.description) {
      lines.push('', recipe.description);
    }

    if (recipe.ingredients.length > 0) {
      lines.push('', '🛒 *מצרכים:*');
      for (const ing of recipe.ingredients) {
        lines.push(`- ${ing.name}`);
      }
    }

    if (recipe.instructions.length > 0) {
      lines.push('', '👨‍🍳 *שלבי הכנה:*');
      for (const step of recipe.instructions) {
        lines.push(`${step.step}. ${step.text}`);
      }
    }

    lines.push('', 'בתאבון! 😊');

    await Share.share({ message: lines.join('\n') });
  }

  async function executeDelete() {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    try {
      await deleteRecipe(id!);
      router.replace('/');
    } catch (err: any) {
      setIsDeleting(false);
      Alert.alert('שגיאה', err.message ?? 'שגיאה במחיקת המתכון');
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      fetchRecipeById(id)
        .then(setRecipe)
        .catch(() => setError('שגיאה בטעינת המתכון'))
        .finally(() => setIsLoading(false));
    }, [id])
  );

  // Seed the timer from prep_time once (only while idle and not yet set)
  useEffect(() => {
    if (recipe?.prep_time && timerStatus === 'idle' && timerTotal === 0) {
      const secs = recipe.prep_time * 60;
      setTimerTotal(secs);
      setTimerLeft(secs);
    }
  }, [recipe?.prep_time, timerStatus, timerTotal]);

  // Run / pause the countdown interval based on timerStatus
  useEffect(() => {
    if (timerStatus === 'running') {
      intervalRef.current = setInterval(() => {
        setTimerLeft(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            finishCbRef.current();   // always calls the latest version
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [timerStatus]);

  // Keep the finish callback ref up-to-date (avoids stale closure inside setInterval)
  finishCbRef.current = useCallback(() => {
    setTimerStatus('finished');
    playTimerAlert();
    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 380, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0,  duration: 380, useNativeDriver: true }),
      ])
    );
    pulseLoopRef.current.start();
    Alert.alert('⏰ הטיימר הסתיים!', 'זמן הבישול הסתיים. בתאבון! 😊', [{ text: 'סגור' }]);
  }, [pulseAnim]);

  function timerAdjust(deltaSecs: number) {
    if (timerStatus !== 'idle') return;
    const next = Math.max(0, Math.min(359999, timerTotal + deltaSecs)); // max 99:59:59
    setTimerTotal(next);
    setTimerLeft(next);
  }

  function timerStart() {
    if (timerLeft <= 0) return;
    pulseLoopRef.current?.stop();
    pulseAnim.setValue(1);
    setTimerStatus('running');
  }

  function timerPause() {
    setTimerStatus('paused');
  }

  function timerReset() {
    pulseLoopRef.current?.stop();
    pulseAnim.setValue(1);
    setTimerStatus('idle');
    setTimerLeft(timerTotal);
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.topBarButton}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={26} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {recipe?.title ?? ''}
        </Text>
        <View style={styles.topBarActions}>
          {recipe && !isDeleting ? (
            <>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleShare}
                activeOpacity={0.7}
              >
                <Ionicons name="share-social-outline" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleToggleFavorite}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={recipe.is_favorite ? 'heart' : 'heart-outline'}
                  size={22}
                  color={recipe.is_favorite ? '#E74C3C' : Colors.textPrimary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={() => router.push(`/recipe/edit/${id}`)}
                activeOpacity={0.7}
              >
                <Ionicons name="pencil-outline" size={22} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={() => setShowDeleteConfirm(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={22} color="#C0392B" />
              </TouchableOpacity>
            </>
          ) : isDeleting ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <View style={{ width: 34 }} />
          )}
        </View>
      </View>

      {/* ── Sticky timer bar (visible whenever timer is not idle) ── */}
      {timerStatus !== 'idle' && (
        <View style={[
          styles.timerStickyBar,
          timerStatus === 'paused'   && styles.timerStickyBarPaused,
          timerStatus === 'finished' && styles.timerStickyBarFinished,
        ]}>
          <Ionicons name="timer-outline" size={14} color="#fff" />
          <Text style={styles.timerStickyTime}>
            {timerStatus === 'finished' ? '00:00:00' : formatTime(timerLeft)}
          </Text>
          <Text style={styles.timerStickyLabel}>
            {timerStatus === 'running'  ? ' · פעיל'   :
             timerStatus === 'paused'   ? ' · מושהה'  :
             ' · ⏰ הסתיים!'}
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error || !recipe ? (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error ?? 'המתכון לא נמצא'}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Delete confirmation modal ── */}
          <Modal
            visible={showDeleteConfirm}
            transparent
            animationType="fade"
            onRequestClose={() => setShowDeleteConfirm(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>מחיקת מתכון</Text>
                <Text style={styles.confirmMessage}>האם אתה בטוח שברצונך למחוק מתכון זה?</Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={styles.confirmCancelBtn}
                    onPress={() => setShowDeleteConfirm(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.confirmCancelText}>ביטול</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmDeleteBtn}
                    onPress={executeDelete}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.confirmDeleteText}>מחק</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* ── Hero image ── */}
          {recipe.image_url ? (
            <TouchableOpacity onPress={() => setImageModalOpen(true)} activeOpacity={0.9}>
              <Image source={{ uri: recipe.image_url }} style={styles.heroImage} resizeMode="cover" />
              <View style={styles.heroZoomHint}>
                <Ionicons name="expand-outline" size={18} color="#fff" />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="image-outline" size={48} color={Colors.border} />
            </View>
          )}

          {/* ── Fullscreen image modal ── */}
          <Modal
            visible={imageModalOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setImageModalOpen(false)}
            statusBarTranslucent
          >
            <View style={styles.modalBackdrop}>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setImageModalOpen(false)} activeOpacity={0.8}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <ScrollView
                contentContainerStyle={styles.modalScrollContent}
                maximumZoomScale={4}
                minimumZoomScale={1}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                centerContent
              >
                <Image
                  source={{ uri: recipe.image_url }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
              </ScrollView>
            </View>
          </Modal>

          {/* ── Title ── */}
          <Text style={styles.title}>{recipe.title}</Text>

          {/* ── Meta strip ── */}
          <View style={styles.metaRow}>
            {recipe.difficulty ? (
              <View style={[
                styles.difficultyBadge,
                {
                  backgroundColor: DIFFICULTY_COLOR[recipe.difficulty] + '1A',
                  borderColor:     DIFFICULTY_COLOR[recipe.difficulty] + '55',
                },
              ]}>
                <Text style={[styles.difficultyText, { color: DIFFICULTY_COLOR[recipe.difficulty] }]}>
                  {DIFFICULTY_LABEL[recipe.difficulty]}
                </Text>
              </View>
            ) : null}

            {recipe.prep_time ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaText}>{recipe.prep_time} דקות</Text>
                <Ionicons name="time-outline" size={15} color={Colors.textSecondary} />
              </View>
            ) : null}

            {recipe.categories.length > 0 ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaText}>{recipe.categories.map(c => c.name_he).join('، ')}</Text>
                <Ionicons name="pricetag-outline" size={15} color={Colors.textSecondary} />
              </View>
            ) : null}
          </View>

          {/* ── Cooking mode badge ── */}
          <View style={styles.cookingBadge}>
            <Ionicons name="sunny-outline" size={13} color={Colors.primary} />
            <Text style={styles.cookingBadgeText}>מצב בישול פעיל — המסך לא יכבה</Text>
          </View>

          {/* ── Description ── */}
          {recipe.description ? (
            <View style={styles.section}>
              <Text style={styles.descriptionText}>{recipe.description}</Text>
            </View>
          ) : null}

          {/* ── Cooking Timer ── */}
          <View style={styles.section}>
            {/* Header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>טיימר בישול</Text>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                {timerStatus !== 'idle' && (
                  <View style={[
                    styles.timerBadge,
                    timerStatus === 'running'  && styles.timerBadgeRunning,
                    timerStatus === 'paused'   && styles.timerBadgePaused,
                    timerStatus === 'finished' && styles.timerBadgeFinished,
                  ]}>
                    <Text style={[
                      styles.timerBadgeText,
                      timerStatus === 'running'  && { color: '#2A7E4F' },
                      timerStatus === 'paused'   && { color: '#E8901A' },
                      timerStatus === 'finished' && { color: '#C0392B' },
                    ]}>
                      {timerStatus === 'running' ? 'פעיל' : timerStatus === 'paused' ? 'מושהה' : 'הסתיים'}
                    </Text>
                  </View>
                )}
                <Ionicons name="timer-outline" size={20} color={Colors.primary} />
              </View>
            </View>

            {/* Large countdown display */}
            <Animated.View style={[styles.timerDisplayWrap, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={[
                styles.timerDisplay,
                timerStatus === 'running'  && styles.timerDisplayRunning,
                timerStatus === 'finished' && styles.timerDisplayFinished,
              ]}>
                {formatTime(timerLeft)}
              </Text>
            </Animated.View>

            {/* Adjustment buttons — only when idle */}
            {timerStatus === 'idle' && (
              <View style={styles.timerAdjRow}>
                {[
                  // Array order is reversed visually by row-reverse.
                  // Index 0 → rightmost (+1h), last index → leftmost (-1h).
                  { label: '+1h', delta:  3600 },
                  { label: '+5m', delta:   300 },
                  { label: '+1m', delta:    60 },
                  { label: '+30s',delta:    30 },
                  { label: '-30s',delta:   -30 },
                  { label: '-1m', delta:   -60 },
                  { label: '-5m', delta:  -300 },
                  { label: '-1h', delta: -3600 },
                ].map(({ label, delta }) => (
                  <TouchableOpacity
                    key={label}
                    style={styles.timerAdjBtn}
                    onPress={() => timerAdjust(delta)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.timerAdjBtnText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.timerCtrlRow}>
              {(timerStatus === 'idle' || timerStatus === 'paused') && (
                <TouchableOpacity
                  style={[
                    styles.timerCtrlBtn, styles.timerCtrlBtnStart,
                    timerLeft === 0 && styles.timerCtrlBtnDisabled,
                  ]}
                  onPress={timerStart}
                  disabled={timerLeft === 0}
                  activeOpacity={0.8}
                >
                  <Ionicons name="play" size={16} color="#fff" />
                  <Text style={styles.timerCtrlBtnText}>
                    {timerStatus === 'paused' ? 'המשך' : 'התחל'}
                  </Text>
                </TouchableOpacity>
              )}

              {timerStatus === 'running' && (
                <TouchableOpacity
                  style={[styles.timerCtrlBtn, styles.timerCtrlBtnPause]}
                  onPress={timerPause}
                  activeOpacity={0.8}
                >
                  <Ionicons name="pause" size={16} color={Colors.textPrimary} />
                  <Text style={[styles.timerCtrlBtnText, { color: Colors.textPrimary }]}>השהה</Text>
                </TouchableOpacity>
              )}

              {timerStatus !== 'idle' && (
                <TouchableOpacity
                  style={[styles.timerCtrlBtn, styles.timerCtrlBtnReset]}
                  onPress={timerReset}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={16} color={Colors.textSecondary} />
                  <Text style={[styles.timerCtrlBtnText, { color: Colors.textSecondary }]}>אפס</Text>
                </TouchableOpacity>
              )}
            </View>

            {timerStatus === 'finished' && (
              <View style={styles.timerFinishedBanner}>
                <Text style={styles.timerFinishedText}>⏰ הטיימר הסתיים! בתאבון! 😊</Text>
              </View>
            )}
          </View>

          {/* ── Ingredients ── */}
          {recipe.ingredients.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader icon="nutrition-outline" title="מצרכים" />

              {/* Multiplier row */}
              <View style={styles.multiplierRow}>
                {MULTIPLIER_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.multiplierBtn,
                      multiplier === opt.value && styles.multiplierBtnActive,
                    ]}
                    onPress={() => setMultiplier(opt.value)}
                    activeOpacity={0.75}
                  >
                    <Text style={[
                      styles.multiplierBtnText,
                      multiplier === opt.value && styles.multiplierBtnTextActive,
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {recipe.ingredients.map((ing, i) => (
                <View key={ing.id ?? i} style={styles.bulletRow}>
                  <Text style={styles.bulletText}>{formatIngredient(ing.name, multiplier)}</Text>
                  <Text style={styles.bullet}>•</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── Steps ── */}
          {recipe.instructions.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader icon="list-outline" title="שלבי הכנה" />
              {recipe.instructions.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <Text style={styles.stepText}>{step.text}</Text>
                  <View style={styles.stepNumberBadge}>
                    <Text style={styles.stepNumber}>{step.step}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.versionLabel}>v1.16.2</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Ionicons name={icon} size={20} color={Colors.primary} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  topBarButton: {
    padding: 4,
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
    marginHorizontal: 8,
  },
  topBarActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },

  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 15,
    color: '#C0392B',
    textAlign: 'center',
  },

  scrollContent: {
    paddingBottom: 40,
  },

  heroImage: {
    width: '100%',
    height: 300,
  },
  heroZoomHint: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    padding: 6,
  },
  heroPlaceholder: {
    width: '100%',
    height: 140,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  // ── Delete confirm modal ──
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  confirmBox: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 21,
  },
  confirmButtons: {
    flexDirection: 'row-reverse',
    gap: 12,
    width: '100%',
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: '#C0392B',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmDeleteText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmCancelText: {
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },

  // ── Image modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 52,
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 22,
    padding: 8,
  },
  modalScrollContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalImage: {
    width: SCREEN.width,
    height: SCREEN.height,
  },

  // ── Header block ──
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'right',
    marginBottom: 12,
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  metaRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 18,
  },
  metaItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  difficultyBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  difficultyText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Cooking mode badge ──
  cookingBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 5,
    marginHorizontal: 18,
    marginBottom: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cookingBadgeText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
  },

  // ── Sections ──
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    marginHorizontal: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  descriptionText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'right',
    lineHeight: 23,
  },

  // ── Ingredient bullets ──
  bulletRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  bullet: {
    fontSize: 16,
    color: Colors.primary,
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  // ── Steps ──
  stepRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stepNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'right',
    lineHeight: 22,
  },

  // ── Multiplier ──
  multiplierRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginBottom: 14,
  },
  multiplierBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  multiplierBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  multiplierBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  multiplierBtnTextActive: {
    color: '#fff',
  },

  versionLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: '#C0C0C0',
    marginTop: 16,
  },

  // ── Sticky timer bar ──────────────────────────────────────────
  timerStickyBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2A7E4F',
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  timerStickyBarPaused:   { backgroundColor: '#E8901A' },
  timerStickyBarFinished: { backgroundColor: '#C0392B' },
  timerStickyTime: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  timerStickyLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
  },

  // ── Timer section card internals ──────────────────────────────
  timerDisplayWrap: {
    alignItems: 'center',
    marginVertical: 12,
  },
  timerDisplay: {
    fontSize: 48,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 2,
  },
  timerDisplayRunning:  { color: '#2A7E4F' },
  timerDisplayFinished: { color: '#C0392B' },

  timerBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  timerBadgeRunning:  { backgroundColor: '#2A7E4F15', borderColor: '#2A7E4F80' },
  timerBadgePaused:   { backgroundColor: '#E8901A15', borderColor: '#E8901A80' },
  timerBadgeFinished: { backgroundColor: '#C0392B15', borderColor: '#C0392B80' },
  timerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  timerAdjRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  timerAdjBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  timerAdjBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  timerCtrlRow: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  timerCtrlBtn: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  timerCtrlBtnStart:    { backgroundColor: Colors.primary },
  timerCtrlBtnPause:    { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  timerCtrlBtnReset:    { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  timerCtrlBtnDisabled: { opacity: 0.4 },
  timerCtrlBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  timerFinishedBanner: {
    marginTop: 12,
    backgroundColor: '#C0392B12',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C0392B40',
  },
  timerFinishedText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C0392B',
    textAlign: 'center',
  },
});
