import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from 'expo-audio'
import { File } from 'expo-file-system'
import { transcribe } from './engine'
import { colors } from './ui'

// Hold to talk: record while pressed, then Whisper (QVAC, on this phone) turns
// it into text that is said in the room. The recording is deleted afterwards.
//
// Lessons from Pocket Tune's voice input on iOS: Expo's standard AAC preset
// (iOS rejects some custom rates), a fresh recorder per take (one made before
// the session allowed recording records silence), and metering to catch a
// silent microphone before Whisper sees it.

const RECORDING: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }
const SILENCE_DB = -50

type Phase = 'idle' | 'recording' | 'transcribing'

export function TalkButton ({ lang, onText, onStatus }: { lang: string, onText: (t: string) => void, onStatus: (msg: string | null) => void }) {
  const recorder = useAudioRecorder(RECORDING)
  const rec = useAudioRecorderState(recorder, 100)
  const [phase, setPhase] = useState<Phase>('idle')
  const peak = useRef<number | null>(null)
  const pressed = useRef(false)
  if (phase === 'recording' && typeof rec.metering === 'number') peak.current = Math.max(peak.current ?? -Infinity, rec.metering)

  useEffect(() => () => { try { if (recorder.isRecording) void recorder.stop() } catch {} }, [recorder])

  async function start () {
    pressed.current = true
    if (phase !== 'idle') return
    onStatus(null)
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) return onStatus('Microphone access is off. Turn it on in Settings → Babel Room.')
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync(RECORDING)
    peak.current = null
    recorder.record()
    setPhase('recording')
    if (!pressed.current) void stop() // released while the recorder was preparing
  }

  async function stop () {
    pressed.current = false
    if (!recorder.isRecording) return
    const seconds = recorder.getStatus().durationMillis / 1000
    await recorder.stop().catch(() => {})
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {})
    const uri = recorder.uri
    const discard = () => { try { if (uri) new File(uri).delete() } catch {} }
    if (!uri || seconds < 0.5) { discard(); setPhase('idle'); return onStatus('Hold the button while you speak.') }
    if (peak.current !== null && peak.current < SILENCE_DB) {
      discard()
      setPhase('idle')
      return onStatus("The microphone only heard silence. Speak close to the phone (it's off while the phone is mirrored to a Mac).")
    }
    setPhase('transcribing')
    try {
      const text = await transcribe(uri, lang, (st) => {
        if (st.state === 'downloading') onStatus(`Downloading Whisper ${st.download ?? 0}%…`)
        else if (st.state === 'loading') onStatus('Loading Whisper…')
        else onStatus(null)
      })
      if (text) onText(text)
      else onStatus("Didn't catch any words. Try again a little louder.")
    } catch (err: any) {
      onStatus(`Speech recognition failed: ${err?.message ?? err}`)
    } finally {
      discard()
      setPhase('idle')
    }
  }

  const level = phase === 'recording' && typeof rec.metering === 'number' ? Math.max(0, Math.min(1, (rec.metering + 60) / 60)) : 0
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Hold to talk'
      onPressIn={() => { void start() }}
      onPressOut={() => { void stop() }}
      disabled={phase === 'transcribing'}
      style={[s.btn, phase === 'recording' && s.on, phase === 'transcribing' && { opacity: 0.6 }]}
    >
      <View style={[s.ring, { transform: [{ scale: 1 + level * 0.35 }] }, phase === 'recording' && { borderColor: colors.rec }]}>
        <View style={[s.dot, phase === 'recording' && s.dotOn]} />
      </View>
      <Text style={s.label}>{phase === 'recording' ? `${Math.floor(rec.durationMillis / 1000)}s · release` : phase === 'transcribing' ? 'Writing…' : 'Hold'}</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  btn: { width: 76, alignItems: 'center', gap: 4 },
  on: {},
  ring: { width: 54, height: 54, borderRadius: 27, borderWidth: 3, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card2 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.rec },
  dotOn: { borderRadius: 6 },
  label: { color: colors.dim, fontSize: 11, fontWeight: '600' }
})
