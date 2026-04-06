import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/colors';

export default function LoginScreen() {
  const [mode, setMode]           = useState<'login' | 'signup'>('login');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError('נא למלא אימייל וסיסמה');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setError('נשלח אימייל אימות — אנא בדוק את תיבת הדואר שלך לפני הכניסה.');
        setLoading(false);
        return;
      }
    } catch (err: any) {
      setError(err.message ?? 'שגיאה לא ידועה');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>

        {/* Logo / title */}
        <View style={styles.logoRow}>
          <Ionicons name="restaurant" size={32} color={Colors.primary} />
          <Text style={styles.appName}>מתכונלי</Text>
        </View>
        <Text style={styles.subtitle}>
          {mode === 'login' ? 'כניסה לחשבון' : 'יצירת חשבון חדש'}
        </Text>

        {/* Fields */}
        <TextInput
          style={styles.input}
          placeholder="אימייל"
          placeholderTextColor={Colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textAlign="right"
        />
        <TextInput
          style={styles.input}
          placeholder="סיסמה"
          placeholderTextColor={Colors.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textAlign="right"
        />

        {/* Error / info message */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {mode === 'login' ? 'כניסה' : 'הרשמה'}
              </Text>
          }
        </TouchableOpacity>

        {/* Toggle mode */}
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(null); }}
        >
          <Text style={styles.toggleText}>
            {mode === 'login'
              ? 'אין לך חשבון עדיין? הירשם כאן'
              : 'יש לך חשבון? כנס כאן'}
          </Text>
        </TouchableOpacity>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 6,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: 10,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  toggleRow: {
    marginTop: 18,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500',
  },
});
