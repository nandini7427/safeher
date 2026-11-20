type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

let recognition: SpeechRecognitionLike | null = null;
let enabled = false;
let restarting = false;
let helpCallback: (() => void) | null = null;
let statusCallback: ((status: string) => void) | null = null;

function getSpeechConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;

  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return browserWindow.SpeechRecognition ||
    browserWindow.webkitSpeechRecognition ||
    null;
}

function stopRecognition() {
  enabled = false;
  restarting = false;

  if (recognition) {
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;

    try {
      recognition.stop();
    } catch {
      // Recognition may already have stopped.
    }
  }

  recognition = null;
}

function startRecognition() {
  if (!enabled || document.visibilityState !== "visible" || restarting) {
    return;
  }

  const Constructor = getSpeechConstructor();

  if (!Constructor) {
    statusCallback?.("Voice recognition is unavailable in this browser.");
    stopRecognition();
    return;
  }

  restarting = true;

  try {
    const instance = new Constructor();

    instance.continuous = true;
    instance.interimResults = false;
    instance.lang = "en-IN";

    recognition = instance;

    instance.onresult = event => {
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];

        if (result.isFinal && /\bhelp\b/i.test(result[0].transcript)) {
          statusCallback?.("Help detected. Starting SOS countdown.");

          stopRecognition();
          helpCallback?.();
          return;
        }
      }
    };

    instance.onerror = () => {
      statusCallback?.("Voice recognition interrupted. Retrying while this tab is visible.");
    };

    instance.onend = () => {
      restarting = false;

      if (enabled && document.visibilityState === "visible") {
        statusCallback?.("Listening for Help.");
        window.setTimeout(() => startRecognition(), 800);
      }
    };

    instance.start();
    restarting = false;
    statusCallback?.("Listening for Help.");
  } catch {
    restarting = false;
    statusCallback?.("Could not start voice recognition. Check browser permissions.");
  }
}

export async function enableHelpVoiceTrigger(
  onHelp: () => void,
  onStatus: (status: string) => void
): Promise<void> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Voice activation requires a supported browser.");
  }

  if (!getSpeechConstructor()) {
    throw new Error("Speech recognition is not supported by this browser.");
  }

  const permissionStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });

  permissionStream.getTracks().forEach(track => track.stop());

  stopRecognition();

  helpCallback = onHelp;
  statusCallback = onStatus;
  enabled = true;

  document.addEventListener("visibilitychange", handleVisibilityChange);

  startRecognition();
}

function handleVisibilityChange() {
  if (document.visibilityState !== "visible") {
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore an already stopped recognizer.
      }
    }

    statusCallback?.("Voice detection paused because this tab is not visible.");
    return;
  }

  if (enabled) {
    restarting = false;
    startRecognition();
  }
}

export function disableHelpVoiceTrigger() {
  stopRecognition();
  document.removeEventListener("visibilitychange", handleVisibilityChange);

  helpCallback = null;
  statusCallback = null;
}
