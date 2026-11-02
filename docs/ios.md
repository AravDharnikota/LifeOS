# AravOS on iPhone

The iOS app is the web app wrapped in a native shell (Capacitor 8). Haptics, camera, status bar,
keyboard and safe areas come from native plugins; everything else is the same code the web uses.

## Requirements
- A Mac with Xcode 16 or newer, an Apple ID (free is enough for installing on a personal device).
- Node 22 and pnpm (`corepack enable`).
- The server running somewhere the phone can reach (same Wi-Fi for local use, or a public HTTPS URL).

## Build and run
```bash
pnpm install
pnpm --filter @aravos/web build          # builds apps/web/dist
cd apps/web
pnpm exec cap sync ios                   # copies dist into ios/App/App/public and resolves plugins
pnpm exec cap open ios                   # opens Xcode
```
In Xcode: select the `App` target, set your Team under Signing and Capabilities, pick your iPhone,
press Run. The first launch asks for the server address and the access token (`ARAVOS_TOKEN`).

Re-run `pnpm --filter @aravos/web build && pnpm exec cap sync ios` whenever the web app changes.

## What is native
| Feature | Plugin | Notes |
|---|---|---|
| Haptics | `@capacitor/haptics` | Mapped per the design brief (impact light on check, selection on steppers, notification success on daily targets) |
| Camera and photo library | `@capacitor/camera` | Meal photos and progress photos; images are downscaled to 1280 px before upload |
| Status bar | `@capacitor/status-bar` | Follows the app theme; overlays the web view (safe areas handled in CSS) |
| Keyboard | `@capacitor/keyboard` | Native resize so sheets stay above the keyboard |
| Preferences | `@capacitor/preferences` | Stores the server address and access token |

## Server address
The native app does not bundle a server. Point it at your deployment (see `docs/deploy.md`).
For local development on the same Wi-Fi, use `http://<your-mac-ip>:8787`; `NSAllowsLocalNetworking`
is enabled in `Info.plist` so plain HTTP on the local network works. Use HTTPS for anything else.

## Icon
`apps/web/public/icons/icon.svg` is the source. `scripts` do not regenerate it automatically; if you
change it, export a 1024 px PNG to `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
and 192/512 px PNGs into `public/icons/`.

## Web app on the home screen (no Mac needed)
Open the deployed URL in Safari, Share, Add to Home Screen. The PWA manifest and service worker make it
run full screen with the same UI. Haptics fall back to the single system tap Safari allows.
