/**
 * UI string registry — interface, EN + ID tables, and accessor.
 *
 * Lives in `shared/i18n` because every feature consumes it. Per-feature
 * string sections (settings.startup, prealerts, etc.) live here for now to
 * keep EN and ID in lockstep — splitting strings across features comes later
 * if the file gets unwieldy.
 *
 * Parameterized strings are functions so the formatter can localize unit
 * phrases (`1 day` vs `1 hari`).
 *
 * Adding a language: add a parallel `Strings` object to `STRINGS`, widen the
 * `LanguageId` union, and register the language definition in
 * `features/language`.
 */

import type { LangTag } from "@linodea/parser";

/** Language id. Matches the parser's LangTag so it can be threaded through. */
export type LanguageId = LangTag;

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
    startup: { title: string; hint: string };
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
  startup: {
    toggleLabel: string;
    toggleHint: string;
    unavailable: string;
  };
}

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;

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
      startup: {
        title: "Startup",
        hint: "Launch Linodea when you sign in so reminders keep firing without opening it manually.",
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
    startup: {
      toggleLabel: "Launch on startup",
      toggleHint: "Linodea starts hidden in the tray and waits for the global shortcut.",
      unavailable: "Available only in the desktop app.",
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
      startup: {
        title: "Saat dimulai",
        hint: "Jalankan Linodea otomatis saat masuk agar pengingat tetap aktif tanpa perlu dibuka manual.",
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
    startup: {
      toggleLabel: "Jalankan saat startup",
      toggleHint: "Linodea berjalan tersembunyi di tray dan menunggu pintasan global.",
      unavailable: "Hanya tersedia di aplikasi desktop.",
    },
  },
};

export function stringsFor(language: LanguageId): Strings {
  return STRINGS[language];
}

// --- Lead-time formatters (used by notificationBody.prealert) --------------

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

// --- Offset descriptors per language (used by prealerts.describe) ----------

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
