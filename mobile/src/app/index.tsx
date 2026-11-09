import { useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { langName, sortLangs } from '../lines'
import { useRoom } from '../store'
import { Button, Card, colors } from '../ui'

export default function Lobby () {
  const { langs, newCode, join } = useRoom()
  const [name, setName] = useState('')
  const [lang, setLang] = useState(langs.includes('en') ? 'en' : langs[0])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fresh () {
    setError(null)
    try { setCode(await newCode()) } catch (err: any) { setError(err?.message ?? String(err)) }
  }

  async function go () {
    setBusy(true)
    setError(null)
    try {
      await join(code, name, lang)
      router.push('/room')
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps='handled' keyboardDismissMode='interactive'>
          <View style={s.brand}>
            <Image source={require('../../assets/icon.png')} style={s.logo} />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Babel Room</Text>
              <Text style={s.sub}>Live captions across languages. No server: speech and translation run on this phone.</Text>
            </View>
          </View>

          <Card>
            <Text style={s.label}>Your name</Text>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder='Ana' placeholderTextColor={colors.dim} maxLength={40} autoCorrect={false} />

            <Text style={s.label}>I speak and read</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {sortLangs(langs).map((l) => (
                <Pressable key={l} onPress={() => setLang(l)} style={[s.chip, lang === l && s.chipOn]} accessibilityRole='radio' accessibilityState={{ selected: lang === l }}>
                  <Text style={[s.chipText, lang === l && { color: colors.accent }]}>{langName(l)}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={s.label}>Room code</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.input, s.mono, { flex: 1 }]} value={code} onChangeText={setCode} placeholder='petal-hollow-tern-bloom-23' placeholderTextColor={colors.dim} autoCapitalize='none' autoCorrect={false} />
              <View style={{ width: 80 }}><Button title='New' kind='secondary' onPress={() => { void fresh() }} /></View>
            </View>
            {error && <Text style={s.err}>{error}</Text>}
            <Button title={busy ? 'Finding the room…' : 'Join'} onPress={() => { void go() }} disabled={!name.trim() || !code.trim()} busy={busy} />
          </Card>

          <Card>
            <Text style={s.h2}>How it works</Text>
            <Text style={s.p}><Text style={s.b}>Hold to talk.</Text> Whisper turns your voice into text on this phone. Your audio never leaves it.</Text>
            <Text style={s.p}><Text style={s.b}>Only text is sent</Text>, straight to the others in the room over Hyperswarm: end-to-end encrypted, no server.</Text>
            <Text style={s.p}><Text style={s.b}>Everyone translates for themselves</Text> with Bergamot, so you read everyone in {langName(lang)}.</Text>
            <Text style={s.hint}>Laptops can join the same room with the Babel Room web UI or CLI.</Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  brand: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 4 },
  logo: { width: 52, height: 52, borderRadius: 13 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  sub: { color: colors.dim, fontSize: 14, lineHeight: 19 },
  label: { color: colors.dim, fontSize: 13, fontWeight: '600', marginBottom: -4 },
  input: { backgroundColor: colors.bg, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 14 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.text, fontSize: 14 },
  err: { color: colors.danger, fontSize: 14 },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700' },
  p: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  b: { color: colors.text, fontWeight: '700' },
  hint: { color: colors.dim, fontSize: 12.5 }
})
