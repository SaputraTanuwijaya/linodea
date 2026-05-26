/**
 * UI string registry + language preference.
 *
 * Mirrors the shape of `themes.ts`:
 *   - `LANGUAGES` is the registry consumed by the Settings picker.
 *   - Each language ships a flat `Strings` object indexed by dotted keys.
 *   - Persistence via localStorage at `linodea.language.v1`.
 *
 * To add a new language:
 *   1. Add a `LanguageDefinition` entry to `LANGUAGES`.
 *   2. Add a parallel `Strings` object to `STRINGS`.
 *   3. Widen the `LanguageId` union to include the new id.
 *
 * The language id matches the parser's `LangTag` ("en" | "id"), so the same
 * value can be passed to `parseReminder({ preferredLanguage })`.
 */

import type { LangTag } from "@linodea/parser";

export type LanguageId = LangTag;

export interface LanguageDefinition {
  id: LanguageId;
  name: string;
  description: string;
  /** Short bilingual-friendly sample shown on the picker card. */
  sample: string;
}

export interface Strings {
  menu: {
    capture: string;
    reminders: string;
    settings: string;
    hide: string;
    quit: string;
  };
  placeholder: string;
  preview: {
    saving: string;
    needsTime: string;
  };
  list: {
    queued: string;
    pending: (count: number) => string;
    loading: string;
    empty: string;
    done: string;
  };
  settings: {
    appearance: { title: string; hint: string };
    notifications: { title: string; hint: (max: number) => string };
    language: { title: string; hint: string };
  };
  themes: {
    dark: { name: string; description: string };
    light: { name: string; description: string };
  };
  prealerts: {
    addButton: string;
    emptyState: string;
    suffix: string;
    units: { D: string; H: string; M: string };
    valueLabel: string;
    unitLabel: string;
    removeLabel: string;
    /** Pure formatter: returns "1 day before" / "2 hours before" etc. */
    describe: (minutes: number) => string;
  };
  notificationBody: {
    /** Body for the T-due toast. */
    due: (title: string, when: string) => string;
    /** Body for prealert toasts. Takes minutes-of-lead so the formatter can localize the unit phrase. */
    prealert: (title: string, leadMinutes: number) => string;
  };
}

const STORAGE_KEY = "linodea.language.v1";
const DEFAULT_LANGUAGE: LanguageId = "en";

export const LANGUAGES: LanguageDefinition[] = [
  {
    id: "en",
    name: "English",
    description: "Interface in English. Parser breaks ties toward English.",
    sample: "tomorrow 7am tutoring with Kevin",
  },
  {
    id: "id",
    name: "Indonesian",
    description: "Antarmuka berbahasa Indonesia. Parser memilih kata Indonesia saat ragu.",
    sample: "besok jam 7 pagi les privat Kevin",
  },
];

const STRINGS: Record<LanguageId, Strings> = {
  en: {
    menu: {
      capture: "Quick capture",
      reminders: "Reminders",
      settings: "Settings",
      hide: "Hide",
      quit: "Quit",
    },
    placeholder: "tomorrow 7am tutoring with Kevin",
    preview: {
      saving: "Saving...",
      needsTime: 'Needs a time - try "in 30m" or "tomorrow 7am"',
    },
    list: {
      queued: "Queued",
      pending: (count) => (count === 1 ? "1 pending" : `${count} pending`),
      loading: "Loading...",
      empty: "No reminders queued.",
      done: "Done",
    },
    settings: {
      appearance: {
        title: "Appearance",
        hint: "Switch the look of the popup. New themes can be added later.",
      },
      notifications: {
        title: "Notifications",
        hint: (max) =>
          `Get reminded ahead of time. Up to ${max} prealerts; the reminder auto-marks done at its due time.`,
      },
      language: {
        title: "Language",
        hint: "Interface language and parser tie-break preference.",
      },
    },
    themes: {
      dark: { name: "Dark", description: "Default. Easy on the eyes for night capture." },
      light: { name: "Light", description: "Bright surface for daytime use." },
    },
    prealerts: {
      addButton: "+ Add prealert",
      emptyState: "No prealerts. Reminders will only fire at their due time.",
      suffix: "before due",
      units: { D: "Days", H: "Hours", M: "Minutes" },
      valueLabel: "Prealert value",
      unitLabel: "Prealert unit",
      removeLabel: "Remove prealert",
      describe: (minutes) => describeEnglish(minutes),
    },
    notificationBody: {
      due: (title, when) => `${title} - ${when}`,
      prealert: (title, leadMinutes) => `In ${leadEnglish(leadMinutes)}: ${title}`,
    },
  },
  id: {
    menu: {
      capture: "Tangkap cepat",
      reminders: "Pengingat",
      settings: "Pengaturan",
      hide: "Sembunyikan",
      quit: "Keluar",
    },
    placeholder: "besok jam 7 pagi les privat Kevin",
    preview: {
      saving: "Menyimpan...",
      needsTime: 'Butuh waktu - coba "30 menit lagi" atau "besok jam 7 pagi"',
    },
    list: {
      queued: "Antrean",
      pending: (count) => (count === 1 ? "1 menunggu" : `${count} menunggu`),
      loading: "Memuat...",
      empty: "Belum ada pengingat.",
      done: "Selesai",
    },
    settings: {
      appearance: {
        title: "Tampilan",
        hint: "Ganti tema popup. Tema baru bisa ditambah nanti.",
      },
      notifications: {
        title: "Notifikasi",
        hint: (max) =>
          `Dapat pengingat lebih awal. Maksimal ${max} pengingat awal; pengingat ditandai selesai otomatis saat waktunya tiba.`,
      },
      language: {
        title: "Bahasa",
        hint: "Bahasa antarmuka dan preferensi parser saat ada ambiguitas.",
      },
    },
    themes: {
      dark: { name: "Gelap", description: "Bawaan. Nyaman untuk malam hari." },
      light: { name: "Terang", description: "Permukaan cerah untuk siang hari." },
    },
    prealerts: {
      addButton: "+ Tambah pengingat awal",
      emptyState: "Tidak ada pengingat awal. Hanya muncul saat jatuh tempo.",
      suffix: "sebelum",
      units: { D: "Hari", H: "Jam", M: "Menit" },
      valueLabel: "Nilai pengingat awal",
      unitLabel: "Satuan pengingat awal",
      removeLabel: "Hapus pengingat awal",
      describe: (minutes) => describeIndonesian(minutes),
    },
    notificationBody: {
      due: (title, when) => `${title} - ${when}`,
      prealert: (title, leadMinutes) => `Dalam ${leadIndonesian(leadMinutes)}: ${title}`,
    },
  },
};

function leadEnglish(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0 && minutes >= MINUTES_PER_DAY) {
    const days = minutes / MINUTES_PER_DAY;
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (minutes % MINUTES_PER_HOUR === 0 && minutes >= MINUTES_PER_HOUR) {
    const hours = minutes / MINUTES_PER_HOUR;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 min" : `${minutes} min`;
}

function leadIndonesian(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0 && minutes >= MINUTES_PER_DAY) {
    return `${minutes / MINUTES_PER_DAY} hari`;
  }
  if (minutes % MINUTES_PER_HOUR === 0 && minutes >= MINUTES_PER_HOUR) {
    return `${minutes / MINUTES_PER_HOUR} jam`;
  }
  return `${minutes} menit`;
}

export function getStoredLanguage(): LanguageId {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isLanguageId(stored) ? stored : DEFAULT_LANGUAGE;
}

export function persistLanguage(language: LanguageId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, language);
}

export function applyLanguage(language: LanguageId): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

export function stringsFor(language: LanguageId): Strings {
  return STRINGS[language];
}

function isLanguageId(value: string | null): value is LanguageId {
  return value === "en" || value === "id";
}

// --- Offset descriptors per language ---------------------------------------

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;

function describeEnglish(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return minutes === 1 ? "1 min before" : `${minutes} min before`;
}

function describeIndonesian(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${days} hari sebelumnya`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return `${hours} jam sebelumnya`;
  }
  return `${minutes} menit sebelumnya`;
}
