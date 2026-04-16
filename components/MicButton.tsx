import { TouchableOpacity, View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

/** Small microphone button for speech-to-text fields. Turns red while recording. */
export function MicButton({
  isActive,
  onPress,
  showCrown = false,
}: {
  isActive:   boolean;
  onPress:    () => void;
  showCrown?: boolean;
}) {
  return (
    <View style={styles.btnWrap}>
      <TouchableOpacity
        style={[styles.btn, isActive && styles.btnActive]}
        onPress={onPress}
        activeOpacity={0.75}
        hitSlop={6}
      >
        <Ionicons
          name={isActive ? 'mic' : 'mic-outline'}
          size={18}
          color={isActive ? '#fff' : Colors.textSecondary}
        />
      </TouchableOpacity>
      {showCrown && !isActive && (
        <Text style={styles.crown}>👑</Text>
      )}
    </View>
  );
}

/** Non-intrusive banner shown at the bottom of the screen for speech errors. */
export function SpeechToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.toast} pointerEvents="none">
      <Ionicons name="alert-circle-outline" size={16} color="#fff" />
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btnWrap: {
    position: 'relative',
  },
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 6,
  },
  btnActive: {
    backgroundColor: '#E74C3C',
    borderColor: '#E74C3C',
  },
  crown: {
    position: 'absolute',
    top: -2,
    right: -4,
    fontSize: 10,
    lineHeight: 12,
  },

  toast: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(30,30,30,0.92)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 999,
  },
  toastText: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    textAlign: 'right',
  },
});
