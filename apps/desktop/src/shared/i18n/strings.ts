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
    setTags: string;
    /** Header for the section holding reminders with no tags. */
    untagged: string;
    /** Placeholder in the retag popover's input. */
    tagInput: string;
    /** Menu row that removes every tag from a reminder. */
    clearTags: string;
    clear: string;
  };
  // A `category` block used to sit here with six translated names. Tags are
  // user-authored text, so there is nothing to translate — the tag itself is
  // the label, in whatever language the user typed it.
  settings: {
    appearance: { title: string; hint: string };
    notifications: { title: string; hint: (max: number) => string };
    alerts: {
      title: string;
      hint: string;
      preview: string;
      previewTitle: string;
      footnote: string;
      levels: Record<
        "subtle" | "normal" | "insistent",
        { name: string; description: string }
      >;
    };
    language: { title: string; hint: string };
    phoneLink: { title: string; hint: string };
    startup: { title: string; hint: string };
    ai: { title: string; hint: string };
    updates: { title: string; hint: string };
    support: { title: string; hint: string };
  };
  themes: {
    dark: { name: string; description: string };
    light: { name: string; description: string };
  };
  phoneLink: {
    toggleLabel: string;
    toggleHint: string;
    testHeading: string;
    testHint: string;
    noAddresses: string;
    firewallNote: string;
    error: (detail: string) => string;
    pairHeading: string;
    pairHint: string;
    pairStart: string;
    pairCancel: string;
    pairInstructions: (url: string) => string;
    pairScanHint: string;
    pairTypeFallback: (url: string) => string;
    qrLabel: string;
    checkAgain: string;
    checking: string;
    addressAnswers: string;
    addressNoAnswer: string;
    addressPick: string;
    probeNote: string;
    lastSeen: (when: string) => string;
    neverSeen: string;
    forget: string;
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
  /**
   * Second line of the alert card. The card renders the reminder's title on
   * its own line above this, so these deliberately do NOT repeat it — they
   * used to, a leftover from when the same strings fed an OS toast (where the
   * title slot is the app name).
   */
  notificationBody: {
    /** Subtitle for the T-due card. */
    due: (when: string) => string;
    /** Subtitle for a prealert card. Takes minutes-of-lead so the formatter can localize the unit phrase. */
    prealert: (leadMinutes: number) => string;
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
  /** Settings → Support: donation links + feedback form. */
  support: {
    intro: string;
    koFi: string;
    saweria: string;
    comingSoon: string;
    feedbackTitle: string;
    feedbackHint: string;
    feedbackButton: string;
  };
  ai: {
    fallbackLabel: string;
    fallbackHint: string;
    /** Shown under the toggle when it's off because no key is saved yet. */
    fallbackNeedsKey: string;
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
    feedback: { label: string; description: string };
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
      // The rotating placeholders are the only discovery path for `#tag` until
      // the capture bar grows tag autocomplete.
      "tomorrow 2pm team standup #work",
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
      empty: "No reminders yet. Capture a few and they'll group here by tag.",
      setTags: "Change tags",
      untagged: "Untagged",
      tagInput: "Add a tag…",
      clearTags: "Remove tags",
      clear: "Clear completed",
    },
    settings: {
      appearance: {
        title: "Appearance",
        hint: "Switch the look of the popup. New themes can be added later.",
      },
      notifications: {
        title: "Notifications",
        hint: (max) =>
          `Get reminded ahead of time. Up to ${max} prealerts; the reminder itself still waits for you to mark it done.`,
      },
      alerts: {
        title: "Alerts",
        hint: "How hard a reminder tries to get your attention when it fires.",
        preview: "Preview",
        previewTitle: "This is how an alert looks",
        footnote:
          "Preview shows a real alert. It is only a sample — nothing is scheduled or completed.",
        levels: {
          subtle: {
            name: "Subtle",
            description: "Small card, one quiet ping, closes after 20s.",
          },
          normal: {
            name: "Normal",
            description: "Bigger card, three pings, closes after 30s.",
          },
          insistent: {
            name: "Insistent",
            description: "Largest card, six pings, stays a full minute.",
          },
        },
      },
      language: {
        title: "Language",
        hint: "Interface language and parser tie-break preference.",
      },
      phoneLink: {
        title: "Phone",
        hint: "Hand reminders to your phone over your own network, so it can remind you when you are away from this computer. Everything here is set up on this computer. Off until you turn it on.",
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
      support: {
        title: "Support",
        hint: "Keep Linodea going, and tell me what to build next.",
      },
    },
    themes: {
      dark: { name: "Dark", description: "Default. Easy on the eyes for night capture." },
      light: { name: "Light", description: "Bright surface for daytime use." },
    },
    phoneLink: {
      toggleLabel: "Answer on this network",
      toggleHint:
        "Your phone reaches this computer over Wi-Fi — never over a USB cable. Nothing leaves your network.",
      testHeading: "Check your phone can reach this computer",
      testHint:
        "Open one of these on your phone's browser, connected to the same Wi-Fi. Some networks block devices from seeing each other; this tells you whether yours does.",
      noAddresses:
        "No network address found. Is this computer connected to Wi-Fi or Ethernet?",
      firewallNote:
        "The first time, Windows will ask on this computer whether to allow Linodea through the firewall. Tick both Private and Public networks -- your Wi-Fi is often classed as Public, and blocking it looks exactly like the phone being unable to connect.",
      error: (detail) => `Could not start: ${detail}`,
      pairHeading: "Paired phones",
      pairHint:
        "Start pairing, then type the code on your phone. The code lasts five minutes and works once.",
      pairStart: "Start pairing",
      pairCancel: "Cancel",
      pairInstructions: (url) => `On your phone, open ${url} and type this code:`,
      pairScanHint:
        "Point your phone's camera at this, on the same Wi-Fi as this computer. The code is already in the link, so all you have to do is name the phone.",
      pairTypeFallback: (url) =>
        `No camera, or nothing happened? Open ${url} on your phone and type this code:`,
      qrLabel: "Pairing code as a QR code",
      checkAgain: "Check again",
      checking: "Checking...",
      addressAnswers: "Answers",
      addressNoAnswer: "No answer",
      addressPick: "Scan went nowhere? Point the code at a different address:",
      probeNote:
        "\"No answer\" means this computer could not reach that address itself, so your phone certainly cannot -- it is usually an unplugged cable or a virtual adapter. \"Answers\" is not a promise: a network that hides devices from each other, or a firewall set to Private only, still blocks the phone and cannot be seen from here.",
      lastSeen: (when) => `Last seen ${when}`,
      neverSeen: "Not seen yet",
      forget: "Remove",
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
      due: (when) => `Due ${when}`,
      prealert: (leadMinutes) => `In ${leadEnglish(leadMinutes)}`,
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
    support: {
      intro:
        "Linodea is free and every feature is included. Donations keep it going.",
      koFi: "Ko-fi",
      saweria: "Saweria",
      comingSoon: "Link coming soon",
      feedbackTitle: "Send feedback",
      feedbackHint:
        "Found a bug or have an idea? A short form comes straight to me.",
      feedbackButton: "Open feedback form",
    },
    ai: {
      fallbackLabel: "Use AI when local parsing fails",
      fallbackHint: "Normal reminders stay instant and offline. Gemini is contacted only as a fallback.",
      fallbackNeedsKey: "Add a Gemini API key below to switch this on.",
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
      feedback: {
        label: "/feedback",
        description: "Open the feedback form in your browser.",
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
      "besok jam 2 siang rapat tim #kerja",
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
      empty: "Belum ada pengingat. Tangkap beberapa dan akan dikelompokkan di sini per tag.",
      setTags: "Ubah tag",
      untagged: "Tanpa tag",
      tagInput: "Tambah tag…",
      clearTags: "Hapus tag",
      clear: "Bersihkan selesai",
    },
    settings: {
      appearance: {
        title: "Tampilan",
        hint: "Ganti tema popup. Tema baru bisa ditambah nanti.",
      },
      notifications: {
        title: "Notifikasi",
        hint: (max) =>
          `Dapat pengingat lebih awal. Maksimal ${max} pengingat awal; pengingatnya sendiri tetap menunggu kamu tandai selesai.`,
      },
      alerts: {
        title: "Peringatan",
        hint: "Seberapa keras pengingat berusaha menarik perhatianmu saat waktunya tiba.",
        preview: "Coba",
        previewTitle: "Beginilah tampilan peringatan",
        footnote:
          "Tombol Coba menampilkan peringatan sungguhan. Hanya contoh — tidak ada yang dijadwalkan atau diselesaikan.",
        levels: {
          subtle: {
            name: "Halus",
            description: "Kartu kecil, satu bunyi pelan, tertutup setelah 20 detik.",
          },
          normal: {
            name: "Normal",
            description: "Kartu lebih besar, tiga bunyi, tertutup setelah 30 detik.",
          },
          insistent: {
            name: "Mendesak",
            description: "Kartu terbesar, enam bunyi, bertahan satu menit penuh.",
          },
        },
      },
      language: {
        title: "Bahasa",
        hint: "Bahasa antarmuka dan preferensi parser saat ada ambiguitas.",
      },
      phoneLink: {
        title: "HP",
        hint: "Kirim pengingat ke HP-mu lewat jaringanmu sendiri, supaya HP bisa mengingatkan saat kamu jauh dari komputer ini. Semua pengaturannya ada di komputer ini. Mati sampai kamu nyalakan.",
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
      support: {
        title: "Dukungan",
        hint: "Bantu Linodea terus berjalan, dan beri tahu saya fitur berikutnya.",
      },
    },
    themes: {
      dark: { name: "Gelap", description: "Bawaan. Nyaman untuk malam hari." },
      light: { name: "Terang", description: "Permukaan cerah untuk siang hari." },
    },
    phoneLink: {
      toggleLabel: "Jawab di jaringan ini",
      toggleHint:
        "HP-mu menjangkau komputer ini lewat Wi-Fi — bukan lewat kabel USB. Tidak ada yang keluar dari jaringanmu.",
      testHeading: "Cek HP-mu bisa menjangkau komputer ini",
      testHint:
        "Buka salah satu alamat ini di browser HP, tersambung ke Wi-Fi yang sama. Sebagian jaringan memblokir perangkat agar tidak saling melihat; ini memberitahu apakah jaringanmu begitu.",
      noAddresses:
        "Alamat jaringan tidak ditemukan. Apakah komputer ini tersambung ke Wi-Fi atau Ethernet?",
      firewallNote:
        "Pertama kali, Windows akan bertanya di komputer ini apakah Linodea boleh lewat firewall. Centang Private dan Public -- Wi-Fi sering dianggap Public, dan kalau diblokir gejalanya persis seperti HP yang tidak bisa terhubung.",
      error: (detail) => `Tidak bisa memulai: ${detail}`,
      pairHeading: "HP yang terhubung",
      pairHint:
        "Mulai penyandingan, lalu ketik kodenya di HP. Kode berlaku lima menit dan hanya sekali pakai.",
      pairStart: "Mulai sandingkan",
      pairCancel: "Batal",
      pairInstructions: (url) => `Di HP-mu, buka ${url} lalu ketik kode ini:`,
      pairScanHint:
        "Arahkan kamera HP ke gambar ini, dengan Wi-Fi yang sama seperti komputer ini. Kodenya sudah ada di dalam tautan, jadi kamu tinggal memberi nama HP-nya.",
      pairTypeFallback: (url) =>
        `Tidak ada kamera, atau tidak terjadi apa-apa? Buka ${url} di HP-mu lalu ketik kode ini:`,
      qrLabel: "Kode penyandingan dalam bentuk QR",
      checkAgain: "Cek lagi",
      checking: "Mengecek...",
      addressAnswers: "Menjawab",
      addressNoAnswer: "Tidak menjawab",
      addressPick: "Hasil scan tidak ke mana-mana? Arahkan kodenya ke alamat lain:",
      probeNote:
        "\"Tidak menjawab\" berarti komputer ini sendiri tidak bisa menjangkau alamat itu, jadi HP-mu pasti juga tidak -- biasanya kabel yang tercabut atau adapter virtual. \"Menjawab\" bukan jaminan: jaringan yang menyembunyikan perangkat satu sama lain, atau firewall yang hanya diizinkan untuk Private, tetap memblokir HP dan itu tidak bisa dilihat dari sini.",
      lastSeen: (when) => `Terakhir terlihat ${when}`,
      neverSeen: "Belum terlihat",
      forget: "Hapus",
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
      due: (when) => `Waktunya ${when}`,
      prealert: (leadMinutes) => `Dalam ${leadIndonesian(leadMinutes)}`,
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
    support: {
      intro:
        "Linodea gratis dan semua fitur sudah termasuk. Donasi membantu pengembangannya terus berjalan.",
      koFi: "Ko-fi",
      saweria: "Saweria",
      comingSoon: "Tautan segera hadir",
      feedbackTitle: "Kirim masukan",
      feedbackHint:
        "Menemukan bug atau punya ide? Formulir singkat langsung sampai ke saya.",
      feedbackButton: "Buka formulir masukan",
    },
    ai: {
      fallbackLabel: "Gunakan AI saat parser lokal gagal",
      fallbackHint: "Pengingat biasa tetap instan dan offline. Gemini hanya dihubungi sebagai cadangan.",
      fallbackNeedsKey: "Tambahkan API key Gemini di bawah untuk mengaktifkannya.",
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
      feedback: {
        label: "/feedback",
        description: "Buka formulir masukan di peramban kamu.",
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
