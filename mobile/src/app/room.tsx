import { useEffect, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { langName, routeLabel, type Line } from '../lines'
import { useRoom } from '../store'
import { TalkButton } from '../TalkButton'
import { Avatar, colors, Dot } from '../ui'

export default function RoomScreen () {
  const { room, peers, lines, models, say, leave } = useRoom()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const list = useRef<FlatList<Line>>(null)

  useEffect(() => { if (!room) router.replace('/') }, [room])
  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50) }, [lines])
  if (!room) return null

  function send () {
    const t = draft.trim()
    if (!t) return
    say(t)
    setDraft('')
  }

  const translating = models.filter((m) => m.state !== 'ready')
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.top}>
          <Pressable onPress={() => { void Share.share({ message: room.code }) }} style={s.code} accessibilityRole='button' accessibilityLabel='Share the room code'>
            <Text style={s.codeText} numberOfLines={1}>{room.code}</Text>
            <Text style={s.codeHint}>tap to share</Text>
          </Pressable>
          <Pressable onPress={() => { void leave().then(() => router.replace('/')) }} style={s.leave} accessibilityRole='button'>
            <Text style={s.leaveText}>Leave</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.people} style={{ flexGrow: 0 }}>
          <View style={s.person}><Avatar name={room.name} size={26} /><Text style={s.personText}>{room.name} · {langName(room.lang)}</Text></View>
          {peers.map((p) => (
            <View key={p.id} style={s.person}><Avatar name={p.name} size={26} /><Text style={s.personText}>{p.name} · {langName(p.lang)}</Text></View>
          ))}
          {peers.length === 0 && <Text style={s.waiting}>Waiting for others to join with this code…</Text>}
        </ScrollView>

        <FlatList
          ref={list}
          data={lines}
          keyExtractor={(l) => String(l.id)}
          renderItem={({ item }) => <Bubble line={item} me={room.lang} />}
          contentContainerStyle={s.feed}
          ListEmptyComponent={<Text style={s.empty}>You&apos;re in. Hold the button to talk, or type. Captions from others appear here in {langName(room.lang)}.</Text>}
          keyboardDismissMode='interactive'
        />

        <View style={s.statusRow}>
          {translating.length > 0
            ? translating.map((m) => (
              <View key={m.key} style={s.statusItem}><Dot tone='live' /><Text style={s.statusText}>{langName(m.key.split('>')[0])} → {langName(m.key.split('>')[1])}{m.download != null ? ` ${m.download}%` : '…'}</Text></View>
            ))
            : models.length > 0 && <View style={s.statusItem}><Dot tone='ok' /><Text style={s.statusText}>Translating on this phone · {models.length} model{models.length > 1 ? 's' : ''} ready</Text></View>}
        </View>
        {status && <Text style={s.err}>{status}</Text>}

        <View style={s.composer}>
          <TalkButton lang={room.lang} onText={say} onStatus={setStatus} />
          <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder={`Type in ${langName(room.lang)}…`} placeholderTextColor={colors.dim} onSubmitEditing={send} returnKeyType='send' maxLength={1000} />
          <Pressable onPress={send} disabled={!draft.trim()} style={[s.send, !draft.trim() && { opacity: 0.4 }]} accessibilityRole='button'>
            <Text style={s.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Bubble ({ line, me }: { line: Line, me: string }) {
  if (line.system) return <Text style={s.sys}>{line.text}</Text>
  const route = routeLabel(line, me)
  return (
    <View style={[s.row, line.self && s.rowSelf]}>
      {!line.self && <Avatar name={line.name} size={30} />}
      <View style={[s.bubble, line.self && s.bubbleSelf]}>
        <View style={s.head}>
          <Text style={s.name}>{line.self ? 'You' : line.name}</Text>
          {route && <Text style={s.route}>{route}</Text>}
        </View>
        <Text style={s.said}>{line.text}</Text>
        {line.original !== line.text && <Text style={s.orig}>{line.original}</Text>}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  code: { flex: 1, backgroundColor: colors.accentSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  codeText: { color: colors.accent, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontWeight: '700', fontSize: 14 },
  codeHint: { color: colors.dim, fontSize: 11 },
  leave: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  leaveText: { color: colors.text, fontWeight: '700' },
  people: { paddingHorizontal: 14, gap: 8, paddingBottom: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderRadius: 999, paddingVertical: 4, paddingLeft: 4, paddingRight: 11, borderWidth: 1, borderColor: colors.border },
  personText: { color: colors.text, fontSize: 13 },
  waiting: { color: colors.dim, fontSize: 13, alignSelf: 'center' },
  feed: { padding: 14, gap: 12, flexGrow: 1 },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 40, fontSize: 15, lineHeight: 21, paddingHorizontal: 20 },
  sys: { alignSelf: 'center', color: colors.dim, fontSize: 12, backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 8, maxWidth: '88%' },
  rowSelf: { alignSelf: 'flex-end' },
  bubble: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8, flexShrink: 1 },
  bubbleSelf: { backgroundColor: colors.mine, borderColor: colors.mineLine, borderTopLeftRadius: 14, borderTopRightRadius: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: colors.text, fontWeight: '700', fontSize: 13 },
  route: { color: colors.accent, backgroundColor: colors.accentSoft, fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  said: { color: colors.text, fontSize: 17, lineHeight: 23, marginTop: 2 },
  orig: { color: colors.dim, fontSize: 13, fontStyle: 'italic', marginTop: 4 },
  statusRow: { paddingHorizontal: 14, gap: 4 },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { color: colors.dim, fontSize: 12 },
  err: { color: colors.danger, fontSize: 13, paddingHorizontal: 14, paddingTop: 4 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.card, color: colors.text, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  send: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  sendText: { color: colors.accentInk, fontWeight: '800' }
})
