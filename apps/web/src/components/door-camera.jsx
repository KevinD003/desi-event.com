'use client'

/**
 * The door camera: looks for a pass, and hands over what it read.
 *
 * ## What it does with the camera
 *
 * - Nothing until the steward presses **Start camera**. No permission prompt
 *   on page load.
 * - Frames are drawn into one off-screen canvas, never attached to the page,
 *   decoded on this device, and overwritten by the next frame. None is
 *   uploaded, stored or kept. When the camera stops, the canvas is emptied.
 * - It stops — every track, not just the preview — when the steward presses
 *   **Stop camera**, when they switch to typing a code, when they leave the
 *   page, and when the page is hidden.
 * - It reads about five frames a second, downscaled, which is enough for a
 *   pass held up to a phone and cheap enough to leave running at a door.
 *
 * ## What it does with what it reads
 *
 * Hands a pass-shaped string to `onPass` and stops looking until the parent
 * says otherwise (`paused`). It never looks the ticket up, and never admits
 * anyone: a decode is a lookup request, the lookup is a preview, and admission
 * is a separate press of a separate button. A QR code that is not a pass — a
 * menu, a poster — is reported as such and never sent anywhere.
 *
 * @module components/door-camera
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from './ui.jsx'
import { decodeFrame } from '../lib/qr-decode.js'

/** Milliseconds between decode attempts. */
const FRAME_INTERVAL_MS = 200

/** The widest frame decoded, in pixels. Larger frames are scaled down. */
const MAX_FRAME_WIDTH = 640

/** How long the same pass is ignored after it was handed over, in milliseconds. */
const SAME_PASS_COOLDOWN_MS = 3_000

/**
 * What each camera state tells the steward.
 *
 * @type {Readonly<Record<string, string>>}
 */
const CAMERA_STATES = Object.freeze({
  idle: 'The camera is off.',
  starting: 'Starting the camera…',
  running: 'Camera on. Hold the pass steady in front of it.',
  paused: 'Camera on. Finish with this ticket to scan the next one.',
  denied:
    'Camera permission was refused. Allow the camera for this site in your browser settings, or type the printed code instead.',
  unavailable:
    'No camera could be started on this device — none is connected, or another app is using it. Type the printed code instead.',
  unsupported: 'This browser cannot use a camera here. Type the printed code instead.',
})

/**
 * Classify why `getUserMedia` refused.
 *
 * @param {unknown} error What it threw.
 * @returns {'denied'|'unavailable'} The state to show.
 */
function whyRefused(error) {
  const name = /** @type {{name?: string}} */ (error)?.name

  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
}

/**
 * @typedef {object} DoorCameraProps
 * @property {function(string): void} onPass Called with a pass read from a frame.
 * @property {function(): void} [onOther] Called when a QR code that is not a pass was read.
 * @property {boolean} paused Whether to stop looking for now.
 */

/**
 * The camera panel.
 *
 * @param {DoorCameraProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function DoorCamera({ onPass, onOther, paused }) {
  // Decided after mounting, not during render: the server has no navigator,
  // and a first render that differed between the two would not hydrate.
  const [state, setState] = useState('idle')
  const video = useRef(null)
  const stream = useRef(null)
  const canvas = useRef(null)
  const timer = useRef(null)
  const pausedRef = useRef(paused)
  const lastPass = useRef({ value: null, at: 0 })
  const handlers = useRef({ onPass, onOther })
  // Counts stops. A request for the camera remembers the count it started
  // under; if the count has moved on by the time the browser answers, the
  // steward stopped, switched to typing or left while it was asking.
  const stops = useRef(0)

  handlers.current = { onPass, onOther }
  pausedRef.current = paused

  const stop = useCallback(() => {
    stops.current += 1

    if (timer.current) clearTimeout(timer.current)
    timer.current = null

    for (const track of stream.current?.getTracks?.() ?? []) track.stop()
    stream.current = null

    if (video.current) video.current.srcObject = null

    // Nothing of the last frame survives the camera.
    if (canvas.current) {
      canvas.current.getContext('2d')?.clearRect(0, 0, canvas.current.width, canvas.current.height)
      canvas.current.width = 0
      canvas.current.height = 0
    }

    lastPass.current = { value: null, at: 0 }
    setState((current) => (current === 'running' || current === 'starting' ? 'idle' : current))
  }, [])

  useEffect(() => {
    if (!supported()) setState('unsupported')
  }, [])

  // Off when the page is hidden, and off when the panel goes away.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') stop()
    }

    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', stop)

    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [stop])

  /**
   * Decode one frame, then schedule the next.
   *
   * @returns {Promise<void>}
   */
  async function tick() {
    timer.current = null

    const element = video.current

    if (!stream.current || !element) return

    if (!pausedRef.current && element.readyState >= 2 && element.videoWidth > 0) {
      const scale = Math.min(1, MAX_FRAME_WIDTH / element.videoWidth)
      const width = Math.round(element.videoWidth * scale)
      const height = Math.round(element.videoHeight * scale)

      canvas.current ??= document.createElement('canvas')
      canvas.current.width = width
      canvas.current.height = height

      const context = canvas.current.getContext('2d', { willReadFrequently: true })

      context.drawImage(element, 0, 0, width, height)

      const found = await decodeFrame(context.getImageData(0, 0, width, height))
      const now = Date.now()

      if (found?.pass && stream.current && !pausedRef.current) {
        const repeat =
          found.pass === lastPass.current.value && now - lastPass.current.at < SAME_PASS_COOLDOWN_MS

        if (!repeat) {
          lastPass.current = { value: found.pass, at: now }
          handlers.current.onPass(found.pass)
        }
      } else if (found?.other) {
        handlers.current.onOther?.()
      }
    }

    if (stream.current) timer.current = setTimeout(tick, FRAME_INTERVAL_MS)
  }

  /**
   * Ask for the camera, on the steward's say-so.
   *
   * @returns {Promise<void>}
   */
  async function start() {
    if (!supported()) {
      setState('unsupported')

      return
    }

    setState('starting')

    const asked = stops.current

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })

      // Stopped while the browser was still asking: stop() found no stream to
      // turn off, so turn this one off now, and show and read nothing from it.
      if (stops.current !== asked) {
        for (const track of media?.getTracks?.() ?? []) track.stop()

        return
      }

      stream.current = media

      if (video.current) {
        video.current.srcObject = media
        // Some engines return nothing from play() rather than a promise.
        await Promise.resolve()
          .then(() => video.current?.play())
          .catch(() => {})
      }

      // Stopped while the preview was starting: stop() has already turned the
      // camera off, so do not say it is on or start reading frames.
      if (stops.current !== asked) return

      setState('running')
      timer.current = setTimeout(tick, FRAME_INTERVAL_MS)
    } catch (error) {
      stop()
      setState(whyRefused(error))
    }
  }

  const on = state === 'running'
  const shown = on && paused ? 'paused' : state

  return (
    <div>
      <p role="status" aria-live="polite" className="text-sm text-slate-700">
        {CAMERA_STATES[shown]}
      </p>

      {/* The preview only; nothing reads it but the decoder, and it is muted
          and inline so a phone does not take it full screen. */}
      <video
        ref={video}
        muted
        playsInline
        aria-label="Camera preview"
        className={
          on ? 'mt-3 aspect-video w-full max-w-md rounded-card bg-black object-cover' : 'hidden'
        }
      />

      <div className="mt-3 flex flex-wrap gap-3">
        {on ? (
          <Button type="button" variant="secondary" onClick={stop}>
            Stop camera
          </Button>
        ) : state !== 'unsupported' ? (
          <Button type="button" onClick={start} loading={state === 'starting'}>
            {state === 'denied' || state === 'unavailable'
              ? 'Try the camera again'
              : 'Start camera'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Whether this browser offers a camera API at all.
 *
 * @returns {boolean} True when `getUserMedia` exists.
 */
function supported() {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}
