# Using Zenblade

### Lights

1. Choose an effect category and firmware effect.
2. Adjust the controls exposed by that effect.
3. For effects that accept a base color, use the color picker, type a hex value such as `#7A00FF`, or pick a preset.
4. For **Gradient V** and **Gradient H**, check the two endpoint swatches against the keyboard preview.
5. Select **Apply** to write the settings to the keyboard.

Moving effects animate in the preview at a pace that follows **Speed**. The preview is still when macOS **Reduce motion** is on.

The app intentionally omits firmware mode `2` (`Alpha Mods`) because it is not supported by this keyboard. Stored or reported mode-2 values safely fall back to **Solid**; the remaining firmware IDs are not renumbered.

### Feel

- **Press** controls how far a key travels before registering, from 0.1 to 4.0 mm.
- **Release** controls how far it must return before unregistering.
- **Rapid Trigger** allows a key to retrigger as soon as its direction changes.
- **Continuous** keeps a key in Rapid Trigger until it is fully released, instead of resetting at the press point.
- **Snappy**, **Balanced**, and **Typing** provide starting points.
- **Apply** writes the complete actuation matrix to the current keyboard profile. It is available when something has changed since the last write.
- The **Typing Test** shows words per minute, average key hold time, and **Double presses**: re-presses within 25 ms of a release, which usually means a key is bouncing at a very short press point.

### Keyboard

Select a key in the keyboard diagram to set a press/release override. Shift-click (or Command-click) adds keys to the selection, and **WASD**, **Arrows**, and **Modifiers** select common groups, so one change can tune several keys. Each override can also force **Rapid Trigger** and **Continuous** on or off for just those keys, for example Rapid Trigger on WASD but not on Escape.

**Save Key** stores the change locally while disconnected; **Apply Key** stores it and writes the current matrix when connected. **Use global feel** returns the selected keys to the profile's Feel values. Keys with their own feel show their press point in the corner; hover for the full setting. **Clear overrides** removes every override in the profile after a second click to confirm.

### Profiles

Profiles 1–3 keep separate lighting, Feel, and per-key settings. Each card summarises its effect, press point, overrides, and app rules. Switching profiles writes the selected profile and attempts to apply all of its settings. If only part of that operation succeeds, the Profiles page offers a recovery action.

Give the selected profile a **Name**; it appears on the cards, in the menu-bar menu, and in automatic-switching lists. **Copy settings to** replaces another profile with this one's settings (keeping that profile's name); **Reset** returns the selected profile to defaults. Both ask for a second click to confirm.

Use **Export** to save the current profile as a `.zenbladeprofile` file. **Import** validates a profile file, confirms before replacing the current local profile, and applies it when the keyboard is connected. Exports include the profile's SOCD pairs once they have been loaded or saved in **Advanced**.

### Advanced

Expand the section you need, then select **Load keyboard** before editing advanced controls. This reads the real onboard configuration instead of assuming defaults.

- **Polling rate** reports the 125 μs USB interval advertised by the connected V2, which is 8,000 Hz. The current firmware does not expose a polling-rate setter, so the app does not show a control that cannot affect the hardware.
- **Key remapping** edits one physical key on one of the six hardware layers. Click the key on the drawing (or use the list), then choose its assignment from the grouped list. Hover a key to see its current assignment. Escape remains protected because the firmware rejects remapping it.
- **SOCD pairs** provides ten slots per hardware profile with last-input, neutral, and dominant-key rules.
- **Macros** loads all sixteen hardware slots. Select **Record**, type the sequence, and press Escape or select **Stop recording**. Shortcuts such as Command-C are recorded with the modifier held, and function and navigation keys are captured. Delays and ASCII text can also be added directly. The counter shows how much of the keyboard's 4,000-byte macro storage all slots use; **Save macros** is unavailable while it is over the limit.

Every advanced save reads the setting back from the keyboard and reports an error if the stored data does not match.

### System

The **System** page links spare keyboard keys to macOS without introducing an arbitrary script runner.

- **Key controls** offers two trigger styles. **Replace a key** turns Home, Page Up, Page Down, or End into the selected function; media functions use verified onboard keycodes, so playback and volume work without the app window. **Modifier + key** preserves the factory key and runs a desktop action such as Command+Home → microphone toggle while the keyboard is connected and Zenblade is running in the background. One binding may own each spare key, preventing ambiguous overlaps.
- **Meeting setup** stores an input and output device independently for each profile. It is configuration only: map Meeting setup, Select microphone, or Select audio output to a keyboard binding to invoke it.
- **Status map** watches microphone mute state or a user-supplied process-name fragment. Click a key on the map to add an indicator there, or edit the one it already has. Rules choose their own color, key or activity row, and priority. Mic and action rules may intentionally share a key because input mappings and status colors are separate layers.
- **Quick presets** provide editable starting points for muted microphone, Codex, Claude Code, and Grok. They are ordinary rules after creation: names, process matches, targets, priorities, and colors remain fully customizable.

The Zenblade V2 firmware currently exposes whole-board lighting parameters but no per-key RGB framebuffer. The app therefore renders status rules in its live keyboard map and never replaces the physical keyboard’s selected lighting effect with a misleading whole-board color. The status engine and rendering output are isolated so a future verified per-key protocol or firmware can drive the same rules physically.

**Open at login** starts Zenblade quietly in the menu bar when you log in, so profiles and key controls are ready without opening the window. It is also in the menu-bar menu.

System controls and indicators are stored inside each Zenblade profile and are included in profile exports. Pausing controls or removing a replacement restores Home, Page Up, Page Down, and End to their factory functions the next time controls are synced; modifier shortcuts are unregistered. Process matching and audio inspection remain entirely local to the Mac.

### Automatic switching

Automatic switching starts with no application rules. In **Profiles**:

1. Select **Add applications**, then pick a running app or **Choose from Applications…** for any installed app.
2. Choose the profile each application should activate.
3. Optionally enable a fallback profile for every application without a rule.
4. Turn **Automatic switching** on.

Rules match exact macOS bundle identifiers; the app does not assume or hardcode games, editors, or other applications. Turn the feature off from either the Profiles page or the menu-bar controller to pause switching without deleting rules.

### Menu bar and reconnect recovery

Zenblade remains available from the macOS menu bar when its window is closed. The menu provides the current connection state, the three profiles by name, lighting power, automatic switching, **Mute or Unmute Microphone**, **Start Meeting Setup** (when the current profile has meeting devices), reconnect, **Open at Login**, and a shortcut back to the main window.

After sleep, wake, unlock, or a supported keyboard reconnect, the app reconnects to the keyboard automatically and restores the current profile without opening a device chooser. If the keyboard is unavailable, local settings remain intact and **Connect keyboard** stays available.
