import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'

export const colors = {
  bg: '#0E0E18',
  card: '#16162A',
  card2: '#1C1C33',
  border: '#2A2A45',
  text: '#ECECF6',
  dim: '#A0A0BD',
  accent: '#818CF8',
  accentInk: '#0E0E18',
  accentSoft: '#23234A',
  mine: '#1F1F3D',
  mineLine: '#34346A',
  ok: '#4ADE80',
  live: '#FBBF24',
  danger: '#F87171',
  rec: '#DC2626'
}

const HUES = [252, 200, 160, 30, 340, 280, 120, 10, 190, 50]
export function avatarColor (name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return `hsl(${HUES[h % HUES.length]}, 62%, 55%)`
}

export function Avatar ({ name, size = 32 }: { name: string, size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(name) }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.44 }]}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

export function Card ({ children, style }: { children: ReactNode, style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Button ({ title, onPress, disabled, busy, kind = 'primary' }: { title: string, onPress: () => void, disabled?: boolean, busy?: boolean, kind?: 'primary' | 'secondary' }) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, kind === 'primary' ? s.primary : s.secondary, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' ? colors.accentInk : colors.text} /> : <Text style={[s.btnText, kind === 'primary' && { color: colors.accentInk }]}>{title}</Text>}
    </Pressable>
  )
}

export function Dot ({ tone }: { tone: 'ok' | 'live' | 'idle' }) {
  return <View style={[s.dot, { backgroundColor: tone === 'ok' ? colors.ok : tone === 'live' ? colors.live : colors.border }]} />
}

const s = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 }
})
