export type MidiNoteHandler = (
  note: number,
  phase: "down" | "up",
  velocity: number,
  sourceId: string,
) => void;
type MidiStatusHandler = (connected: boolean, label: string) => void;

interface AttachedInput {
  input: MIDIInput;
  listener: (event: MIDIMessageEvent) => void;
  notes: Map<string, { note: number; channel: number }>;
  ready: boolean;
  error?: string;
}

/** Optional Web MIDI input; permission is requested only by an explicit connect(). */
export class MidiController {
  private access: MIDIAccess | null = null;
  private inputs = new Map<string, AttachedInput>();
  private onEvent: MidiNoteHandler | null = null;
  private onStatus: MidiStatusHandler | null = null;
  private generation = 0;

  async connect(
    onEvent: MidiNoteHandler,
    onStatus: MidiStatusHandler,
  ): Promise<void> {
    this.disconnect();
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    const generation = this.generation;
    if (!navigator.requestMIDIAccess) {
      onStatus(
        false,
        "Web MIDI is unavailable in this browser. Use Chrome on localhost.",
      );
      throw new Error("Web MIDI is unavailable in this browser.");
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (generation !== this.generation) return;
      this.access = access;
      access.addEventListener("statechange", this.onStateChange);
      await this.synchronizeInputs();
    } catch (error) {
      if (generation !== this.generation) return;
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Allow MIDI access in your browser, then reconnect."
          : error instanceof Error
            ? error.message
            : "MIDI could not connect.";
      this.disconnect();
      onStatus(false, message);
      throw new Error(message, { cause: error });
    }
  }

  disconnect(): void {
    this.generation += 1;
    this.access?.removeEventListener("statechange", this.onStateChange);
    this.access = null;
    for (const id of [...this.inputs.keys()]) this.detach(id);
    this.onStatus?.(false, "MIDI disconnected");
    this.onEvent = null;
    this.onStatus = null;
  }

  private onStateChange = (): void => {
    void this.synchronizeInputs();
  };

  private async synchronizeInputs(): Promise<void> {
    if (!this.access) return;
    const generation = this.generation;
    const available = new Map<string, MIDIInput>();
    this.access.inputs.forEach((input) => {
      if (input.state === "connected") available.set(input.id, input);
    });
    for (const [id, attached] of this.inputs) {
      if (!available.has(id)) {
        this.detach(id);
        // A lost device always signals a release boundary, even if another remains.
        this.onStatus?.(
          false,
          `${attached.input.name || "MIDI input"} disconnected`,
        );
      }
    }
    await Promise.all(
      [...available.values()].map(async (input) => {
        if (this.inputs.has(input.id)) return;
        const attached: AttachedInput = {
          input,
          notes: new Map(),
          ready: false,
          listener: (event) => this.handleMessage(input.id, event),
        };
        this.inputs.set(input.id, attached);
        input.addEventListener("midimessage", attached.listener);
        try {
          await input.open();
          if (
            generation !== this.generation ||
            this.inputs.get(input.id) !== attached
          )
            return;
          attached.ready = true;
        } catch {
          if (this.inputs.get(input.id) === attached) {
            // Retain a failed port until reconnect so statechange cannot retry forever.
            input.removeEventListener("midimessage", attached.listener);
            attached.error = `Could not open ${input.name || "MIDI input"}. Reconnect MIDI to retry.`;
          }
        }
      }),
    );
    if (generation !== this.generation) return;
    const active = [...this.inputs.values()].filter((input) => input.ready);
    this.onStatus?.(
      active.length > 0,
      active.length
        ? active.map(({ input }) => input.name || "MIDI input").join(", ")
        : ([...this.inputs.values()].find((input) => input.error)?.error ??
            "MIDI ready — connect a USB MIDI controller"),
    );
  }

  private handleMessage(id: string, event: MIDIMessageEvent): void {
    const attached = this.inputs.get(id);
    const data = event.data;
    if (!attached || !data || data.length < 3) return;
    const command = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const note = data[1];
    const velocity = data[2] / 127;
    if (note > 127 || data[2] > 127) return;
    const key = `${channel}:${note}`;
    const sourceId = `${id}:${channel}`;
    if (command === 0x90 && velocity > 0) {
      // A repeated note-on retriggers one owned voice instead of leaking another.
      if (attached.notes.has(key)) this.onEvent?.(note, "up", 0, sourceId);
      attached.notes.set(key, { note, channel });
      this.onEvent?.(note, "down", velocity, sourceId);
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      if (attached.notes.delete(key))
        this.onEvent?.(note, "up", velocity, sourceId);
    } else if (command === 0xb0 && (note === 120 || note === 123)) {
      this.releaseNotes(attached, channel);
    }
  }

  private releaseNotes(attached: AttachedInput, channel?: number): void {
    for (const [key, held] of attached.notes) {
      if (channel !== undefined && held.channel !== channel) continue;
      this.onEvent?.(
        held.note,
        "up",
        0,
        `${attached.input.id}:${held.channel}`,
      );
      attached.notes.delete(key);
    }
  }

  private detach(id: string): void {
    const attached = this.inputs.get(id);
    if (!attached) return;
    this.inputs.delete(id);
    attached.input.removeEventListener("midimessage", attached.listener);
    this.releaseNotes(attached);
    void attached.input.close().catch(() => {
      /* A physically removed port may already be closed. */
    });
  }
}
