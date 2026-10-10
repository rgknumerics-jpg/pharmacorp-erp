/** Bip + vibration + notification système (si autorisée) : alerte sonore/visuelle pour l'équipe (même mécanisme
 * que le portail client/livreur, voir portal/portalApi.ts). Joue deux bips pour se distinguer d'une simple alerte. */
export function alertStaff(title: string, body: string) {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      const c = new AC();
      [660, 880].forEach((freq, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination); o.frequency.value = freq; g.gain.value = 0.15;
        const at = c.currentTime + i * 0.18;
        o.start(at); o.stop(at + 0.16);
      });
    }
  } catch { /* ignore */ }
  try { navigator.vibrate?.([200, 80, 200]); } catch { /* ignore */ }
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }); } catch { /* ignore */ }
}
