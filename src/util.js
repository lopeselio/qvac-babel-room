// Small helpers shared by the CLI, the translator and the web UI server.

/** Tiny promise queue: run tasks one after another, in order. */
export class Serial {
  constructor () { this.tail = Promise.resolve() }
  run (fn) {
    const p = this.tail.then(fn, fn)
    this.tail = p.catch(() => {})
    return p
  }
}

/**
 * QVAC's model cache locks a file while it downloads it. A second process (two
 * Babel Rooms on one computer) loading the same model at that moment fails with
 * "File descriptor could not be locked"; waiting and retrying then succeeds.
 */
export async function retryLocked (fn, { attempts = 8, delayMs = 1500, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= attempts || !/could not be locked/i.test(String(err?.message))) throw err
      await sleep(delayMs * i)
    }
  }
}

/** One transcript line in Markdown, the same for the CLI and the web UI. */
export function transcriptLine (line, when = new Date(line.at)) {
  const t = when.toTimeString().slice(0, 8)
  if (line.system) return `- \`${t}\` _${line.text}_`
  const extra = line.original !== line.text ? ` _(${line.lang}: ${line.original})_` : ''
  return `- \`${t}\` **${line.name}**: ${line.text}${extra}`
}
