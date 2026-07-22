import { app } from "electron";

// Apply Chromium's software-compositing fallback before the rest of the main
// process graph is evaluated. This keeps optional GPU runtime dependencies
// from being a prerequisite for the packaged renderer while preserving the
// existing sandbox and context-isolation settings.
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("use-gl", "swiftshader");
app.disableHardwareAcceleration();

void import("./main");
