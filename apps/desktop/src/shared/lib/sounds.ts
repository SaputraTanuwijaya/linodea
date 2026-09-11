/**
 * UI sound playback.
 *
 * Sounds are played through a Web Audio gain node rather than the audio
 * element's own `volume`, because `volume` caps at 1.0 and the shipped ping is
 * mastered quiet enough that full element volume still read as "too silent"
 * (S84 feedback). Gain can go above 1, so the alert's presence level can
 * actually amplify it.
 *
 * The routing is only wired once the AudioContext is confirmed *running*:
 * `createMediaElementSource` redirects an element's output into the graph, so
 * wiring it while the context is suspended would silence the sound outright
 * instead of amplifying it. When Web Audio is unavailable or stays suspended
 * we fall back to plain element playback clamped to 1.0 — quieter than
 * requested, never silent.
 */

type UiSound = "captureError" | "notification";

const SOUND_SOURCES: Record<UiSound, string> = {
  captureError: "/sounds/error_notification.mp3",
  notification: "/sounds/ping.mp3",
};

/** Base level per sound, before the caller's multiplier. */
const SOUND_VOLUMES: Record<UiSound, number> = {
  captureError: 0.55,
  notification: 1,
};

const audioCache: Partial<Record<UiSound, HTMLAudioElement>> = {};
const gainCache: Partial<Record<UiSound, GainNode>> = {};

/** `undefined` = not attempted yet, `null` = unavailable in this webview. */
let sharedContext: AudioContext | null | undefined;

function audioContext(): AudioContext | null {
  if (sharedContext !== undefined) return sharedContext;
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!Ctor) {
    sharedContext = null;
    return null;
  }
  try {
    sharedContext = new Ctor();
  } catch {
    sharedContext = null;
  }
  return sharedContext;
}

/**
 * The gain node for `sound`, or null while amplification isn't safe to wire.
 * Never re-wires: `createMediaElementSource` may only be called once per
 * element.
 */
function amplifierFor(sound: UiSound, audio: HTMLAudioElement): GainNode | null {
  const cached = gainCache[sound];
  if (cached) return cached;

  const context = audioContext();
  if (!context) return null;
  if (context.state !== "running") {
    // Autoplay policy may hold the context suspended until a gesture. Ask, and
    // let a later play pick up the amplifier once it takes effect.
    void context.resume().catch(() => undefined);
    return null;
  }

  try {
    const gain = context.createGain();
    context.createMediaElementSource(audio).connect(gain);
    gain.connect(context.destination);
    gainCache[sound] = gain;
    return gain;
  } catch {
    return null;
  }
}

/**
 * Play a UI sound. `level` multiplies the sound's base volume — above 1 it
 * amplifies, which is how the alert's "insistent" presence gets louder than
 * the source file.
 */
export function playUiSound(sound: UiSound, level = 1) {
  const audio =
    audioCache[sound] ??
    Object.assign(new Audio(SOUND_SOURCES[sound]), { preload: "auto" });
  audioCache[sound] = audio;

  const target = SOUND_VOLUMES[sound] * level;
  const gain = amplifierFor(sound, audio);
  if (gain) {
    gain.gain.value = Math.max(0, target);
    audio.volume = 1;
  } else {
    audio.volume = Math.min(1, Math.max(0, target));
  }

  audio.pause();
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}
