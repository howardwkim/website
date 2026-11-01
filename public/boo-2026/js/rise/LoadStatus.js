// The loading line: how far the file has come and roughly how long is left. The time to prepare
// the splats after the download can't be measured as it runs, so it comes from the last visit.

const prepareKey = (url) => `holo-prepare-ms:${url}`;
const words = (s) => (s < 1.5 ? 'about a second' : s < 90 ? `about ${Math.round(s)} seconds` : `about ${Math.round(s / 60)} minutes`);

export class LoadStatus {
  constructor(el, url, { bar, size } = {}) {
    this.el = el;
    this.url = url;
    this.bar = bar;     // optional element whose width shows the share loaded
    this.size = size;   // the file's size, for hosts that don't say
    this.prepare = Number(localStorage.getItem(prepareKey(url))) / 1000 || 0;
  }

  progress(loaded, reported) {
    const total = reported || this.size;
    if (this.bar && total) this.bar.style.width = `${Math.min(100, 100 * loaded / total)}%`;
    if (!total) { this.el.textContent = `Loading ${Math.round(loaded / 1e6)} MB`; return; }
    this.start ??= performance.now();     // from the first bytes: the wait before them says nothing about speed
    const elapsed = (performance.now() - this.start) / 1000;
    const pct = Math.min(100, Math.floor(100 * loaded / total));
    // the first moments say little either: no estimate until a little has come in
    const left = loaded / total > 0.05 && elapsed > 0.2 ? elapsed * (total - loaded) / loaded + this.prepare : 0;
    this.el.textContent = `Loading ${pct}%` + (left ? `, ${words(left)} left` : '');
  }

  preparing() {
    this.prepareStart ??= performance.now();
    if (this.bar) this.bar.style.width = '100%';
    this.el.textContent = 'Preparing' + (this.prepare ? `, ${words(this.prepare)} left` : '');
  }

  done() {
    if (this.prepareStart) localStorage.setItem(prepareKey(this.url), String(Math.round(performance.now() - this.prepareStart)));
  }
}
