# 🌿 GardenDoc — Plant, Lawn & Tree Doctor

A phone app for your garden: point your camera at a plant, a patch of lawn, or a
tree, and get an instant diagnosis — what it is, what's wrong (too much water,
needs more water, iron/nitrogen deficiency, disease, pests…) and a concrete
step-by-step plan to fix it.

Built as an installable **PWA** (Progressive Web App): it runs from your phone's
home screen with full camera access, no app store needed. A small Flask server
does the analysis using Claude's vision API.

## How it works

1. Open the app on your phone → tap **Take a photo** (or pick from gallery).
2. Optionally tell it what you're scanning (plant / lawn / tree) and add notes
   ("started yellowing last week", "watered daily", …).
3. Tap **Diagnose**. The photo is analyzed by Claude (vision + structured
   output), and you get back:
   - Species identification with confidence level
   - Health status + plain-language summary
   - A watering verdict (too much / too little / OK)
   - Each problem found, its severity, and the visual evidence for it —
     including which nutrient is deficient when that's the issue
   - **Do this now** — immediate, concrete actions (products, amounts, frequency)
   - Ongoing care routine and prevention tips
4. Your last 12 scans are saved on the device (nothing stored on the server).

## Quick start

```bash
cd plantdoc
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...   # get one at https://platform.claude.com
python app.py
```

Then from your phone (same Wi-Fi network) open `http://<your-computer-ip>:5050`.

## Installing it as an app on your phone

Camera capture works from the browser everywhere; **installing to the home
screen** requires HTTPS (browsers only allow PWA install + service workers on
secure origins). Easiest options:

- **Simplest:** open the app in the phone browser and use it there — the
  "take photo" button works over plain HTTP too, since it uses the native
  camera picker rather than a live camera stream.
- **Proper install:** put the app behind HTTPS, e.g. with
  [Tailscale](https://tailscale.com) (`tailscale serve 5050` gives you a valid
  HTTPS URL on your private network), ngrok/Cloudflare Tunnel, or a reverse
  proxy with a certificate. Then in the phone browser choose
  **Add to Home Screen** — you get a full-screen app with an icon.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (required) | API key used by the server |
| `GARDENDOC_MODEL` | `claude-opus-4-8` | Claude model used for diagnosis |
| `PORT` | `5050` | Server port |

## Notes

- Photos are downscaled on the phone to ≤1568 px before upload, so requests
  stay small and fast.
- Scan history lives in your browser's `localStorage` only.
- The better the photo, the better the diagnosis — the app will tell you when
  a closer shot (e.g. a leaf underside) would help.
