import "./App.css";

function App() {
  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-16">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
          Linodea
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
          Local-first reminders for fast desktop capture.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600">
          MVP skeleton for a desktop-first reminder app built around shortcut,
          type reminder, Enter, gone.
        </p>
        <div className="mt-10 rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="font-mono text-sm text-zinc-500">
            [Prep] -&gt; [Main Reminder] -&gt; [Follow-up]
          </p>
        </div>
      </section>
    </main>
  );
}

export default App;
