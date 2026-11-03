# Motion Audio Central: design system (10.2)

The six apps (Central Pedal on its HDMI and 3.5" screens, Central Pedal Control, Central Control, Central Usage,
Central Services, Central Production) and the website should feel like one product. They already share a look:
graphite, brass, warm white and one typeface (Archivo). 10.2 makes it consistent, less cluttered and easier to find
things in. It doesn't start over.

The tokens live in `css/central-tokens.css`. Every app loads it before its own stylesheet.

## What people told us was wrong
- **Hard to find things.** Settings and features are buried or in odd places.
- **Too cluttered.** Too many buttons, tabs and small text on one screen.
- **Looks dated or mismatched.** The apps don't look like one family.

## The rules

**1. One thing to press.** Each screen or panel has at most one brass (accent) button: the main action. Everything
else is a quiet button: panel2 with a line, or plain text for minor actions. Brass also marks what's selected or
live. Red (`--live`) means it's on air, recording or streaming, and nothing else.

**2. Show less, reveal more.**
- Put the everyday controls up front.
- Move rarely used options behind "More…", a ⋯ menu or a details disclosure, kept next to the thing they change.
- Don't stack every option on one screen.
- If a panel needs a scroll bar on a 1280×800 screen, ask which half people use on a Sunday morning.

**3. The same place for the same thing in every app:**
- **Top bar.** App name and church on the left, then the main tabs. On the right: search (⌘K / Ctrl+K, see rule 5),
  connection status, the account icon (account, purchases, packages, sign out) and ⚙ Settings.
- **Settings** opens as one full page. It has a list of groups on the left and one group's options on the right,
  with a search box over the groups. The groups are in this order, using only the ones an app has:
  1. Sound
  2. Screens & displays
  3. Look
  4. Controls (MIDI, Stream Deck, footswitches)
  5. Network & devices
  6. Packages & key
  7. Software updates
  8. About
- **Toasts** for "saved", "sent", "connected". **Dialogs** only when we need an answer.

**4. Type with a job.**
- Titles: Archivo wide (`--wide`), weight 600.
- Body: `--fs` (15px) on computers, never under `--fs-sm` (13px) except meter scales.
- Dense labels and table heads: narrow (`--narrow`) in sentence case. No ALL-CAPS labels, except the pedal's
  existing hardware button names.
- Numbers that change (time, BPM, levels): `font-variant-numeric: tabular-nums`.

**5. Search everything.** One command box (⌘K / Ctrl+K) in Central Control, Central Usage, Central Pedal Control and
Central Production. It finds songs, setlists, settings (it jumps to and highlights the option), lights presets, slides
decks and actions ("Start stream", "Pre-service check"). This is the fix for "hard to find things".

**6. Spacing and shape.**
- Spacing comes only from `--s1` … `--s7`.
- Corners: `--r` for cards, `--r-sm` for inputs and chips, pills only for status chips.
- Don't give every element the same rounded card. Use hairlines (`--line`) and grouping before boxes.

**7. Touch.**
- On the Central Pedal's screens and phones/tablets, anything pressable is at least `--hit-touch` (52px).
- On computers, at least `--hit` (40px) for main controls.
- Keyboard focus is always visible (2px brass outline).

**8. Empty and error states give direction.** For example, "No songs yet. Add songs from Central Tracks or your
computer." with the button to do it. Errors say what happened and what to do, in plain words, without apologising.

**9. Motion.** Only motion that answers an action: opening, confirming, what changed. No entrance animations on page
load. `prefers-reduced-motion` turns it off (`--dur: 0`).

**10. Words.** Plain, short and human. Name things by what people do ("Add songs", "Go live", "Send to the pedal"),
not by how they're built. A button and the toast it produces use the same verb.

## Checking a screen
- Screenshot it at 1280×800 (computers), 800×480 (the pedal's 3.5" screen), 390×844 (phones) and 1920×1080 (HDMI).
- Ask four things: is there one obvious thing to press? Can a volunteer find X in under 5 seconds? Is anything here
  used less than monthly that could move behind "More…"? Do the colours and type match the other apps?
- The church's own colours (Settings → Look presets) must still apply. Tokens are defined from the same variable names.
