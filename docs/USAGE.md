# Using Zenblade

### Lights

1. Choose an effect category and firmware effect.
2. Adjust the controls exposed by that effect.
3. Use the color picker for effects that accept a base color.
4. For **Gradient V** and **Gradient H**, check the two endpoint swatches against the keyboard preview.
5. Select **Apply** to write the settings to the keyboard.

The app intentionally omits firmware mode `2` (`Alpha Mods`) because it is not supported by this keyboard. Stored or reported mode-2 values safely fall back to **Solid**; the remaining firmware IDs are not renumbered.

### Feel

- **Press** controls how far a key travels before registering.
- **Release** controls how far it must return before unregistering.
- **Rapid Trigger** allows a key to retrigger as soon as its direction changes.
- **Snappy**, **Balanced**, and **Typing** provide starting points.
- **Apply** writes the complete actuation matrix to the current keyboard profile.

### Keyboard

Select a key in the keyboard diagram to set a press/release override. **Save Key** stores the change locally while disconnected; **Apply Key** stores it and writes the current matrix when connected. **Reset Key** returns it to the profile's global Feel values.

### Profiles

Profiles 1–3 keep separate lighting, Feel, and per-key settings. Switching profiles writes the selected profile and attempts to apply all of its settings. If only part of that operation succeeds, the Profiles page offers a recovery action.

Use **Export** to save the current profile as a `.zenbladeprofile` file. **Import** validates a profile file, confirms before replacing the current local profile, and applies it when the keyboard is connected.

### Advanced

Expand the section you need, then select **Load keyboard** before editing advanced controls. This reads the real onboard configuration instead of assuming defaults.

- **Polling rate** reports the 125 μs USB interval advertised by the connected V2, which is 8,000 Hz. The current firmware does not expose a polling-rate setter, so the app does not show a control that cannot affect the hardware.
- **Key remapping** edits one physical key on one of the six hardware layers. Escape remains protected because the firmware rejects remapping it.
- **SOCD pairs** provides ten slots per hardware profile with last-input, neutral, and dominant-key rules.
- **Macros** loads all sixteen hardware slots. Select **Record**, type the sequence, and press Escape or select **Stop recording**. Delays and ASCII text can also be added directly.

Every advanced save reads the setting back from the keyboard and reports an error if the stored data does not match.

### System

The **System** page links spare keyboard keys to macOS without introducing an arbitrary script runner.

- **Key controls** offers two trigger styles. **Replace a key** turns Home, Page Up, Page Down, or End into the selected function; media functions use verified onboard keycodes, so playback and volume work without the app window. **Modifier + key** preserves the factory key and runs a desktop action such as Command+Home → microphone toggle while the keyboard is connected and Zenblade is running in the background. One binding may own each spare key, preventing ambiguous overlaps.
- **Meeting setup** stores an input and output device independently for each profile. It is configuration only: map Meeting setup, Select microphone, or Select audio output to a keyboard binding to invoke it.
- **Status map** watches microphone mute state or a user-supplied process-name fragment. Rules choose their own color, key or activity row, and priority. Mic and action rules may intentionally share a key because input mappings and status colors are separate layers.
- **Quick presets** provide editable starting points for muted microphone, Codex, Claude Code, and Grok. They are ordinary rules after creation: names, process matches, targets, priorities, and colors remain fully customizable.

The Zenblade V2 firmware currently exposes whole-board lighting parameters but no per-key RGB framebuffer. The app therefore renders status rules in its live keyboard map and never replaces the physical keyboard’s selected lighting effect with a misleading whole-board color. The status engine and rendering output are isolated so a future verified per-key protocol or firmware can drive the same rules physically.

System controls and indicators are stored inside each Zenblade profile and are included in profile exports. Pausing controls or removing a replacement restores Home, Page Up, Page Down, and End to their factory functions the next time controls are synced; modifier shortcuts are unregistered. Process matching and audio inspection remain entirely local to the Mac.

### Automatic switching

Automatic switching starts with no application rules. In **Profiles**:

1. Select **Add applications** and choose one or more installed Mac apps.
2. Choose the profile each application should activate.
3. Optionally enable a fallback profile for every application without a rule.
4. Turn **Automatic switching** on.

Rules match exact macOS bundle identifiers; the app does not assume or hardcode games, editors, or other applications. Turn the feature off from either the Profiles page or the menu-bar controller to pause switching without deleting rules.

### Menu bar and reconnect recovery

Zenblade remains available from the macOS menu bar when its window is closed. The menu provides the current connection state, Profile 1–3, lighting power, automatic switching, reconnect, and a shortcut back to the main window.

After sleep, wake, unlock, or a supported keyboard reconnect, the app reuses the existing WebHID permission and restores the current profile without opening a new device chooser. If the keyboard is unavailable, local settings remain intact and **Connect keyboard** stays available.
