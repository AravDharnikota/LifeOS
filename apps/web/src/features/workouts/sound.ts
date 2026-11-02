/** Short two-note beep for the rest timer, WebAudio only (no asset). Prime on a user gesture so iOS allows playback later. */
let ctx: AudioContext | null = null;

export function primeAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* audio unavailable */
  }
}

export function beep(): void {
  primeAudio();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.01;
    for (const [offset, freq] of [[0, 880], [0.2, 1174.66]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.17);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.18);
    }
  } catch {
    /* ignore */
  }
}
