// Copies each block of microphone samples to the page, which resamples to
// 16 kHz and sends it to the local Babel Room server for Whisper.
class PcmCapture extends AudioWorkletProcessor {
  process (inputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
