import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RoomProvider } from '../store'
import { colors } from '../ui'

SplashScreen.setOptions({ duration: 500, fade: true })

export default function RootLayout () {
  return (
    <SafeAreaProvider>
      <RoomProvider>
        <StatusBar style='light' />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name='index' />
          <Stack.Screen name='room' options={{ gestureEnabled: false }} />
        </Stack>
      </RoomProvider>
    </SafeAreaProvider>
  )
}
