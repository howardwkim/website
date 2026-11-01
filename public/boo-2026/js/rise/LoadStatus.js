// One loading line from start to finish. The download is the first part of the bar; preparing the
// splats is the last part, timed from the last visit because it can't be measured as it runs.

const prepareKey = (url) => `holo-prepare-ms:${url}`;
const words = (s) => (s < 1.5 ? 'about a second' : s < 90 ? `about ${Math.round(s)} seconds` : `about ${Math.round(s / 60)} minutes`);
const DOWNLOAD = 0.85;   // the download's share of the whole bar
const FIRST_GUESS = 5;   // seconds to prepare, before there is a last visit to go by

export class LoadStatus {
  constructor(el, url, { bar, size } = {}) {
    this.el = el;
    this.url = url;
    this.bar = bar;     // optional element scaled across to show the share done
    this.size = size;   // the file's size, for hosts that don't say
    this.prepare = Number(localStorage.getItem(prepareKey(url))) / 1000 || FIRST_GUESS;
    this.share = 0;
  }

  show(share, left) {
    this.share = Math.max(this.share, share);      // only ever forward
    if (this.bar) this.bar.style.transform = `scaleX(${this.share})`;
    this.el.textContent = `Loading ${Math.floor(100 * this.share)}%` + (left ? `, ${words(left)} left` : '');
  }

  progress(loaded, reported) {
    const total = reported || this.size;
    if (!total) { this.el.textContent = `Loading ${Math.round(loaded / 1e6)} MB`; return; }
    this.start ??= performance.now();     // from the first bytes: the wait before them says nothing about speed
    const elapsed = (performance.now() - this.start) / 1000;
    const got = Math.min(1, loaded / total);
    // the first moments say little either: no estimate until a little has come in
    this.show(got * DOWNLOAD, got > 0.05 && elapsed > 0.2 ? elapsed * (1 - got) / got + this.prepare : 0);
  }

  preparing() {
    if (this.prepareStart) return;
    this.prepareStart = performance.now();
    // the main thread is busy now: a CSS transition keeps the bar moving regardless
    if (this.bar) {
      this.bar.style.transition = `transform ${this.prepare}s linear`;
      this.bar.style.transform = 'scaleX(0.99)';
    }
    const bar = this.bar;
    this.bar = null;
    const from = Math.max(this.share, DOWNLOAD);
    const tick = () => {
      const part = Math.min(0.99, (performance.now() - this.prepareStart) / 1000 / this.prepare);
      this.show(from + (1 - from) * part, Math.max(1, this.prepare * (1 - part)));
    };
    tick();
    this.timer = setInterval(tick, 200);
    this.finishBar = () => { if (bar) { bar.style.transition = 'transform 0.15s linear'; bar.style.transform = 'scaleX(1)'; } };
  }

  /** The line's own last word, once loading is over and something else is being waited for. */
  say(text) {
    clearInterval(this.timer);
    this.el.textContent = text;
  }

  done() {
    clearInterval(this.timer);
    this.finishBar?.();
    if (this.prepareStart) localStorage.setItem(prepareKey(this.url), String(Math.round(performance.now() - this.prepareStart)));
  }
}
