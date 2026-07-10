# Zenblade 65 V2 (Mac)

A free Mac app for the **Pwnage Zenblade 65 V2** keyboard.

Change lighting, typing feel, and profiles without Windows software.

---

## What you need

- A Mac with **Apple silicon** (M1 / M2 / M3 / M4)
- **macOS** recent enough to run modern apps
- Your **Zenblade 65 V2** plugged in over USB
- **Node.js** installed ([nodejs.org](https://nodejs.org) — LTS is fine)

This app is for this keyboard model. Other boards may not work.

---

## Install (one time)

1. Download or clone this project.
2. Open **Terminal**.
3. Go into the project folder, then run:

```bash
npm run install-app
```

That installs **Zenblade** into **Applications** and opens it.

Next time you can open it from Spotlight (press `Cmd + Space`, type **Zenblade**) or from Launchpad / Applications.

---

## Update

When you get a new version of this project, run the same command again:

```bash
npm run install-app
```

It rebuilds the app and replaces the one in Applications.

---

## Using the app

### Connect

1. Plug in the keyboard.
2. Open **Zenblade**.
3. Open the app with the keyboard connected. Zenblade detects approved devices automatically; on first use, approve the filtered Zenblade picker if your system presents it. The Device menu can retry discovery later.
4. Pick your keyboard if macOS asks for permission.

Status should show that you are connected.

### Lights

- Turn lights on or off
- Pick an effect (Solid, Breathing, and others)
- Set color with the sliders, or open **Advanced** for a color wheel and HEX / RGB / HSL
- Adjust brightness and speed
- Press **Apply lights** to send settings to the keyboard

The app’s accent colors follow your keyboard color.

### Feel

- Set how far you press and release the keys (global for the whole board)
- Try presets (snappy, balanced, typing)
- Press **Apply feel** so the keyboard uses the new values

Feel settings are saved on your Mac and restored the next time you open the app.

### Keyboard (per-key)

- Click a key on the board
- Change press / release for that key only
- Optionally store a macro or combo note (saved in the app)
- **Reset to default** returns that key to your global Feel settings
- Keys you customized show a different color on the board

### Profiles

Use **Profile 1 / 2 / 3** for different setups (for example work vs games).  
Each profile keeps its own lights, feel, and per-key edits.

---

## Tips

- **Apply** buttons send the current panel settings to the keyboard. Always apply after big changes.
- Feel and per-key settings are remembered on this Mac even if the keyboard is unplugged.
- If something looks wrong after an update, run `npm run install-app` again and reconnect the keyboard.

---

## Run without installing

For a quick try without putting the app in Applications:

```bash
npm install
npm start
```

---

## Uninstall

- Delete **Zenblade** from **Applications**
- Optional: delete this project folder

---

## License

**MIT** — free to use, share, and modify. See [LICENSE](LICENSE).

Not affiliated with Pwnage. For personal use with the Zenblade 65 V2.
