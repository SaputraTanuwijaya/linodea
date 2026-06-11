type UiSound = "captureError" | "notification";

const SOUND_SOURCES: Record<UiSound, string> = {
  captureError: "/sounds/error_notification.mp3",
  notification: "/sounds/ping.mp3",
};

const SOUND_VOLUMES: Record<UiSound, number> = {
  captureError: 0.55,
  notification: 0.7,
};

const audioCache: Partial<Record<UiSound, HTMLAudioElement>> = {};

export function playUiSound(sound: UiSound) {
  const audio =
    audioCache[sound] ??
    Object.assign(new Audio(SOUND_SOURCES[sound]), {
      preload: "auto",
      volume: SOUND_VOLUMES[sound],
    });

  audioCache[sound] = audio;
  audio.pause();
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}
