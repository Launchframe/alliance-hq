/*
 * frida_capture_bluestacks.js — capture Last War login blobs inside BlueStacks
 *
 * Same packet shapes the host sniffer wants:
 *   e405 / e406  — encrypted SmartFox game packets (mobile usually e405)
 *   middle high-entropy send — auth.bin when present
 *
 * GPLv3 derivative of LastWarTools/Capture-Tool capture_login.js — see NOTICE.
 *
 * Setup (Mac + BlueStacks):
 *   1. BlueStacks → Settings → Advanced → enable Android Debug Bridge
 *   2. adb connect 127.0.0.1:<bst-adb-port>   # port shown in BlueStacks
 *   3. Push frida-server matching device arch, run as root if available:
 *        adb push frida-server /data/local/tmp/
 *        adb shell "chmod 755 /data/local/tmp/frida-server && /data/local/tmp/frida-server &"
 *   4. On Mac:
 *        frida -H 127.0.0.1:27042 -f com.fun.lastwar.gp -l frida_capture_bluestacks.js
 *      (package id may differ: com.fun.lastwar.gp / regional variants — `adb shell pm list packages | grep -i lastwar`)
 *
 * Pull:
 *   adb pull /data/local/tmp/handshake.bin ./
 *   adb pull /data/local/tmp/auth.bin ./
 *   adb pull /data/local/tmp/login.bin ./
 */

'use strict';

var capturedAuth = null;
var handshakeSent = false;
var loginComplete = false;

function toHex(ptr, len) {
  var result = '';
  try {
    var bytes = ptr.readByteArray(len);
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) {
      result += ('0' + arr[i].toString(16)).slice(-2);
    }
  } catch (_err) {
    result = '(error)';
  }
  return result;
}

function saveFile(path, data) {
  try {
    var file = new File(path, 'wb');
    file.write(data);
    file.close();
    console.log('[SAVED] ' + path + ' (' + data.byteLength + ' bytes)');
    return true;
  } catch (e) {
    console.log('[ERROR] Failed to save ' + path + ': ' + e);
    return false;
  }
}

function entropyHint(bytes) {
  var arr = new Uint8Array(bytes);
  var n = Math.min(arr.length, 100);
  var seen = {};
  var uniq = 0;
  for (var i = 0; i < n; i++) {
    var k = arr[i];
    if (!seen[k]) {
      seen[k] = 1;
      uniq++;
    }
  }
  return uniq;
}

console.log('\n' + '='.repeat(60));
console.log('[*] Last War BlueStacks Frida capture');
console.log('[*] Log into the game — looking for e405/e406 (+ auth)');
console.log('='.repeat(60) + '\n');

var libc = Process.getModuleByName('libc.so');
var sendAddr = libc.getExportByName('send');

if (sendAddr) {
  Interceptor.attach(sendAddr, {
    onEnter: function (args) {
      var buf = args[1];
      var len = args[2].toInt32();
      if (len < 200 || len > 10000) return;

      var header = toHex(buf, 4);
      var isGame =
        header.indexOf('e405') === 0 ||
        header.indexOf('e406') === 0 ||
        header.indexOf('e407') === 0;

      if (isGame && len >= 300) {
        var packetData = buf.readByteArray(len);
        if (!handshakeSent) {
          handshakeSent = true;
          console.log('[CAPTURE] Handshake: ' + len + ' bytes header=' + header);
          saveFile('/data/local/tmp/handshake.bin', packetData);
          return;
        }
        if (handshakeSent && !loginComplete) {
          loginComplete = true;
          console.log('[CAPTURE] Login: ' + len + ' bytes header=' + header);
          saveFile('/data/local/tmp/login.bin', packetData);
          if (!capturedAuth) {
            console.log(
              '[WARN] No auth.bin seen between handshake and login. ' +
                'Host sniffer may still work; upload may accept handshake+login only.'
            );
          }
          console.log('[SUCCESS] Pull with adb pull /data/local/tmp/{handshake,auth,login}.bin');
        }
        return;
      }

      // Auth: high-entropy non-e4xx blob between handshake and login
      if (handshakeSent && !loginComplete && !capturedAuth && len >= 200) {
        if (
          header.indexOf('e4') === 0 ||
          header.indexOf('c4') === 0 ||
          header.indexOf('c408') === 0
        ) {
          return;
        }
        var authData = buf.readByteArray(len);
        if (entropyHint(authData) > 50) {
          capturedAuth = authData;
          console.log('[CAPTURE] Auth: ' + len + ' bytes header=' + header);
          saveFile('/data/local/tmp/auth.bin', authData);
        }
      }
    },
  });
  console.log('[+] Hooked send() — open Last War and log in.\n');
} else {
  console.log('[!] Could not find send() in libc.so');
}
