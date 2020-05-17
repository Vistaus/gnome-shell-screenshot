#!/usr/bin/env gjs
// vi: sts=2 sw=2 et
//
//  Create screenshot using dbus interface
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const System = imports.system;


let debug = false;
const logDebug = (msg) => {
  if (debug) {
    log(msg);
  }
}

// https://gitlab.gnome.org/GNOME/gnome-shell/blob/master/data/org.gnome.Shell.Screenshot.xml
const ScreenshotServiceIFace = `
<node>
  <interface name="org.gnome.Shell.Screenshot">
    <method name="Screenshot">
      <arg type="b" direction="in" name="include_cursor"/>
      <arg type="b" direction="in" name="flash"/>
      <arg type="s" direction="in" name="filename"/>
      <arg type="b" direction="out" name="success"/>
      <arg type="s" direction="out" name="filename_used"/>
    </method>

    <method name="ScreenshotWindow">
      <arg type="b" direction="in" name="include_frame"/>
      <arg type="b" direction="in" name="include_cursor"/>
      <arg type="b" direction="in" name="flash"/>
      <arg type="s" direction="in" name="filename"/>
      <arg type="b" direction="out" name="success"/>
      <arg type="s" direction="out" name="filename_used"/>
    </method>

    <method name="ScreenshotArea">
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="b" direction="in" name="flash"/>
      <arg type="s" direction="in" name="filename"/>
      <arg type="b" direction="out" name="success"/>
      <arg type="s" direction="out" name="filename_used"/>
    </method>
  </interface>
</node>
`;

const ScreenshotServiceProxy = Gio.DBusProxy.makeProxyWrapper(ScreenshotServiceIFace);

const getScreenshotService = () => {
  return new ScreenshotServiceProxy(
    Gio.DBus.session,
    "org.gnome.Shell.Screenshot",
    "/org/gnome/Shell/Screenshot"
  );
}

const ScreenshotDesktopIncludeCursor = false;
const ScreenshotFlash = true;

const makeDesktopScreenshot = (fileName, { includeCursor, flash }, callback) => {
  logDebug("creating desktop screenshot...");
  return getScreenshotService().ScreenshotSync(includeCursor, flash, fileName);
}

const makeWindowScreenshot = (fileName, { includeFrame, includeCursor, flash }, callback) => {
  logDebug("creating window screenshot...");
  return getScreenshotService().ScreenshotWindowSync(includeFrame, includeCursor, flash, fileName);
};


const makeAreaScreenshot = (fileName, {x, y, w, h}, { flash }, callback) => {
  logDebug("creating area screenshot...");
  return getScreenshotService().ScreenshotAreaSync(x, y, w, h, flash, fileName);
};

const parseOptions = (params, argv) =>
  [...argv].reduce((acc, arg, i, argv) => {
    const fullArg = Object.keys(params).find((p) => p === arg || p.startsWith(arg + " "));
    if (!fullArg) {
      throw new Error(`no such parameter ${arg}`);
    }
    const isSwitch = fullArg === arg;

    const name = arg
      .replace(/^--/, "")
      .replace(/-[a-z]/, ([, c]) => c.toUpperCase());

    let val;
    if (isSwitch) {
      val = true
    } else if ((i + 1) in argv) {
      val = argv[i + 1];
      delete argv[i + 1];
    } else {
      throw new Error(`no value for parameter ${arg}`);
    }

    acc[name] = val;
    return acc;
  }, {});

const dumpOptions = (params) => {
  const pad = (str, n) => str + Array(Math.max(0, n - str.length)).fill(" ").join("");
  print("Usage:");
  // gnome3.24 - no `(const p in params)`
  for (var p in params) {
    print(`  ${pad(p, 32)} ${params[p]}`);
  }
}

const params = {
  "--desktop"           : "make desktop screenshot",
  "--window"            : "make window screenshot",
  "--area COORDS"       : "make area screenshot (x,y,w,h)",
  "--include-cursor"    : "include cursor (desktop only)",
  "--include-frame"     : "include frame (window only)",
  "--flash"             : "flash",
  "--filename FILENAME" : "output file",
  "--spawntest"         : "test GLib spawn call",
  "--ignore-dbus-ok"    : "ignore `ok` result of dbus call",
  "--debug"             : "print debug output",
  "--help"              : "show this"
}

const main = () => {
  const opts = parseOptions(params, ARGV);

  if (opts.help) {
    return dumpOptions(params);
  }

  if (opts.debug) {
    debug = true
  }

  if (opts.spawntest) {
    const newOpts = ARGV.filter((a) => a.toLowerCase() !== "--spawntest");
    if (parseOptions(params, newOpts).spawntest) {
      throw new Error();
    }
    const newArgv = ["gjs", "./src/auxhelper.js", ...newOpts];
    const [success, pid] = GLib.spawn_async(
      null, /* pwd */
      newArgv,
      null, /* envp */
      GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
      null /* child_setup */
    );
    if (!success) {
      throw new Error();
    }
    GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, exitCode) => {
      imports.mainloop.quit();
    });
    imports.mainloop.run();
    return;
  }

  const { filename: fileName } = opts;
  if (!fileName) {
    throw new Error("required argument --filename");
  }
  if (!fileName.startsWith("/")) {
    throw new Error("filename path must be absolute");
  }

  // gnome3.24 - no destructuring with defaults
  const { flash, includeCursor, includeFrame } = Object.assign({
    flash: false,
    includeCursor: false,
    includeFrame: true
  }, opts);
  const screenshotOpts = { flash, includeCursor, includeFrame };

  let func = [];
  if (opts.desktop) {
    func.push(() => makeDesktopScreenshot(fileName, screenshotOpts));
  }

  if (opts.area) {
    const coords = opts.area.split(",").map(Number);
    if (coords.some(isNaN)) {
      throw new Error("invalid --area coords (must be 'x,y,w,h')");
    }
    const [x, y, w, h] = coords;
    func.push(() => makeAreaScreenshot(fileName, {x, y, w, h}, screenshotOpts));
  }

  if (opts.window) {
    func.push(() => makeWindowScreenshot(fileName, screenshotOpts));
  }

  if (func.length !== 1) {
    throw new Error("must use --desktop, --area or --window");
  }

  func = func.pop();

  logDebug("calling func...");
  const [ok, fileNameUsed] = func();
  if (!ok) {
    const err = new Error("ok=false");
    if (opts.ignoreDbusOk) {
      logError(`${err} - ignoreDbusOk set, continuing...`);
    } else {
      throw err;
    }
  }

  if (fileName !== fileNameUsed) {
    throw new Error(`path mismatch fileName=${fileName} fileNameUsed=${fileNameUsed}`)
  }

  logDebug(`written ${fileNameUsed}`);
}

try {
  main();
} catch (e) {
  logError(e);
  System.exit(1);
}
