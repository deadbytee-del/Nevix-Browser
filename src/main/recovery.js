'use strict';
// Crash detection. A lock file exists for as long as the browser is running; if it is still there at the next
// start the previous run did not shut down cleanly. Two unclean starts in a row switch experimental flags off.
const fs = require('fs');
const path = require('path');

class Recovery {
  constructor(dir) {
    this.lockFile = path.join(dir, 'running.lock');
    this.stateFile = path.join(dir, 'boot.json');
    this.crashed = false;       // previous run ended uncleanly
    this.consecutive = 0;
    let st = {};
    try { st = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) || {}; } catch {}
    this.crashed = fs.existsSync(this.lockFile);
    this.consecutive = (Number(st.consecutive) || 0) + (this.crashed ? 1 : 0);
    if (!this.crashed) this.consecutive = 0;
    this.lastCrashAt = this.crashed ? Date.now() : st.lastCrashAt || 0;
    this.write();
  }

  /** Mark this run as in-progress. Call once the browser has really started. */
  arm() {
    try { fs.writeFileSync(this.lockFile, String(Date.now())); } catch {}
  }

  /** The run has survived long enough to be considered healthy: stop counting crash-loops. */
  healthy() { this.consecutive = 0; this.write(); }

  /** Clean shutdown. */
  disarm() {
    try { fs.unlinkSync(this.lockFile); } catch {}
    this.consecutive = 0;
    this.write();
  }

  write() {
    try { fs.writeFileSync(this.stateFile, JSON.stringify({ consecutive: this.consecutive, lastCrashAt: this.lastCrashAt })); } catch {}
  }

  get crashLoop() { return this.consecutive >= 2; }
}

module.exports = { Recovery };
