import { saveLocalEvidence } from "./evidenceStorage";

const API = "http://127.0.0.1:8001";

let activeRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;
let recordingIncidentId: number | null = null;
let recordingToken = "";
let recordingChunks: Blob[] = [];
let stopPromise: Promise<EvidenceStopResult> | null = null;
let startInProgress = false;
let cancelPendingStart = false;

export type EvidenceStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "saving"
  | "uploaded"
  | "local-only"
  | "error";

export type EvidenceStopResult = {
  status: "uploaded" | "local-only" | "not-recording" | "error";
  message: string;
};

function resetRecorder() {
  activeStream?.getTracks().forEach(track => track.stop());
  recordingChunks = [];
  activeRecorder = null;
  activeStream = null;
  recordingIncidentId = null;
  recordingToken = "";
}

export async function startBrowserEvidenceRecording(
  incidentId: number,
  token: string
): Promise<void> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new Error("Browser recording is unavailable.");
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support audio/video recording.");
  }

  if (startInProgress || (activeRecorder && activeRecorder.state !== "inactive")) {
    throw new Error("A recording is already active or starting.");
  }

  startInProgress = true;
  cancelPendingStart = false;

  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (error) {
    startInProgress = false;
    throw error;
  }

  startInProgress = false;

  // SOS may have been stopped while the browser permission prompt was open.
  if (cancelPendingStart) {
    stream.getTracks().forEach(track => track.stop());
    cancelPendingStart = false;
    return;
  }

  try {
    const mimeType = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find(type => MediaRecorder.isTypeSupported(type));

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    activeStream = stream;
    activeRecorder = recorder;
    recordingIncidentId = incidentId;
    recordingToken = token;
    recordingChunks = [];
    stopPromise = null;

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      console.error("SafeHer evidence recording encountered an error.");
    };

    recorder.start(1000);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    resetRecorder();
    throw error;
  }
}

export function isBrowserEvidenceRecording(): boolean {
  return activeRecorder !== null && activeRecorder.state === "recording";
}

export async function stopBrowserEvidenceRecording(): Promise<EvidenceStopResult> {
  // Cancel a camera/microphone permission request that has not completed yet.
  cancelPendingStart = true;

  if (stopPromise) {
    return stopPromise;
  }

  const recorder = activeRecorder;
  const stream = activeStream;
  const incidentId = recordingIncidentId;
  const token = recordingToken;

  if (!recorder || recorder.state === "inactive" || incidentId === null) {
    resetRecorder();

    return {
      status: "not-recording",
      message: "No active evidence recording was found.",
    };
  }

  stopPromise = new Promise<EvidenceStopResult>(resolve => {
    recorder.onstop = async () => {
      let result: EvidenceStopResult;

      try {
        const blob = new Blob(recordingChunks, {
          type: recorder.mimeType || "video/webm",
        });

        if (blob.size === 0) {
          result = {
            status: "error",
            message: "The recording was empty and could not be saved.",
          };
        } else {
          const filename = `safeher-incident-${incidentId}-${Date.now()}.webm`;

          try {
            await saveLocalEvidence({
              incidentId,
              filename,
              createdAt: new Date().toISOString(),
              blob,
            });
          } catch (error) {
            console.error("SafeHer could not save evidence locally:", error);

            result = {
              status: "error",
              message: "The recording could not be saved locally.",
            };

            resetRecorder();
            stopPromise = null;
            resolve(result);
            return;
          }

          try {
            const formData = new FormData();
            formData.append("file", blob, filename);

            const response = await fetch(
              `${API}/api/incidents/${incidentId}/evidence`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
                body: formData,
              }
            );

            if (!response.ok) {
              throw new Error(`Upload failed (${response.status}).`);
            }

            result = {
              status: "uploaded",
              message: "Evidence was saved locally and uploaded successfully.",
            };
          } catch (error) {
            console.warn("SafeHer evidence upload failed:", error);

            result = {
              status: "local-only",
              message: "Evidence was saved on this device, but server upload failed. Keep this browser data safe.",
            };
          }
        }
      } catch (error) {
        console.error("SafeHer evidence could not be processed:", error);

        result = {
          status: "error",
          message: "An unexpected error occurred while saving evidence.",
        };
      } finally {
        stream?.getTracks().forEach(track => track.stop());
        resetRecorder();
        stopPromise = null;
      }

      resolve(result);
    };

    try {
      recorder.stop();
    } catch (error) {
      console.error("Could not stop the evidence recorder:", error);

      stream?.getTracks().forEach(track => track.stop());
      resetRecorder();
      stopPromise = null;

      resolve({
        status: "error",
        message: "The recording could not be stopped cleanly.",
      });
    }
  });

  return stopPromise;
}
