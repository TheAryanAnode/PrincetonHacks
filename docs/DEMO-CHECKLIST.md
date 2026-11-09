# Physical demo acceptance

These checks are still required on the actual Mac/camera/audio rig. They are not claimed test results.

- [ ] Install once, disconnect internet, and start with `npm run dev`.
- [ ] Compare iPhone Continuity Camera over USB with the available webcam. Use requested versus actual settings and fresh delivered-frame rate.
- [ ] Use wired audio. Test every note and stop-all before the pitch.
- [ ] Draw a fresh eight-rectangle keyboard; scan, calibrate, and repair it within about one minute.
- [ ] Check registration across the full page, including corners. Tape the paper down.
- [ ] Rehearse explicit one-hand pinch input. Do not describe it as physical tap/contact detection.
- [ ] Count 100 intended activations, one minute of hover/reposition false positives, and one minute of repeated notes.
- [ ] Test index-tip disappearance, camera unplug, hidden tab, mode switch, and MIDI disconnect while sustain is enabled.
- [ ] Confirm camera loss is indicated and affected notes release. Test recovery without restarting.
- [ ] Measure at least 30 physical-action-to-sound trials with an independent recording. Report median, P95, and measurement uncertainty separately per input method.
- [ ] Test saved-layout and keyboard fallback after a failed scan.
- [ ] Run three uninterrupted complete demos and save real screen/wide-shot footage.

Suggested pitch: draw → scan → correct → reveal → play a short melody → chord mode → let a judge change one region.

Prepared capacitive touch hardware, physical tap detection, automatic board movement detection, pixel-accurate hand masking, loop recording, and performance acceptance certification are outside this implementation. Do not imply those features have been validated.
