/** Owns the camera stream, including streams arriving after a cancelled request. */
export class CameraController {
  stream: MediaStream | null = null;
  private requestId = 0;

  async start(deviceId?: string): Promise<MediaStream> {
    this.stop();
    const requestId = this.requestId;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access needs localhost or HTTPS and a supported browser.",
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },
        },
      });
    } catch (error) {
      if (requestId !== this.requestId)
        throw new DOMException("Camera request cancelled.", "AbortError");
      throw new Error(cameraErrorMessage(error), { cause: error });
    }

    // Permission prompts can outlive the setup screen or a camera change.
    if (requestId !== this.requestId) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Camera request cancelled.", "AbortError");
    }
    this.stream = stream;
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener(
        "ended",
        () => {
          if (this.stream === stream) this.stop();
        },
        { once: true },
      );
    });
    return stream;
  }

  stop(): void {
    this.requestId += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
  }

  getSettings(): MediaTrackSettings {
    return this.stream?.getVideoTracks()[0]?.getSettings() ?? {};
  }
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Enable camera access in your browser and macOS Privacy settings, then retry.";
    case "NotFoundError":
      return "No camera found. Connect a webcam or Continuity Camera, then retry.";
    case "NotReadableError":
      return "The camera is unavailable. Close other apps using it, then retry.";
    case "OverconstrainedError":
      return "This camera is no longer available. Choose another camera and retry.";
    default:
      return error instanceof Error
        ? error.message
        : "Could not start the camera. Please retry.";
  }
}
