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
import type { Recurrence } from "@linodea/types";

/** Language id. Matches the parser's LangTag so it can be threaded through. */
export type LanguageId = LangTag;

export interface Strings {
  menu: {
    capture: string;
    reminders: string;
    chains: string;
    settings: string;
    hide: string;
    quit: string;
  };
  /** Confirmation shown before actually quitting (reminders stop when quit). */
  quitConfirm: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
  };
  /** First-run prompt asking to enable launch-on-boot (recommended yes). */
  autostartPrompt: {
    title: string;
    body: string;
    enable: string;
    notNow: string;
  };
  /** Confirmation shown before turning OFF launch-on-startup in Settings. */
  disableAutostartConfirm: {
    title: string;
    body: string;
    keepOn: string;
    turnOff: string;
  };
  placeholders: readonly string[];
  preview: {
    saving: string;
    needsTime: string;
  };
  list: {
    queued: string;
    pending: (count: number) => string;
    missed: string;
    overdue: string;
    missedCount: (count: number) => string;
    loading: string;
    empty: string;
    done: string;
    snooze: string;
    dismiss: string;
    edit: string;
    delete: string;
    save: string;
    cancel: string;
    editPlaceholder: string;
    snooze10m: string;
    snooze1h: string;
    snoozeTomorrow: string;
  };
  chain: {
    queued: string;
    empty: string;
    setCategory: string;
    clear: string;
  };
  category: {
    university: string;
    investing: string;
    personal: string;
    tutoring: string;
    urgent: string;
    waiting: string;
    uncategorized: string;
  };
  settings: {
    appearance: { title: string; hint: string };
    notifications: { title: string; hint: (max: number) => string };
    language: { title: string; hint: string };
    startup: { title: string; hint: string };
    ai: { title: string; hint: string };
    updates: { title: string; hint: string };
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
  update: {
    notCheckedYet: string;
    checking: string;
    upToDate: string;
    downloading: (version: string) => string;
    ready: (version: string) => string;
    installing: string;
    error: string;
    unavailable: string;
    currentVersion: (version: string) => string;
    checkButton: string;
    installButton: string;
    /** Tooltip on the ••• badge dot. */
    badgeLabel: string;
  };
  ai: {
    fallbackLabel: string;
    fallbackHint: string;
    unavailable: string;
    providerLabel: string;
    providerHint: string;
    recommended: string;
    comingLater: string;
    configured: string;
    notConfigured: string;
    manageConnection: string;
    hideConnection: string;
    connectionStored: string;
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    keyStored: string;
    saveAndTest: string;
    testing: string;
    removeKey: string;
    modelLabel: string;
    refreshModels: string;
    fast: string;
    fastHint: string;
    setupGuide: string;
    setupTitle: string;
    setupSteps: readonly [string, string, string];
    setupNote: string;
    showSetup: string;
    hideSetup: string;
    privacy: string;
    understanding: string;
    assisted: string;
    confirm: string;
    unsupported: string;
    errors: {
      invalidKey: string;
      quota: string;
      timeout: string;
      network: string;
      model: string;
      generic: string;
    };
  };
  /** Slash-command autocomplete: per-command label + description shown in the dropdown. */
  slash: {
    menuTitle: string;
    menuHint: string;
    countdown: { label: string; description: string };
    recur: { label: string; description: string };
    link: { label: string; description: string };
    ai: { label: string; description: string };
    list: { label: string; description: string };
    chain: { label: string; description: string };
    settings: { label: string; description: string };
  };
  /** /link anchor picker (phase 2 of the dropdown) + the bound-anchor chip. */
  link: {
    pickHeader: string;
    noMatch: string;
    hint: string;
    chipClear: string;
  };
  /** On-screen countdown timer window. */
  timer: {
    caption: string;
    dismiss: string;
  };
  recurrence: {
    /** Human summary of a repeat rule, e.g. "every Monday ×6" / "tiap hari". */
    describe: (rule: Recurrence) => string;
  };
}

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;

const STRINGS: Record<LanguageId, Strings> = {
  en: {
    menu: {
      capture: "Quick capture",
      reminders: "Reminders",
      chains: "Chains",
      settings: "Settings",
      hide: "Hide",
      quit: "Quit",
    },
    quitConfirm: {
      title: "Quit Linodea?",
      body: "Reminders only fire while Linodea is running. If you quit, you won't be notified until you open it again. Closing the window keeps it running in the tray.",
      confirm: "Quit anyway",
      cancel: "Keep running",
    },
    autostartPrompt: {
      title: "Start Linodea automatically?",
      body: "Linodea can only remind you while it's running. Start it automatically when you sign in so your reminders keep working after a restart. Recommended — you can change this any time in Settings.",
      enable: "Yes, start on boot",
      notNow: "Not now",
    },
    disableAutostartConfirm: {
      title: "Turn off launch on startup?",
      body: "Linodea only reminds you while it's running. If it doesn't start automatically, your reminders won't fire after a restart until you open it yourself. You can turn this back on any time.",
      keepOn: "Keep it on",
      turnOff: "Turn off anyway",
    },
    placeholders: [
      "in 20m check the oven",
      "tomorrow 9am call the dentist",
      "in 2 hours pick up the laundry",
      "in 3 days at 10am pay the electricity bill",
    ],
    preview: {
      saving: "Saving...",
      needsTime: 'Needs a time - try "in 30m" or "tomorrow 7am"',
    },
    list: {
      queued: "Queued",
      pending: (count) => (count === 1 ? "1 pending" : `${count} pending`),
      missed: "Missed",
      overdue: "Overdue",
      missedCount: (count) => (count === 1 ? "1 missed" : `${count} missed`),
      loading: "Loading...",
      empty: "No reminders queued.",
      done: "Done",
      snooze: "Snooze",
      dismiss: "Dismiss",
      edit: "Edit",
      delete: "Delete",
      save: "Save",
      cancel: "Cancel",
      editPlaceholder: "Edit reminder text",
      snooze10m: "+10 min",
      snooze1h: "+1 hour",
      snoozeTomorrow: "Tomorrow 9am",
    },
    chain: {
      queued: "Chains",
      empty: "No reminders yet. Capture a few and they'll group here by category.",
      setCategory: "Change category",
      clear: "Clear completed",
    },
    category: {
      university: "University",
      investing: "Investing",
      personal: "Personal",
      tutoring: "Tutoring",
      urgent: "Urgent",
      waiting: "Waiting",
      uncategorized: "Uncategorized",
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
      ai: {
        title: "AI Assist",
        hint: "Optional Gemini fallback for unusual time phrases the local parser cannot resolve.",
      },
      updates: {
        title: "Updates",
        hint: "Linodea checks for a newer version shortly after it starts and always asks before installing.",
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
    update: {
      notCheckedYet: "Not checked yet this session.",
      checking: "Checking for updates...",
      upToDate: "You're on the latest version.",
      downloading: (version) => `Downloading version ${version}...`,
      ready: (version) => `Version ${version} is ready to install.`,
      installing: "Installing... Linodea will restart.",
      error: "Couldn't check for updates. Check your connection and try again.",
      unavailable: "Available only in the installed desktop app.",
      currentVersion: (version) => `Current version ${version}`,
      checkButton: "Check for updates",
      installButton: "Restart to update",
      badgeLabel: "An update is ready to install",
    },
    ai: {
      fallbackLabel: "Use AI when local parsing fails",
      fallbackHint: "Normal reminders stay instant and offline. Gemini is contacted only as a fallback.",
      unavailable: "Available only in the installed desktop app.",
      providerLabel: "Provider",
      providerHint: "Gemini is recommended for its generous free tier. OpenAI and Anthropic support are planned.",
      recommended: "recommended",
      comingLater: "coming later",
      configured: "Connected",
      notConfigured: "Not connected",
      manageConnection: "Manage connection",
      hideConnection: "Hide connection",
      connectionStored: "The API key is stored securely by your operating system.",
      apiKeyLabel: "Gemini API key",
      apiKeyPlaceholder: "Paste a Google AI Studio API key",
      keyStored: "Key stored securely by the operating system",
      saveAndTest: "Save & test",
      testing: "Testing...",
      removeKey: "Remove key",
      modelLabel: "Model",
      refreshModels: "Refresh models",
      fast: "fast",
      fastHint: "Flash or Fast models are recommended for a quicker capture experience.",
      setupGuide: "Visit this page to create a Gemini API key, then paste it below:",
      setupTitle: "How to get a free Gemini API key",
      setupSteps: [
        "Open Google AI Studio and sign in with your Google account.",
        "Choose Create API key. The Gemini free tier is enough to try AI Assist.",
        "Copy the key, return to Linodea, then paste it into the API key field.",
      ],
      setupNote: "Your key is stored by the operating system, not in Linodea's reminder database. Google may use free-tier requests to improve its products, so avoid sensitive reminder text.",
      showSetup: "Show setup guide",
      hideSetup: "Hide setup guide",
      privacy: "Only a failed reminder phrase, current time, timezone, and parser issue codes are sent to Gemini. Reminder history stays local.",
      understanding: "Understanding with Gemini...",
      assisted: "AI assisted",
      confirm: "Press Enter again to save",
      unsupported: "Gemini could not safely resolve that phrase.",
      errors: {
        invalidKey: "Gemini rejected this API key.",
        quota: "The Gemini quota or rate limit was reached.",
        timeout: "Gemini took too long to respond.",
        network: "Could not reach Gemini.",
        model: "Choose another Gemini model and test again.",
        generic: "AI Assist could not complete the request.",
      },
    },
    slash: {
      menuTitle: "Commands",
      menuHint: "Arrow keys to navigate · Enter to select",
      countdown: {
        label: "/countdown",
        description: "Keep exact-second timing and show an on-screen countdown.",
      },
      recur: {
        label: "/recur",
        description: "Repeat a reminder — e.g. every monday 8am, every 2 days 9am ×5.",
      },
      link: {
        label: "/link",
        description: "Attach to a reminder — time counts from it (e.g. 30m before, 1 jam after).",
      },
      ai: {
        label: "/ai",
        description: "Open AI Assist setup, API key, and model selection.",
      },
      list: {
        label: "/list",
        description: "Open the reminders list.",
      },
      chain: {
        label: "/chain",
        description: "Open the chain view of linked reminders.",
      },
      settings: {
        label: "/settings",
        description: "Open Settings (theme, language, prealerts, startup).",
      },
    },
    link: {
      pickHeader: "Link to which reminder?",
      noMatch: "No reminders to link to yet.",
      hint: "before = prep, after = follow-up",
      chipClear: "Remove link",
    },
    timer: {
      caption: "Countdown",
      dismiss: "Dismiss timer",
    },
    recurrence: {
      describe: (rule) => describeRecurrenceEnglish(rule),
    },
  },
  id: {
    menu: {
      capture: "Tangkap cepat",
      reminders: "Pengingat",
      chains: "Rantai",
      settings: "Pengaturan",
      hide: "Sembunyikan",
      quit: "Keluar",
    },
    quitConfirm: {
      title: "Keluar dari Linodea?",
      body: "Pengingat hanya berbunyi selama Linodea berjalan. Jika keluar, kamu tidak akan diingatkan sampai membukanya lagi. Menutup jendela tetap membiarkannya berjalan di tray.",
      confirm: "Tetap keluar",
      cancel: "Biarkan berjalan",
    },
    autostartPrompt: {
      title: "Jalankan Linodea otomatis?",
      body: "Linodea hanya bisa mengingatkanmu selama berjalan. Jalankan otomatis saat kamu masuk agar pengingat tetap bekerja setelah restart. Disarankan — bisa diubah kapan saja di Pengaturan.",
      enable: "Ya, jalankan saat boot",
      notNow: "Nanti saja",
    },
    disableAutostartConfirm: {
      title: "Matikan jalan otomatis saat startup?",
      body: "Linodea hanya mengingatkanmu selama berjalan. Jika tidak jalan otomatis, pengingat tidak akan berbunyi setelah restart sampai kamu membukanya sendiri. Bisa diaktifkan lagi kapan saja.",
      keepOn: "Biarkan aktif",
      turnOff: "Tetap matikan",
    },
    placeholders: [
      "20 menit lagi cek oven",
      "besok jam 9 telepon dokter gigi",
      "2 jam lagi ambil cucian",
      "lusa jam 10 bayar tagihan listrik",
    ],
    preview: {
      saving: "Menyimpan...",
      needsTime: 'Butuh waktu - coba "30 menit lagi" atau "besok jam 7 pagi"',
    },
    list: {
      queued: "Antrean",
      pending: (count) => (count === 1 ? "1 menunggu" : `${count} menunggu`),
      missed: "Terlewat",
      overdue: "Terlambat",
      missedCount: (count) => (count === 1 ? "1 terlewat" : `${count} terlewat`),
      loading: "Memuat...",
      empty: "Belum ada pengingat.",
      done: "Selesai",
      snooze: "Tunda",
      dismiss: "Tutup",
      edit: "Ubah",
      delete: "Hapus",
      save: "Simpan",
      cancel: "Batal",
      editPlaceholder: "Ubah teks pengingat",
      snooze10m: "+10 mnt",
      snooze1h: "+1 jam",
      snoozeTomorrow: "Besok jam 9",
    },
    chain: {
      queued: "Rantai",
      empty: "Belum ada pengingat. Tangkap beberapa dan akan dikelompokkan di sini per kategori.",
      setCategory: "Ubah kategori",
      clear: "Bersihkan selesai",
    },
    category: {
      university: "Kuliah",
      investing: "Investasi",
      personal: "Pribadi",
      tutoring: "Les",
      urgent: "Mendesak",
      waiting: "Menunggu",
      uncategorized: "Tanpa kategori",
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
      ai: {
        title: "Bantuan AI",
        hint: "Gemini opsional untuk frasa waktu tidak biasa yang gagal dipahami parser lokal.",
      },
      updates: {
        title: "Pembaruan",
        hint: "Linodea memeriksa versi baru sesaat setelah dijalankan dan selalu bertanya sebelum memasang.",
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
    update: {
      notCheckedYet: "Belum diperiksa di sesi ini.",
      checking: "Memeriksa pembaruan...",
      upToDate: "Kamu sudah memakai versi terbaru.",
      downloading: (version) => `Mengunduh versi ${version}...`,
      ready: (version) => `Versi ${version} siap dipasang.`,
      installing: "Memasang... Linodea akan memulai ulang.",
      error: "Gagal memeriksa pembaruan. Periksa koneksimu lalu coba lagi.",
      unavailable: "Hanya tersedia di aplikasi desktop yang terpasang.",
      currentVersion: (version) => `Versi saat ini ${version}`,
      checkButton: "Periksa pembaruan",
      installButton: "Mulai ulang untuk memperbarui",
      badgeLabel: "Pembaruan siap dipasang",
    },
    ai: {
      fallbackLabel: "Gunakan AI saat parser lokal gagal",
      fallbackHint: "Pengingat biasa tetap instan dan offline. Gemini hanya dihubungi sebagai cadangan.",
      unavailable: "Hanya tersedia di aplikasi desktop yang terpasang.",
      providerLabel: "Penyedia",
      providerHint: "Gemini disarankan karena tingkat gratisnya cukup besar. Dukungan OpenAI dan Anthropic direncanakan.",
      recommended: "disarankan",
      comingLater: "segera hadir",
      configured: "Terhubung",
      notConfigured: "Belum terhubung",
      manageConnection: "Kelola koneksi",
      hideConnection: "Sembunyikan koneksi",
      connectionStored: "Kunci API disimpan aman oleh sistem operasi.",
      apiKeyLabel: "Kunci API Gemini",
      apiKeyPlaceholder: "Tempel kunci API Google AI Studio",
      keyStored: "Kunci disimpan aman oleh sistem operasi",
      saveAndTest: "Simpan & tes",
      testing: "Menguji...",
      removeKey: "Hapus kunci",
      modelLabel: "Model",
      refreshModels: "Segarkan model",
      fast: "cepat",
      fastHint: "Model Flash atau Fast disarankan agar penangkapan pengingat lebih cepat.",
      setupGuide: "Kunjungi halaman ini untuk membuat kunci API Gemini, lalu tempel di bawah:",
      setupTitle: "Cara mendapatkan kunci API Gemini gratis",
      setupSteps: [
        "Buka Google AI Studio lalu masuk dengan akun Google.",
        "Pilih Create API key. Tingkat gratis Gemini cukup untuk mencoba Bantuan AI.",
        "Salin kuncinya, kembali ke Linodea, lalu tempel ke kolom kunci API.",
      ],
      setupNote: "Kunci disimpan oleh sistem operasi, bukan di basis data pengingat Linodea. Google dapat memakai permintaan tingkat gratis untuk meningkatkan produknya, jadi hindari teks pengingat sensitif.",
      showSetup: "Tampilkan panduan setup",
      hideSetup: "Sembunyikan panduan setup",
      privacy: "Hanya frasa pengingat yang gagal, waktu saat ini, zona waktu, dan kode masalah parser yang dikirim ke Gemini. Riwayat tetap lokal.",
      understanding: "Memahami dengan Gemini...",
      assisted: "Dibantu AI",
      confirm: "Tekan Enter lagi untuk menyimpan",
      unsupported: "Gemini tidak dapat menyelesaikan frasa itu dengan aman.",
      errors: {
        invalidKey: "Gemini menolak kunci API ini.",
        quota: "Kuota atau batas permintaan Gemini tercapai.",
        timeout: "Gemini terlalu lama merespons.",
        network: "Tidak dapat menghubungi Gemini.",
        model: "Pilih model Gemini lain lalu tes kembali.",
        generic: "Bantuan AI tidak dapat menyelesaikan permintaan.",
      },
    },
    slash: {
      menuTitle: "Perintah",
      menuHint: "Tombol panah untuk navigasi · Enter untuk memilih",
      countdown: {
        label: "/countdown",
        description: "Pertahankan waktu detik tepat dan tampilkan hitung mundur di layar.",
      },
      recur: {
        label: "/recur",
        description: "Ulangi pengingat — mis. tiap hari jam 7, every 2 days 9am ×5.",
      },
      link: {
        label: "/link",
        description: "Tautkan ke pengingat lain — waktunya dihitung dari situ (mis. 30m before, 1 jam after).",
      },
      ai: {
        label: "/ai",
        description: "Buka setup Bantuan AI, kunci API, dan pilihan model.",
      },
      list: {
        label: "/list",
        description: "Buka daftar pengingat.",
      },
      chain: {
        label: "/chain",
        description: "Buka tampilan rantai pengingat yang tertaut.",
      },
      settings: {
        label: "/settings",
        description: "Buka Pengaturan (tema, bahasa, prealert, startup).",
      },
    },
    link: {
      pickHeader: "Tautkan ke pengingat mana?",
      noMatch: "Belum ada pengingat untuk ditautkan.",
      hint: "before = prep, after = follow-up",
      chipClear: "Hapus tautan",
    },
    timer: {
      caption: "Hitung mundur",
      dismiss: "Tutup timer",
    },
    recurrence: {
      describe: (rule) => describeRecurrenceIndonesian(rule),
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

// --- Recurrence summaries (used by recurrence.describe) --------------------

const WEEKDAYS_EN = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const WEEKDAYS_ID = [
  "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu",
];
const FREQ_UNIT_EN: Record<Recurrence["freq"], string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
};
const FREQ_UNIT_ID: Record<Recurrence["freq"], string> = {
  daily: "hari",
  weekly: "minggu",
  monthly: "bulan",
};

function withCount(base: string, count: number | undefined): string {
  return count === undefined ? base : `${base} ×${count}`;
}

function describeRecurrenceEnglish(rule: Recurrence): string {
  let base: string;
  if (rule.freq === "weekly" && rule.weekday !== undefined) {
    base = `every ${WEEKDAYS_EN[rule.weekday] ?? "week"}`;
  } else if (rule.interval > 1) {
    base = `every ${rule.interval} ${FREQ_UNIT_EN[rule.freq]}`;
  } else {
    base =
      rule.freq === "daily"
        ? "every day"
        : rule.freq === "weekly"
          ? "every week"
          : "every month";
  }
  return withCount(base, rule.count);
}

function describeRecurrenceIndonesian(rule: Recurrence): string {
  let base: string;
  if (rule.freq === "weekly" && rule.weekday !== undefined) {
    base = `tiap ${WEEKDAYS_ID[rule.weekday] ?? "minggu"}`;
  } else if (rule.interval > 1) {
    base = `tiap ${rule.interval} ${FREQ_UNIT_ID[rule.freq]}`;
  } else {
    base = `tiap ${FREQ_UNIT_ID[rule.freq]}`;
  }
  return withCount(base, rule.count);
}
