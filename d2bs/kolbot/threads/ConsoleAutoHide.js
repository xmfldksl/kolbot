/**
 *  @filename    ConsoleAutoHide.js
 *  @desc        Periodically calls hideConsole() while the character is actively
 *               moving. Skips the call when stuck (no position change for
 *               STUCK_THRESHOLD ms) so the console remains visible during errors
 *               at fixed positions (town, NPC, startup).
 */
js_strict(true);

var HIDE_INTERVAL   = 10000;  // ms between hideConsole() attempts
var STUCK_THRESHOLD = 8000;   // ms without position change → skip hiding
var CHECK_INTERVAL  = 500;    // ms between position samples

var done = false;

function main() {
  var initialized     = false;
  var lastX           = null;
  var lastY           = null;
  var lastMoveTime    = 0;
  var lastHideAttempt = 0;

  addEventListener("scriptmsg", function (msg) {
    if (msg === "quit") {
      done = true;
    }
  });

  while (!done) {
    if (!me.gameReady) {
      initialized = false;
    } else {
      var x   = me.x;
      var y   = me.y;
      var now = getTickCount();

      if (!initialized) {
        lastX           = x;
        lastY           = y;
        lastMoveTime    = now;
        lastHideAttempt = now;
        initialized     = true;
      } else {
        if (x !== lastX || y !== lastY) {
          lastX        = x;
          lastY        = y;
          lastMoveTime = now;
        }

        if (now - lastHideAttempt >= HIDE_INTERVAL) {
          var stuck = (now - lastMoveTime) >= STUCK_THRESHOLD;

          if (!stuck) {
            try {
              hideConsole();
            } catch (e) {}
          }

          lastHideAttempt = now;
        }
      }
    }

    delay(CHECK_INTERVAL);
  }
}
